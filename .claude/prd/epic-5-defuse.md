# EPIC 5: Operation Defuse (排雷行动)

| Field | Value |
|-------|-------|
| Goal | 修复系统架构中 5 个可导致 Hackathon 评审现场崩溃的致命痛点 |
| Business Value | 直接决定 Demo 能否稳定跑完，评审成败的最后防线 |
| Total Estimate | ~2h |
| Phase | Phase 5 of 5（EPIC 4 完成后执行） |

## 功能描述

BuilderAI MVP 骨架已完成，但存在 5 个在评审现场有较高概率触发的系统性风险。本 EPIC 按爆炸半径从高到低逐一拆除，全部在独立 worktree 分支上执行，不污染 main。

## 架构决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| 是否引入 Vercel AI SDK | ❌ 不引入 | 现有手写 `ReadableStream` + SSE 对 Edge Runtime 完全兼容，切换 AI SDK 需同步改写前端 `use-agent-stream.ts`，属于破坏性重构，成本远超收益 |
| `lucide-react` 是否允许 | ✅ 允许 | `sandpack-config.ts` 已在 `customSetup.dependencies` 中预装 `lucide-react: ^0.300.0`，engineer prompt 中"用 emoji/SVG"的旧指令是错误的，Step 4 一并修正 |
| `sanitizeEngineerOutput` 放哪里 | `lib/extract-code.ts` | 不在 `route.ts` 内重复逻辑，保持路由 < 100 行的项目规范 |
| Edge Runtime 认证方案 | `getToken({ req })` 替换 `getServerSession` | `getServerSession` 依赖 Prisma，Prisma 不兼容 Edge Runtime |

## 执行原则

- 所有改动在 `defuse/operation-defuse` worktree 分支上进行
- worktree 路径：`/Users/log/Documents/workspace/Demo/builder-ai-defuse`
- 每个 Step 完成后立即验收，再进行下一步
- 不引入任何新功能，只做防御性修复

---

## Step 1 — Worktree 隔离（Git 地基）

**目标**: 创建独立分支，隔离全部排雷改动。

**操作**:
```bash
cd /Users/log/Documents/workspace/Demo
git worktree add builder-ai-defuse -b defuse/operation-defuse
```

**改动文件**: 无（纯 git 操作）

**验收**:
- [ ] `git worktree list` 确认新 worktree 存在
- [ ] worktree 处于 `defuse/operation-defuse` 分支
- [ ] 与 `main` 分支完全一致（零额外改动）

---

## Step 2 — Pain Point 5: BaaS 安全漏洞（RLS 策略）

**痛点**: 前端暴露 Supabase Anon Key，任何人可跨 `projectId` 读写 `dynamic_app_data` 表。

**根因**: Supabase 标准 RLS 依赖 `auth.uid()`，本项目使用 NextAuth，两者不互通，`auth.uid()` 恒为 null，因此 RLS 策略必须改用 `appId` 作为隔离键。

**改动文件**:
- 新建 `supabase/rls-policies.sql`

**SQL 内容**:
```sql
-- 启用 RLS
ALTER TABLE dynamic_app_data ENABLE ROW LEVEL SECURITY;

-- SELECT：只允许读取 appId 匹配当前请求的行
CREATE POLICY "select_by_app_id" ON dynamic_app_data
  FOR SELECT USING (app_id = current_setting('request.headers')::json->>'x-app-id');

-- INSERT：只允许写入 appId 与请求头一致的行
CREATE POLICY "insert_by_app_id" ON dynamic_app_data
  FOR INSERT WITH CHECK (app_id = current_setting('request.headers')::json->>'x-app-id');

-- UPDATE：限制更新范围
CREATE POLICY "update_by_app_id" ON dynamic_app_data
  FOR UPDATE USING (app_id = current_setting('request.headers')::json->>'x-app-id');
```

> **注意**: 此 SQL 需在 Supabase Dashboard → SQL Editor 中手动执行。
> Demo 阶段如 RLS 导致 Sandpack 应用读写失败，可暂时保持 anon key 开放，评审时口头说明 RLS 设计思路。

**验收**:
- [ ] `supabase/rls-policies.sql` 文件存在且内容正确
- [ ] Supabase Dashboard 确认策略已应用（或记录为待应用）
- [ ] Sandpack 生成的应用仍可正常读写 `dynamic_app_data`

---

## Step 3 — Pain Point 4: Vercel 超时断流（Edge Runtime）

**痛点**: Vercel Serverless 60s 硬超时，Engineer Agent 输出最长，极易在生成中途被截断。

**改动文件**:
- `app/api/generate/route.ts`

**改动内容**:
1. 顶部添加 `export const runtime = 'edge';`
2. 添加 `export const maxDuration = 300;`（Vercel Pro 生效）
3. 将 `getServerSession(authOptions)` 替换为 Edge 兼容的 `getToken({ req })`:
   ```typescript
   import { getToken } from 'next-auth/jwt';
   const token = await getToken({ req });
   if (!token) return new Response('Unauthorized', { status: 401 });
   ```

