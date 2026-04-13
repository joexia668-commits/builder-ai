# ADR 0005 — MessageRole 缺失 "system"、metadata 缺失 type 字段

**日期**: 2026-04-13  
**背景**: 用户在 Vercel 构建日志中发现，触发时机：scaffold validation 合并到 main 推送远程后

---

## 问题描述

Vercel CI 构建失败，报两个 TypeScript 类型错误：

**错误 1** (`chat-area.tsx:531`):
```
Type '"system"' is not assignable to type 'MessageRole'.
```

**错误 2** (`chat-area.tsx:533`):
```
Object literal may only specify known properties, and 'type' does not exist in type
'{ agentName?: string | undefined; agentColor?: string | undefined; thinkingDuration?: number | undefined; }'
```

---

## 根因

`lib/types.ts` 中两处类型定义不完整：

1. `MessageRole = "user" | AgentRole` — 只涵盖用户消息和三个 Agent 角色，未包含 `"system"`
2. `ProjectMessage.metadata` 只声明了 `agentName / agentColor / thinkingDuration` 三个字段，未声明 `type`

scaffold validation 功能在持久化警告消息时使用了 `role: "system"` 和 `metadata: { type: "scaffold_warning" }`，在本地 `next dev` 下类型检查是宽松的（或跳过），推送到 Vercel 后 `npm run build` 的严格类型检查才捕获到。

---

## 为什么本地没暴露

Next.js 的 `next dev` 使用 Babel/SWC 编译，默认不阻塞运行；`next build` 会完整运行 `tsc --noEmit`，两者行为不一致，导致本地验证通过但 CI 报错。

---

## 修复

`lib/types.ts`：

```diff
-export type MessageRole = "user" | AgentRole;
+export type MessageRole = "user" | "system" | AgentRole;

 export interface ProjectMessage {
   metadata?: {
     agentName?: string;
     agentColor?: string;
     thinkingDuration?: number;
+    type?: string;
   } | null;
 }
```

---

## 安全性说明

`AgentMessage` 组件在渲染前通过 `metadata.type === "scaffold_warning"` 短路，`"system"` role 的消息永远不会走到 `AGENTS[role]` 查找，不会产生 `undefined` 访问。

---

## 预防措施

- 本地提交前应运行 `npm run build`（而非只运行 `next dev`）确认类型检查通过
- 新增消息角色或 metadata 字段时，同步更新 `lib/types.ts` 中的类型定义
