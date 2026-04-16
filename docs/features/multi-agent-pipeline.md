# 多 Agent 编排流水线（Multi-Agent Pipeline）

## 概述

BuilderAI 根据项目复杂度选择两条生成路径：**简单路径**（≤3 个模块且 ≤5 个功能）走传统三 Agent 串行流水线；**复杂路径**（模块 >3、功能 >5 或 PM 输出 `complexity == "complex"`）走新增的 Decomposer + 骨架 + 模块填充流水线。意图路由决定走"完整流水线"还是"直接路径"；复杂度检测决定完整流水线走哪条子路径。

`PipelineController`（`lib/pipeline-controller.ts`）是两条路径共用的程序化状态机，负责状态转换、SSE 事件派发和错误恢复。

---

## 意图路由表

| Intent | 触发条件 | 路径 |
|--------|---------|------|
| `new_project` | 无现有代码，或命中"重新做"等关键词 | 完整流水线（简单或复杂） |
| `feature_add` | 有代码且无关键词命中（默认） | 完整流水线（简单或复杂） |
| `bug_fix` | 命中 BUG_KEYWORDS | 直接路径（跳过 PM + Architect） |
| `style_change` | 命中 STYLE_KEYWORDS 或颜色表达式 | 直接路径（跳过 PM + Architect） |

---

## 简单路径（new_project / feature_add，≤3 个模块且 ≤5 个功能）

### 触发条件

```typescript
// lib/pipeline-controller.ts
function resolveComplexity(pm: PmOutput): "simple" | "complex" {
  if (pm.complexity === "complex") return "complex";
  if ((pm.modules?.length ?? 0) > 3) return "complex";
  if ((pm.features?.length ?? 0) > 5) return "complex";
  return "simple";
}
```

### 流程

```
classifyIntent()
    │
    ▼
[PM Agent]  POST /api/generate { agent: "pm" }
  输入：userPrompt
        + buildPmHistoryContext(rounds)   // feature_add: 最近 5 轮历史
  输出：JSON PmOutput { intent, features[], persistence, modules[], dataModel?,
                        complexity?: "simple"|"complex", gameType? }
        → extractPmOutput(raw)
        → resolveComplexity(pm) == "simple"  →  走本路径
    │
    ▼
[Architect Agent]  POST /api/generate { agent: "architect" }
  输入：PmOutput JSON
        + deriveArchFromFiles(existingFiles)  // 实时架构摘要（无 LLM）
  输出：<thinking>...</thinking><output>JSON ScaffoldData</output>
        → extractScaffoldFromTwoPhase(raw)
        → validateScaffold(raw)              // 7 规则确定性修复
        → topologicalSort(files)             // → layers[][]
    │
    ▼
[Engineer Agent × N]  层间串行，层内并行
  每层：runLayerWithFallback(layerFiles, requestFn, signal, onAttempt)
  输入（每文件）：getMultiFileEngineerPrompt(file, scaffold, context)
                  + snipCompletedFiles(completedFiles, file.deps)
                  + existingFiles（feature_add 时注入 V1 代码）
  输出：files_complete | partial_files_complete | error(parse_failed)
    │
    ▼
后处理（见下方"后处理"章节）
```

---

## 复杂路径（new_project / feature_add，模块 >3 或功能 >5 或 complexity == "complex"）

### 整体流程

```
classifyIntent()
    │
    ▼
[PM Agent]  （同简单路径）
  → resolveComplexity(pm) == "complex"  →  走本路径
    │
    ▼ SSE: {"type":"pipeline_state","state":"DECOMPOSING","message":"..."}
[Decomposer Agent]  POST /api/generate { agent: "decomposer" }
  输入：PmOutput JSON
        + buildDecomposerContext(pm, existingFiles)
  输出：JSON DecomposerOutput {
          modules: ModuleDefinition[],
          generateOrder: string[][]   // 二维数组：外层串行，内层并行
        }
        → modules 数量上限 ≤5（超出时 Decomposer 被要求合并）
    │
    ▼ SSE: {"type":"pipeline_state","state":"SKELETON","message":"..."}
[骨架 Architect]  POST /api/generate { agent: "architect" }
  输入：buildSkeletonArchitectContext(pm, decomposerOutput, existingFiles)
        // 只要求生成共享类型文件 + 根布局，不生成业务模块代码
  输出：ScaffoldData（仅骨架文件）
        → validateScaffold(raw)
        → WebContainer 立即挂载骨架（用户可见初始 UI，~30s）
    │                         SSE: {"type":"skeleton_ready","files":{...}}
    ▼
[模块填充循环]  按 generateOrder 串行执行外层，并行执行内层
  对每个 module（按 generateOrder 顺序）：
    │
    ├─ SSE: {"type":"module_start","moduleName":"...","index":N,"total":M}
    │
    ├─ [模块 Architect]  POST /api/generate { agent: "architect" }
    │     输入：buildModuleArchitectContext(module, skeletonFiles, completedModules)
    │           // 注入骨架文件 + 已完成模块的 interface 契约
    │     输出：ScaffoldData（仅本模块文件）
    │           → validateScaffold + topologicalSort
    │
    ├─ [模块 Engineer × N]  runLayerWithFallback（同简单路径层级逻辑）
    │     输入：模块 scaffold + 骨架文件 + 已完成模块文件
    │     输出：本模块所有文件
    │
    ├─ 将本模块文件增量挂载到 WebContainer（Vite HMR 热更新，无需重启）
    │
    └─ SSE: {"type":"module_complete","moduleName":"...","files":{...}}
           或 {"type":"module_failed","moduleName":"...","reason":"..."}
    │
    ▼（所有模块完成后）
后处理（见下方"后处理"章节）
```

