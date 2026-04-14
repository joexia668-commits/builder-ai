# 多 Agent 编排流水线（Multi-Agent Pipeline）

## 概述

BuilderAI 用三个专职 Agent（PM、Architect、Engineer）串行协作生成完整应用。每个 Agent 独立发起一次 SSE 请求，输出作为下一个 Agent 的输入。意图路由决定走"完整流水线"还是"直接路径"。完整流水线位于 `components/workspace/chat-area.tsx`，上下文构建逻辑集中在 `lib/agent-context.ts`。

## 设计思路

核心取舍：每个 Agent 是独立 SSE 请求而非单次大模型调用。优点是规避了单次 token 上限，每层 Engineer 可并行，且可针对不同 Agent 选用不同模型；代价是延迟叠加（PM ~10s + Architect ~15s + Engineer 分层 ~N×15s）。

无反馈循环：Agent 间单向传递，无法回退重协商。在单次请求模型上这是可接受的取舍。

## 代码逻辑

### 意图路由表

| Intent | 触发条件 | 路径 |
|--------|---------|------|
| `new_project` | 无现有代码，或命中"重新做"等关键词 | 完整流水线 |
| `feature_add` | 有代码且无关键词命中（默认） | 完整流水线 |
| `bug_fix` | 命中 BUG_KEYWORDS | 直接路径 |
| `style_change` | 命中 STYLE_KEYWORDS 或颜色表达式 | 直接路径 |

### 完整流水线（new_project / feature_add）

```
classifyIntent()
    │
    ▼
[PM Agent]  POST /api/generate { agent: "pm" }
  输入：userPrompt
        + buildPmHistoryContext(rounds)   // feature_add: 最近 5 轮历史
  输出：JSON PmOutput { intent, features[], persistence, modules[], dataModel? }
        → extractPmOutput(raw)
    │
    ▼
[Architect Agent]  POST /api/generate { agent: "architect" }
  输入：PmOutput JSON
        + deriveArchFromFiles(existingFiles)  // 实时架构摘要（无 LLM）
  输出：<thinking>...</thinking><output>JSON ScaffoldData</output>
        → extractScaffoldFromTwoPhase(raw)
        → validateScaffold(raw)              // 5 规则修复
        → topologicalSort(files)             // → layers[][]
    │
    ▼
[Engineer Agent × N]  层间串行，层内并行
  每层：runLayerWithFallback(layerFiles, requestFn, signal, onAttempt)
  输入（每文件）：getMultiFileEngineerPrompt(file, scaffold, context)
                  + snipCompletedFiles(completedFiles, file.deps)  // 已完成文件快照
                  + existingFiles（feature_add 时注入 V1 代码）
  输出：files_complete | partial_files_complete | error(parse_failed)
    │
    ▼
后处理：
  merge({ ...currentFiles, ...allCompletedFiles })
  findMissingLocalImportsWithNames()  → ≤3: 发起补全请求
  checkImportExportConsistency()      → ≤3: 发起修复请求
  checkDisallowedImports()            → ≤3: 发起修复请求
  apply scaffold.removeFiles
  buildSandpackConfig(files, projectId)
  POST /api/versions { files }
```

### 直接路径（bug_fix / style_change）

```
classifyIntent()
    │
    ▼
[可选 triage]  仅多文件 V1 触发
  triageAffectedFiles(prompt, currentFiles)
    → POST /api/generate { triageMode: true }
    → JSON array 受影响路径
    → ≤3 路径: 使用子集; 0 或 >3: 使用全量
    │
    ▼
[Engineer Agent]  POST /api/generate { agent: "engineer" }
  单文件 V1：
    buildDirectEngineerContext(prompt, currentFiles)
    → <source file="..."> XML 标签格式
    → code_complete event → { "/App.js": code }
  多文件 V1：
    buildDirectMultiFileEngineerContext(prompt, triageFiles, archSummary)
    → { partialMultiFile: true }
    → files_complete event → merge(currentFiles, newFiles)
    │
    ▼
  buildSandpackConfig + POST /api/versions
```

**为什么单文件用 `<source>` XML 而非 `// === FILE:` 分隔符？**

`// === FILE:` 是 Engineer 输出格式标记，若同时出现在输入中，LLM 会模式匹配输出多文件格式，导致单文件 `extractReactCode` 解析失败。XML 标签语义明确区分"输入参考"与"输出格式"。

### SSE 事件协议

```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}
data: {"type":"code_complete","code":"..."}
data: {"type":"files_complete","files":{...}}
data: {"type":"partial_files_complete","files":{...},"failed":[...],"truncatedTail":"..."}
data: {"type":"error","error":"...","errorCode":"parse_failed","failedFiles":[...],"truncatedTail":"..."}
data: {"type":"done"}
```

### 模型选择优先级链

```typescript
resolveModelId(requestModelId, projectModelId, userModelId, env)
// 优先级：request → project → user → AI_PROVIDER env → DEFAULT_MODEL_ID → 第一个可用模型
```

每次 `/api/generate` 请求独立走此链，同一项目的不同 Agent 调用可使用不同模型。

### 上下文注入点汇总

| Agent | 注入函数 | 内容 |
|-------|---------|------|
| PM (feature_add) | `buildPmHistoryContext(rounds)` | 最近 5 轮的 userPrompt、intent、pmSummary |
| Architect | `deriveArchFromFiles(existingFiles)` | 实时文件结构、exports、imports、状态管理、持久化 |
| Engineer (feature_add) | `existingFiles: currentFiles` | `// === EXISTING FILE: /path ===` 代码块 |
| Engineer (direct single) | `buildDirectEngineerContext` | `<source file="...">` XML 标签 |
| Engineer (direct multi) | `buildDirectMultiFileEngineerContext` | `<source>` + `archSummary`（ADR 0018） |

## 覆盖场景

- 全部 4 种意图路由
- 多文件 V1 的 triage 子集优化
- `feature_add` V1 代码注入，Engineer 增量修改
- `partial_files_complete` 部分成功时只重试失败文件
- 后处理三项检查（缺失导入、named/default 不匹配、禁止包）

## 未覆盖场景 / 已知限制

- **无 Agent 间反馈循环**：Architect 的 scaffold 有误时，Engineer 无法通知 Architect 重新规划。
- **无并行 Agent 调用**：PM 和 Architect 严格串行，不支持并发分析再合并。
- **triage 仅基于 LLM 判断**：triage 自身无回退，若 LLM 返回无效路径则静默 fallback 全量。
- **>3 个后处理问题时静默跳过**：超过阈值的缺失导入/不匹配问题不修复，仅依赖 Proxy stub 防白屏。

## 相关文件

- `components/workspace/chat-area.tsx` — 完整编排逻辑
- `lib/agent-context.ts` — 所有上下文构建函数
- `lib/intent-classifier.ts` — Phase 0 意图分类
- `lib/engineer-circuit.ts` — Engineer 层级容错
- `lib/validate-scaffold.ts` — Scaffold 验证修复
- `lib/topo-sort.ts` — 拓扑排序分层
- `app/api/generate/route.ts` — SSE 生成端点
- `docs/examples/agent-orchestration.md` — 旧版编排说明（已被本文档取代）
