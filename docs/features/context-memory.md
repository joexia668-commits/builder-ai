# 上下文记忆（Context Memory）

## 概述

BuilderAI 在多轮迭代中需要让 PM 和 Architect 知道应用的历史状态，避免每次都从零生成。系统通过两种机制实现：`iterationContext`（FIFO-5 历史轮次）传递给 PM 做增量 PRD；`deriveArchFromFiles()`（实时从代码静态分析）传递给 Architect 做架构感知修改。两者互补，无需存储 LLM 生成的架构决策。

## 设计思路

核心取舍：架构上下文从当前代码实时派生，而非保存上一轮 Architect 的输出（旧方案）。优点是代码永远是 ground truth，版本回退后架构摘要自动更新，无需同步额外字段；代价是静态分析能力有限（无法检测运行时状态模式）。

`iterationContext` 选择 FIFO-5 而非全量保存，是因为 PM 的 token 限制约束了历史长度；5 轮已覆盖绝大多数连续迭代场景。

参见已知问题：版本回退不会回退 `iterationContext`（见"未覆盖场景"）。

## 代码逻辑

### IterationRound 结构

```typescript
interface IterationRound {
  userPrompt: string;
  intent: Intent;
  pmSummary?: PmOutput;    // bug_fix/style_change 直接路径时为 undefined
  archDecisions?: string;  // 已废弃字段，保留向后兼容
  timestamp?: string;
}
```

`iterationContext` 存储在 `Project.iterationContext`（Prisma Json? 列），为 `IterationRound[]` 的 JSON 序列化，最大 5 条。

### buildPmHistoryContext(rounds)

```typescript
export function buildPmHistoryContext(rounds: readonly IterationRound[]): string
// 格式示例：
// 当前应用的迭代历史（请在此基础上分析增量需求，不要重新设计已有功能）：
//
// [第1轮] 用户："做一个任务管理应用"
//   意图：Todo App / 功能：任务列表、添加任务 / 持久化：localStorage
// [第2轮] 用户："加搜索功能" (功能迭代，跳过PM)
```

注入点：`feature_add` 流水线中 PM 请求的 `context` 字段。

### deriveArchFromFiles(files)

```typescript
export function deriveArchFromFiles(files: Record<string, string>): string
```

零 LLM 调用的静态分析，输出结构化文本：

- **文件结构**：每个文件的路径、行数、exports 列表（标注 default/named）
- **依赖关系**：局部依赖图（`/App.js → [/hooks/useTasks.js, /components/List.js]`）
- **状态管理**：扫描全量代码中的 `useState`、`useReducer`、`useContext`、`createContext` 关键词
- **持久化**：检测 `supabase`、`localStorage` 字符串出现

解析逻辑：

```typescript
const EXPORT_RE = /export\s+(default\s+)?(?:function|const|class)\s+(\w+)/g;
const IMPORT_RE = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
// 本地依赖：source 以 / ./ ../ 开头（排除 /supabaseClient.js）
```

注入点：Architect 请求的 context（prepend 到 PM 输出前）；直接路径（bug_fix/style_change）多文件 V1 时作为 `archSummary` 传入 `buildDirectMultiFileEngineerContext`（ADR 0018）。

### FIFO-5 管理与持久化

```
每轮生成完成后（包括直接路径）：
  const newRound: IterationRound = {
    userPrompt: prompt,
    intent,
    pmSummary: parsedPm ?? undefined,
    timestamp: roundTimestamp,
  }
  const updated = [...currentRounds, newRound].slice(-5)  // FIFO-5
  PATCH /api/projects/[id] { iterationContext: updated }   // fire-and-forget
  setIterationContext(updated)                             // 更新本地 state
```

### 页面加载恢复

`Workspace` 组件加载时从 `GET /api/projects/[id]` 获取 `project.iterationContext`，还原到 `iterationContext` state。页面刷新后历史轮次完整保留。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| feature_add 第 N 轮 | buildPmHistoryContext 注入前 5 轮历史 |
| bug_fix（跳过 PM） | 保存 round 但 pmSummary=undefined，历史记录延续 |
| Architect 生成 | deriveArchFromFiles 实时分析当前代码 |
| 页面刷新后继续迭代 | iterationContext 从 DB 加载，历史不丢失 |
| 直接路径多文件 V1 | deriveArchFromFiles 作为 archSummary 注入 Engineer |

## 未覆盖场景 / 已知限制

- **版本回退不回退 iterationContext**：点击历史版本恢复后，代码回退到旧版，但 iterationContext 仍保留最新轮次的摘要，PM 可能基于过时历史生成错误的 delta PRD。（已知问题，记录于 memory/project_rounds_no_rollback.md）
- **动态运行时状态检测**：`deriveArchFromFiles` 仅静态扫描代码字符串，无法检测条件性状态（如仅在某分支使用的 localStorage）。
- **超过 5 轮的历史被丢弃**：FIFO-5 截断后早期轮次不可恢复，长期迭代（>5 轮）的 PM 可能"忘记"早期功能。
- **pmSummary 为 undefined 的轮次**：直接路径轮次在 buildPmHistoryContext 中只显示意图标签，无功能细节，参考价值较低。

## 相关文件

- `lib/agent-context.ts` — `buildPmHistoryContext`、`buildPmIterationContext`、`deriveArchFromFiles`
- `lib/types.ts` — `IterationRound`、`PmOutput`
- `app/api/projects/[id]/route.ts` — PATCH 更新 iterationContext
- `components/workspace/workspace.tsx` — 持有 iterationContext state，加载时初始化
- `components/workspace/chat-area.tsx` — 生成完成后 fire-and-forget PATCH