### PipelineController 状态机

`lib/pipeline-controller.ts` 管理以下状态，每次转换触发对应 SSE 事件：

```
IDLE
  │ classifyIntent() 开始
  ▼
CLASSIFYING
  │ PM Agent 返回
  ▼
DECOMPOSING          ← 仅复杂路径
  │ Decomposer Agent 返回
  ▼
SKELETON             ← 仅复杂路径（骨架 Architect）
  │ 骨架文件挂载完成
  ▼
MODULE_FILLING       ← 仅复杂路径（逐模块 Architect + Engineer）
  │                    OR
  ├─────────────────── 简单路径直接从 CLASSIFYING 到此等效阶段
  ▼
POST_PROCESSING      ← 两条路径共用
  │
  ▼
COMPLETE
```

失败处理：
- MODULE_FILLING 阶段单个模块失败 → SSE `module_failed` → 继续后续模块（不中止整体）
- Decomposer Agent 失败 → 降级为简单路径（`fallback to simple pipeline`）

### Decomposer Agent 详解

**输入**：PM 输出 + 项目上下文（现有文件列表、技术栈）

**输出**：`DecomposerOutput`

```typescript
interface ModuleDefinition {
  name: string;                   // 模块唯一名称，如 "AuthModule"
  files: string[];                // 本模块将生成的文件路径
  interface: string;              // 供其他模块引用的导出契约（TypeScript 类型字符串）
  dependencies: string[];         // 依赖的其他模块名称（用于排序）
  description: string;            // 给 Architect 看的模块职责描述
}

interface DecomposerOutput {
  modules: ModuleDefinition[];    // ≤5 个模块
  generateOrder: string[][];      // [[A, B], [C], [D]] → A 和 B 并行 → C → D
}
```

`generateOrder` 的二维结构决定并行/串行：同一子数组内的模块可并行填充，子数组之间串行执行。Decomposer 负责根据模块间依赖关系安排正确的顺序。

### 模块 interface 契约

每个 `ModuleDefinition.interface` 字段包含该模块对外暴露的 TypeScript 类型描述（非完整代码）。骨架 Architect 和后续模块 Architect 都能看到这些契约，确保跨模块调用的类型一致性，防止模块间 import/export 不匹配。

### 渐进式交付

1. 骨架挂载（~30s）：用户看到根布局和导航结构，可立即交互
2. 每个模块完成后立即通过 Vite HMR 热注入，用户实时看到功能逐步出现
3. 骨架到模块的过渡无需 WebContainer 重启（增量文件写入）

---

## 直接路径（bug_fix / style_change）

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
  后处理（简化版，不经过 PipelineController）
```

**为什么单文件用 `<source>` XML 而非 `// === FILE:` 分隔符？**

`// === FILE:` 是 Engineer 输出格式标记，若同时出现在输入中，LLM 会模式匹配输出多文件格式，导致单文件 `extractReactCode` 解析失败。XML 标签语义明确区分"输入参考"与"输出格式"。

---

## 后处理（两条路径共用）

```
merge({ ...currentFiles, ...allCompletedFiles })
findMissingLocalImportsWithNames()  → ≤3: 发起补全请求
checkImportExportConsistency()      → ≤3: 发起修复请求
checkDisallowedImports(sceneTypes)  → ≤3: 发起修复请求
  // game-engine 场景允许 phaser；其他场景禁止
apply scaffold.removeFiles
WebContainer 挂载最终文件集（mountIncremental）
POST /api/versions { files }
```

---

## SSE 事件协议

完整事件集（简单路径 + 复杂路径）：

