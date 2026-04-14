# Engineer 分层容错（Engineer Circuit）

## 概述

Engineer 是生成流水线最容易失败的节点：LLM 输出可能被截断、括号不平衡、或整个请求超时。`lib/engineer-circuit.ts` 实现三级容错机制——全层重试、逐文件降级、熔断器——确保部分文件失败时已完成的文件仍能正常渲染，而不是整体崩溃。

## 设计思路

核心取舍：宁可多消耗一次 LLM 请求，也不能让用户看到空白预览。三级递进式处理将"全量失败"的概率压到极低：

1. **Phase 1（全层重试）**：LLM 出口时偶发截断 → 同一批次重试一次
2. **Phase 2（逐文件降级）**：层级重试仍失败 → 将文件拆散，每个单独请求
3. **熔断器**：连续 N 个文件失败 → 停止无效重试，已成功的文件直接渲染

`snipCompletedFiles()` 是 token 压缩策略：直接依赖注入完整代码，间接依赖只注入签名，防止 context 溢出。

## 代码逻辑

### 常量

```typescript
const MAX_LAYER_ATTEMPTS = 2;         // Phase 1 最多重试次数
const MAX_PER_FILE_ATTEMPTS = 2;      // Phase 2 每文件最多尝试次数
const CIRCUIT_BREAKER_THRESHOLD = 3;  // 连续失败超过此值触发熔断
```

### 核心函数签名

```typescript
export async function runLayerWithFallback(
  layerFiles: readonly ScaffoldFile[],
  requestFn: (files: readonly ScaffoldFile[], meta: RequestMeta) => Promise<RequestResult>,
  signal?: AbortSignal,
  onAttempt?: (info: AttemptInfo) => void
): Promise<LayerResult>

export interface LayerResult {
  files: Record<string, string>;  // 成功生成的文件
  failed: string[];               // 最终失败的文件路径
}
```

### 执行流程

```
runLayerWithFallback(layerFiles, requestFn, signal, onAttempt)
    │
    ├── Phase 1: 全层重试（最多 MAX_LAYER_ATTEMPTS 次）
    │     attempt=1 → requestFn(remaining, { attempt:1, priorFailed:[] })
    │       → files_complete:            accumulated += result.files; remaining = still-missing
    │       → partial_files_complete:    accumulated += ok; remaining = failed subset
    │       → error/throw:               result = { files:{}, failed: all-remaining }
    │     attempt=2 → requestFn(remaining, { attempt:2, priorFailed })
    │       reason: "parse_failed"
    │     remaining.length === 0 → return early
    │
    └── Phase 2: 逐文件降级（remaining 仍有文件时）
          for each file in remaining:
            consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD → skip (mark failed)
            for attempt in 1..MAX_PER_FILE_ATTEMPTS:
              requestFn([file], { attempt, priorFailed:[file.path] })
              file.path in result.files → accumulated[file.path] = code; consecutiveFailures=0; break
            not succeeded → failedFinal.push; consecutiveFailures++
          return { files: accumulated, failed: failedFinal }
```

### 指数退避（retryWithBackoff）

Phase 1 每次重试之前调用 `retryWithBackoff`：

```typescript
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 100,
  signal?: AbortSignal
): Promise<T>
// 延迟：100ms → 200ms → 400ms（baseDelay × 2^attempt）
```

### snipCompletedFiles 与 COMPOSER_DEP_THRESHOLD

在 `lib/generate-prompts.ts` 中，`snipCompletedFiles(completedFiles, targetDeps)` 决定已完成文件如何注入当前 Engineer 请求：

- **直接依赖**（`targetDeps` 包含该路径）→ 注入完整代码
- **间接依赖**（已完成但非直接依赖）→ 只注入 export 签名行（`export function X`, `export const Y` 等）

当已完成文件数超过 `COMPOSER_DEP_THRESHOLD=5` 时，仅注入直接依赖的完整代码，其余全部只给签名，防止 context 超出 maxOutputTokens。

### onAttempt 回调

每次 Phase 1/Phase 2 尝试都会调用 `onAttempt(AttemptInfo)`，UI 层读取后更新重试横幅（retry banner）：

```typescript
interface AttemptInfo {
  attempt: number;
  maxAttempts: number;
  reason: "initial" | "parse_failed" | "per_file_fallback";
  failedSubset: string[];
  phase: "layer" | "per_file";
}
```

### 拓扑排序（topologicalSort）

在进入 `runLayerWithFallback` 之前，Architect 输出的文件列表先经过拓扑排序分层：

```typescript
export function topologicalSort(
  files: ReadonlyArray<{ readonly path: string; readonly deps: readonly string[] }>
): string[][]
// 返回 layers[][]，同层文件互无依赖，可并行生成
// 若存在循环依赖则 throw（应已由 validateScaffold 清除）
```

算法为 Kahn's BFS：计算入度 → 零入度节点为第一层 → 逐层 BFS 展开。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| 全部文件首次成功 | Phase 1 attempt=1 直接返回 |
| 部分文件首次截断 | Phase 1 attempt=2 重试失败子集 |
| 全层首次解析失败 | Phase 1 attempt=2 重试，reason="parse_failed" |
| Phase 1 仍有失败 | Phase 2 逐文件单独请求 |
| 连续 3 个文件失败 | 熔断，剩余文件跳过 |
| AbortSignal 触发 | 任意阶段立即 throw "Aborted" |
| Layer 1 完成后 Layer 2 消费其 exports | snipCompletedFiles 注入 Layer 1 代码 |

## 未覆盖场景 / 已知限制

- **循环依赖**：由 `validateScaffold` 提前破环处理；若仍有循环则 `topologicalSort` 抛错，整个 Engineer 阶段中断。
- **>10 层时性能退化**：层间严格串行，层数多时总延迟线性增长；没有全局超时限制。
- **Phase 2 无 snip 优化**：逐文件请求时仍注入所有已完成文件，可能超出 token 限制。
- **onAttempt 只通知 UI**：重试信息仅展示给用户，不影响请求内容（重试提示通过 context 字段注入，不通过 meta）。

## 相关文件

- `lib/engineer-circuit.ts` — `runLayerWithFallback`、`retryWithBackoff`
- `lib/topo-sort.ts` — `topologicalSort`
- `lib/generate-prompts.ts` — `snipCompletedFiles`、`getMultiFileEngineerPrompt`
- `lib/types.ts` — `ScaffoldFile`、`RequestMeta`、`RequestResult`、`AttemptInfo`
- `components/workspace/chat-area.tsx` — Engineer 层循环调用
