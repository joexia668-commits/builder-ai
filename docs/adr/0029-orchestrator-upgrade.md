# ADR 0029 — 模块编排升级：Orchestrator-Worker + Plan-and-Execute

## 问题描述

复杂项目（complex path）的模块生成存在三个根本问题：

1. **感知不完整** — Module Architect 不知道全局依赖图、下游消费者、失败模块影响。已完成模块的导出信息仅通过单行正则 `code.match(/^export\s+.+$/gm)` 提取，丢失多行 interface、type alias。
2. **决策规则隐式** — 模块失败后无条件 `continue`，不检查依赖链，不区分失败类型（超时 vs 解析失败 vs 合约违反）。
3. **没有接口合约** — Decomposer 定义的 `interface.exports/consumes/stateContract` 从不验证，模块间接口漂移无人发现。

附带问题：
- 模块级循环依赖无检测（文件级有 `breakCycles`，模块级没有）
- `generateOrder` 不验证拓扑正确性（LLM 可能给出错误顺序）
- `validateScaffold` 误杀跨模块文件引用（当作幽灵依赖移除）

## 根因

模块生成编排硬编码在 `chat-area.tsx` 的 for 循环中（约 140 行），没有独立的编排层。每个 agent 是"无状态函数调用"，模块间信息传递完全依赖 `allModuleFiles` 字典和正则提取。

## 修复方案

从 "Router + Pipeline + 弱化 Plan-Execute" 升级为 "Router + Orchestrator-Worker + 完整 Plan-Execute"。

### 新增组件

| 文件 | 职责 |
|------|------|
| `lib/module-topo-sort.ts` | 模块级循环检测（DFS + 反向流启发式断环）+ Kahn's 拓扑排序 |
| `lib/extract-exports.ts` | 增强正则提取结构化导出 `ExportEntry[]`（名称 + kind + 文件路径） |
| `lib/interface-registry.ts` | 模块接口合约中央注册表：declared vs actual exports，`verifyContract()` 验证 |
| `lib/execution-plan.ts` | 可变执行计划：`planNext` / `planComplete` / `planSkipCascade`，支持动态修订 |
| `lib/module-orchestrator.ts` | while 循环编排器：pick → execute → observe → decide，替代 chat-area.tsx for 循环 |

### 修改组件

| 文件 | 变更 |
|------|------|
| `lib/types.ts` | 新增 `ExportEntry`、`ModuleContract`、`ContractVerifyResult`、`ExecutionPlan`、`PlanRevision` 等类型 |
| `lib/decomposer.ts` | `validateDecomposerOutput` 增加 step 5（循环检测）和 step 6（拓扑重排，忽略 LLM 给的 generateOrder） |
| `lib/validate-scaffold.ts` | 新增 `knownExternalPaths?` 参数，Rule 1/2 不再误杀跨模块文件引用 |
| `lib/agent-context.ts` | `buildModuleArchitectContext` 增加 `registrySummary`、`planPosition`、`consumers`、`failedModules` 可选参数 |
| `chat-area.tsx` | Module Loop（~140 行 for 循环）替换为 `createModuleOrchestrator().run()`（~30 行调用） |

### 编排模式变化

```
旧: for (module of moduleQueue) { try { Arch+Eng } catch { continue } }
新: while (plan.pending.length > 0) {
      ① PICK:    planNext(plan, registry) — 检查所有 deps 都 completed/degraded
      ② EXECUTE: Architect(enhanced context) → Engineer(runLayerWithFallback)
      ③ OBSERVE: registry.verifyContract(module) — declared vs actual exports
      ④ DECIDE:  complete | patch(≤2 missing) | degrade | fail → re-plan
    }
```

### 失败恢复策略

| 失败类型 | 策略 | 条件 |
|---------|------|------|
| 超时/网络错误 | RETRY — 放回队尾重试 1 次 | `attempt < 2` 且 `isRetryableError` |
| 合约违反/解析失败 | STUB — 为失败模块生成最小导出 stub | 下游消费者对失败模块的依赖比 ≤ 0.5 |
| 合约违反/解析失败 | SKIP CASCADE — 级联跳过下游模块 | 下游消费者对失败模块的依赖比 > 0.5 |

## 测试

新增 5 个测试文件，共 53 个测试用例：

| 测试文件 | 用例数 | 覆盖 |
|---------|--------|------|
| `extract-exports.test.ts` | 10 | 各种 export 语法（function/class/const/interface/type/default/async） |
| `module-topo-sort.test.ts` | 10 | 线性链/独立模块/菱形依赖/循环检测/自引用 |
| `interface-registry.test.ts` | 12 | 初始化/注册/验证/状态管理/消费者查询/摘要生成 |
| `execution-plan.test.ts` | 8 | 创建/next/complete/skipCascade/summary |
| `module-orchestrator.test.ts` | 3 | happy path/失败级联/合约降级 |

加上 `decomposer.test.ts` (+2) 和 `validate-scaffold.test.ts` (+3) 和 `agent-context.test.ts` (+5) 的新增用例，总计新增 63 个测试。

## 预防措施

- 所有新逻辑（plan/registry/orchestrator）为纯函数，与 UI 层完全解耦，可独立单测
- `ExecutionPlan.original` 保留初始 DecomposerOutput，便于调试"原计划 vs 实际执行"
- `PlanRevision[]` 记录所有动态修订历史，可写入 version metadata 供用户查看
- `knownExternalPaths` 参数向后兼容（optional），不影响现有 simple path 调用