```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}
data: {"type":"code_complete","code":"..."}
data: {"type":"files_complete","files":{...}}
data: {"type":"partial_files_complete","files":{...},"failed":[...],"truncatedTail":"..."}
data: {"type":"file_start","path":"/components/Header.js"}
data: {"type":"file_chunk","path":"/components/Header.js","delta":"..."}
data: {"type":"file_end","path":"/components/Header.js"}
data: {"type":"error","error":"...","errorCode":"parse_failed","failedFiles":[...],"truncatedTail":"..."}
data: {"type":"done"}

// 复杂路径专有事件：
data: {"type":"pipeline_state","state":"DECOMPOSING","message":"正在拆解模块..."}
data: {"type":"pipeline_state","state":"SKELETON","message":"正在构建骨架..."}
data: {"type":"pipeline_state","state":"MODULE_FILLING","message":"正在填充模块..."}
data: {"type":"skeleton_ready","files":{"/App.js":"...","...":"..."}}
data: {"type":"module_start","moduleName":"AuthModule","index":0,"total":4}
data: {"type":"module_complete","moduleName":"AuthModule","files":{...}}
data: {"type":"module_failed","moduleName":"AuthModule","reason":"parse_failed"}
```

---

## 模型选择优先级链

```typescript
resolveModelId(requestModelId, projectModelId, userModelId, env)
// 优先级：request → project → user → AI_PROVIDER env → DEFAULT_MODEL_ID → 第一个可用模型
```

每次 `/api/generate` 请求独立走此链，同一项目的不同 Agent 调用可使用不同模型。

---

## 上下文注入点汇总

| Agent | 注入函数 | 内容 |
|-------|---------|------|
| PM (feature_add) | `buildPmHistoryContext(rounds)` | 最近 5 轮的 userPrompt、intent、pmSummary |
| Architect (简单路径) | `deriveArchFromFiles(existingFiles)` | 实时文件结构、exports、imports、状态管理、持久化 |
| Decomposer | `buildDecomposerContext(pm, existingFiles)` | PM 输出 + 现有文件上下文 |
| 骨架 Architect | `buildSkeletonArchitectContext(pm, decomp, existing)` | PM + Decomposer 输出，仅要求骨架 |
| 模块 Architect | `buildModuleArchitectContext(module, skeleton, done)` | 骨架文件 + 已完成模块的 interface 契约 |
| Engineer (feature_add) | `existingFiles: currentFiles` | `// === EXISTING FILE: /path ===` 代码块 |
| Engineer (direct single) | `buildDirectEngineerContext` | `<source file="...">` XML 标签 |
| Engineer (direct multi) | `buildDirectMultiFileEngineerContext` | `<source>` + `archSummary` |

---

## 覆盖场景

- 全部 4 种意图路由
- 简单路径：传统三 Agent 串行流水线
- 复杂路径：Decomposer 拆模块 → 骨架 Architect → 逐模块 Architect + Engineer
- 渐进式交付：骨架先上，模块逐个 HMR 注入
- `partial_files_complete` 部分成功时只重试失败文件
- 后处理三项检查（缺失导入、named/default 不匹配、禁止包）
- Decomposer 失败时降级为简单路径

## 未覆盖场景 / 已知限制

- **无 Agent 间反馈循环**：模块 Architect 的 scaffold 有误时，Engineer 无法通知 Architect 重新规划。
- **模块并行填充受限**：`generateOrder` 同层并行在模块间共享状态时可能产生竞争，当前实现保守地将有依赖关系的模块串行化。
- **Decomposer 模块上限 5**：超出时 Decomposer 被要求合并，合并策略由 LLM 决定，可能不是最优分组。
- **triage 仅基于 LLM 判断**：triage 自身无回退，若 LLM 返回无效路径则静默 fallback 全量。
- **>3 个后处理问题时静默跳过**：超过阈值的缺失导入/不匹配问题不修复，仅依赖 Proxy stub 防白屏。

## 相关文件

- `components/workspace/chat-area.tsx` — 完整编排逻辑（意图路由 + 简单/复杂路径分发）
- `lib/pipeline-controller.ts` — PipelineController 状态机（IDLE → COMPLETE）
- `lib/decomposer.ts` — Decomposer Agent 上下文构建 + DecomposerOutput 类型
- `lib/agent-context.ts` — 所有上下文构建函数，含 `buildSkeletonArchitectContext`、`buildModuleArchitectContext`
- `lib/intent-classifier.ts` — Phase 0 意图分类
- `lib/engineer-circuit.ts` — Engineer 层级容错（`runLayerWithFallback`）
- `lib/validate-scaffold.ts` — Scaffold 验证修复（7 规则）
- `lib/topo-sort.ts` — 拓扑排序分层
- `app/api/generate/handler.ts` — SSE 生成编排器；Agent 路由、stream tap、代码提取
- `app/api/generate/route.ts` — SSE 生成端点（Edge Runtime 入口）