**验收**:
- [ ] 本地 `next dev` 启动无报错
- [ ] `/api/generate` 路由在 Edge 运行时下正常返回 SSE 流
- [ ] 认证拦截仍然生效（未登录返回 401）

---

## Step 4 — Pain Point 1 + 3: LLM 非确定性 & 沙箱依赖黑盒

**痛点 1**: LLM 偶尔返回带 Markdown fence 或额外说明文字的输出，导致 Sandpack 解析失败。

**痛点 3**: AI 可能引入 Sandpack 沙箱中未安装的 npm 包，导致运行时报错。

**改动文件**:
- `lib/generate-prompts.ts`
- `lib/extract-code.ts`

### `generate-prompts.ts` 改动

在 `engineer` 和 `architect` 的 system prompt 中加入最高级别禁令：

```
【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）

绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。
```

### `extract-code.ts` 改动

新增带注解 fence 的正则预处理（处理 ` ```jsx filename=App.jsx ` 格式）：

```typescript
// Layer 0（新增）：带注解的 fence，如 ```jsx filename=App.jsx
const annotatedFenceMatch = raw.match(/```(?:jsx?|tsx?)[^\n]*\n([\s\S]*?)```/);
if (annotatedFenceMatch) return annotatedFenceMatch[1].trim();

// Layer 1（已有）：标准 fence
// Layer 2（已有）：import 到 export default 截取
// Layer 3（已有）：原始返回
```

**验收**:
- [ ] 向 LLM 发送测试请求，返回值不含 Markdown fence
- [ ] 故意让 LLM 返回带注解 fence 的代码，`extractCode` 能正确解析
- [ ] Sandpack 预览区不出现"找不到模块"错误

---

## Step 5 — Pain Point 2: 状态机爆炸（全局生成锁）

**痛点**: 用户在 Agent 流式生成期间点击时间线版本节点，触发并发代码更新，导致 Sandpack 卡死或渲染错乱。

**改动文件**:
- `components/timeline/version-timeline.tsx`
- `components/preview/preview-panel.tsx`
- `components/workspace/workspace.tsx`

### `version-timeline.tsx` 改动

添加 `isGenerating` prop，生成期间禁用所有版本节点按钮：

```typescript
interface VersionTimelineProps {
  // ...existing props
  isGenerating?: boolean;
}

// 版本节点按钮
<button
  disabled={isGenerating}
  className={cn(..., isGenerating && 'pointer-events-none opacity-40')}
>
```

### `preview-panel.tsx` 改动

生成期间覆盖全屏半透明遮罩，阻断所有点击穿透：

```typescript
{isGenerating && (
  <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-32" />
      <p className="text-sm text-muted-foreground">正在生成中...</p>
    </div>
  </div>
)}
```

### `workspace.tsx` 改动

确认 preview 容器设置 `position: relative`，使遮罩 `absolute inset-0` 定位正确：

```typescript
<div className="relative flex-1 overflow-hidden">
  <PreviewPanel isGenerating={isGenerating} ... />
</div>
```

**验收**:
- [ ] 生成期间时间线所有按钮呈灰色禁用状态，点击无反应
- [ ] 生成期间预览区出现半透明遮罩，无法点击穿透
- [ ] 生成完成后遮罩自动消失，时间线恢复可点击

---

## 完整文件改动地图

| Step | 文件 | 改动类型 | 风险 |
|------|------|---------|------|
| 1 | git worktree | 分支创建 | 无 |
| 2 | `supabase/rls-policies.sql` | 新建 SQL 脚本 | 中（需 Dashboard 手动执行） |
| 3 | `app/api/generate/route.ts` | Edge 运行时 + auth 修复 | 中（next-auth 兼容性） |
| 4 | `lib/generate-prompts.ts` | 强化 prompt 约束 | 低 |
| 4 | `lib/extract-code.ts` | 新增 fence 正则层 | 低 |
| 5 | `components/preview/preview-panel.tsx` | 全屏生成遮罩 | 低 |
| 5 | `components/timeline/version-timeline.tsx` | 按钮禁用 | 低 |
| 5 | `components/workspace/workspace.tsx` | 容器定位确认 | 低 |

---

## 验收标准

- [ ] 所有改动在 `defuse/operation-defuse` 分支，main 未污染
- [ ] LLM 输出包含 fence 时，预览区仍正常渲染
- [ ] LLM 输出包含禁用包时，Sandpack 给出明确错误（不静默崩溃）
- [ ] 生成期间 Chat 输入框、时间线按钮全部禁用
- [ ] `/api/generate` 在 Edge Runtime 下无超时
- [ ] `supabase/rls-policies.sql` 文件存在，含完整策略说明
- [ ] 完整流程走通：登录 → 创建项目 → 生成 → 预览 → 版本回滚

## 依赖

- EPIC 0-4 全部完成
