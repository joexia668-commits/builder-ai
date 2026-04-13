# ADR 0004 — Scaffold Warning Display: AgentState 更新对 done 状态不可见

**日期**: 2026-04-13
**背景**: scaffold validation 本地验证时发现

---

## 问题

`validateScaffold()` 检测到 phantom dep 后触发了警告（Console 日志确认），但聊天界面里完全看不到任何提示。

## 根因

设计 spec 写的是：

> 当 `validateScaffold` 产生 warnings 时，调用 `updateAgentState("architect", { status: "done", output: outputs.architect + "⚠ ..." })`

但 `chat-area.tsx` 的渲染逻辑是：

```typescript
{isGenerating &&
  AGENT_ORDER.map((role) => {
    const state = agentStates[role];
    if (state.status === "idle" || state.status === "done") return null;  // ← 这里
    return <AgentMessage ... />;
  })}
```

两个问题叠加：

1. **`done` 状态不渲染** — Architect 完成后状态就是 `"done"`，进入 engineer 阶段时 `updateAgentState("architect", { status: "done", ... })` 写入的内容永远不会显示。
2. **`isGenerating` 包裹** — 整个 agent streaming 区域只在生成过程中存在，生成结束后全部消失。Architect 的 streaming 卡片是短暂的，不是持久消息。

Agent streaming 卡片的设计定位是"过程可见性"（transient），不是持久记录。Spec 误把它当作可写入的持久 UI。

## 修复

在 `GenerationSession` 中增加独立的 `scaffoldWarnings: readonly string[]` 字段，与 `generationError` 平行：

```typescript
// lib/generation-session.ts
scaffoldWarnings: readonly string[];
```

在 `chat-area.tsx` 中用 `updateSession` 写入，并在聊天区域单独渲染为灰色 info 块，位置在 `generationError` 上方：

```tsx
{scaffoldWarnings.length > 0 && (
  <div className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg mx-2 text-xs text-gray-500">
    <span className="shrink-0">🔧</span>
    <span>已自动修正 scaffold：{scaffoldWarnings.join("；")}</span>
  </div>
)}
```

该块不受 `isGenerating` 控制，生成结束后依然可见，直到下次生成重置 session。

## 教训

Agent streaming 卡片是**过程 UI**，不是**状态 UI**。任何需要在生成完成后仍可见的信息，必须写入 session 的独立字段，不能通过 `updateAgentState` 传递。
