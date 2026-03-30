# EPIC 0: 项目脚手架 + 认证 + 数据库

| Field | Value |
|-------|-------|
| Goal | 搭建可运行的项目骨架，含认证（GitHub + Guest）、数据库、基础布局 |
| Business Value | 所有后续 Phase 的基础设施 |
| Total Estimate | ~1h |
| Phase | Phase 0 of 4 |
| Status | **大部分已完成，需补充 Guest Login** |

## 功能描述

初始化 Next.js 项目，配置 Prisma + Supabase、NextAuth + GitHub OAuth + Guest 匿名登录、Tailwind + shadcn/ui，完成三栏布局骨架。

## 实现要点

- Next.js 14 App Router + TypeScript (strict mode)
- Prisma ORM 连接 Supabase PostgreSQL
- NextAuth GitHub OAuth 认证
- **Guest 匿名登录（新增）**
- Tailwind CSS + shadcn/ui 组件库
- 统一 API 客户端 `fetchAPI()` / `fetchSSE()`（预留前后端分离，内置 SSE 自定义事件处理）
- 环境变量：`NEXT_PUBLIC_API_URL`, `DATABASE_URL`, `DIRECT_URL`, `GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET`

## Guest Login 实现方案（新增）

### 设计理念
评委/体验者无需 GitHub 账号，一键进入，零摩擦。

### 实现路径
1. Login 页面增加 "Try as Guest" 按钮
2. 点击后调用 `POST /api/auth/guest` 端点
3. 后端生成 `guest_[uuid]` 用户，写入 User 表（标记 `isGuest: true`）
4. 使用 NextAuth 的 `CredentialsProvider` 签发 session
5. **前端将 `guestId` 写入 `localStorage`（key: `builder_ai_guest_id`）**
6. Guest 用户享有与 OAuth 用户完全相同的功能

### Guest Session 持久化（兜底机制）

```typescript
// 成功登录后写入 localStorage
localStorage.setItem('builder_ai_guest_id', userId);

// 登录页检测 localStorage，提供"恢复上一次访客会话"按钮
const savedGuestId = localStorage.getItem('builder_ai_guest_id');
// 若存在 → 显示 "Continue as Guest (restore session)" 按钮
// 点击 → signIn("credentials", { guestId: savedGuestId })
```

**兜底场景**：评委不小心清空 Cookie 退出，可通过 localStorage 中的 ID 恢复原有工作区，无需重建项目。

### Prisma Schema 变更
```prisma
model User {
  // ... existing fields ...
  isGuest   Boolean  @default(false)  // 新增：标记是否为 Guest 用户
}
```

### API 端点
```
POST /api/auth/guest
  Body: { guestId?: string }         // 恢复模式时传入已有 guestId
  Response: { userId: "guest_xxx", sessionToken: "..." }
  行为：
    - 无 guestId → 创建新 Guest User → 签发 session
    - 有 guestId → 查找已有 User → 签发 session（恢复会话）
```

### 前端变更
```typescript
// app/login/page.tsx
// 1. 增加 "Try as Guest" 按钮 → signIn("credentials", { guest: true })
// 2. 检测 localStorage.getItem('builder_ai_guest_id')
//    → 若存在，显示 "Continue as Guest" 恢复按钮
//    → 点击 → signIn("credentials", { guestId: savedGuestId })
```

## 数据结构 (Prisma Schema)

```prisma
model User {
  id        String   @id @default(cuid())
  name      String?
  email     String?  @unique
  image     String?
  isGuest   Boolean  @default(false)   // 新增
  projects  Project[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Project {
  id          String    @id @default(cuid())
  name        String
  description String?
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  versions    Version[]
  messages    Message[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model Version {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id])
  versionNumber Int
  code          String   @db.Text
  description   String?
  agentMessages Json?
  createdAt     DateTime @default(now())
}

model Message {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id])
  role      String   // 'user' | 'pm' | 'architect' | 'engineer'
  content   String   @db.Text
  metadata  Json?
  createdAt DateTime @default(now())
}
```

## 页面布局

```
┌──────────────────────────────────────────────────────┐
│  Header: Logo(BuilderAI) | User Avatar | Sign Out     │
├──────────┬───────────────────────────┬───────────────┤
│ 对话列表  │  Agent 状态栏（横排）      │               │
│ (240px)  │  [PM📋]→[Arch🏗]→[Eng👨‍💻] │  Monaco Editor│
│          ├───────────────────────────┤  / Preview    │
│ ● 项目A  │  Chat 消息区               │  (flex-1)     │
│ ● 项目B  │  (Agent 消息气泡)          │               │
│ ● 项目C  │                           │               │
│ + 新建   ├───────────────────────────┤               │
│          │  Input: [描述需求...][发送]│               │
└──────────┴───────────────────────────┴───────────────┘
```

## Supabase RLS 策略（Guest 数据隔离）

针对 `dynamic_app_data` 表（Epic 2 中生成的 App 写入数据），必须配置行级安全策略，防止 Guest A 读取 Guest B 的数据。

### RLS Policy（在 Supabase 控制台执行）

```sql
-- 启用 RLS
ALTER TABLE dynamic_app_data ENABLE ROW LEVEL SECURITY;

-- SELECT 策略：只能读自己的数据
CREATE POLICY "Users can only read own app data"
  ON dynamic_app_data
  FOR SELECT
  USING (app_id = current_setting('request.jwt.claims', true)::jsonb->>'userId');

-- INSERT 策略：只能写自己的 appId
CREATE POLICY "Users can only insert own app data"
  ON dynamic_app_data
  FOR INSERT
  WITH CHECK (app_id = current_setting('request.jwt.claims', true)::jsonb->>'userId');
```

> **为什么要做**：Guest 用户没有邮箱关联，无法通过邮箱做唯一约束。若不加 RLS，任何知道 projectId 的人都能读取其他 Guest 的生成数据（如密码本、个人信息等），是低级安全漏洞。

---

## `fetchAPI` / `fetchSSE` 封装规范

`lib/api-client.ts` 中的 `fetchSSE()` 函数应内置对 SSE 自定义事件的处理能力，为 Epic 2 的混合流式渲染（`code_complete`、`agent_done` 等事件）做准备。

### 接口定义

```typescript
interface SSEEventHandlers {
  onMessage?: (data: string) => void;          // data: 事件数据
  onCodeComplete?: (code: string) => void;     // 代码生成完成
  onAgentDone?: (agent: string) => void;       // 单个 agent 完成
  onError?: (error: string) => void;           // 错误事件
  onDone?: () => void;                         // 流结束
}

export async function fetchSSE(
  path: string,
  options?: RequestInit,
  handlers?: SSEEventHandlers
): Promise<void>
```

### 事件协议（服务端输出格式）

```
event: message
data: {"type":"text","content":"..."}

event: code_complete
data: {"code":"<!DOCTYPE html>..."}

event: agent_done
data: {"agent":"engineer","duration":12400}

event: done
data: [DONE]
```

> **为什么要做**：如果 `fetchSSE` 只处理 `data:` 行而忽略 `event:` 字段，Phase 2 的 `code_complete` 事件将无法被正确捕获，预览刷新时机会不准确。提前定义好协议，Phase 2 只需补充服务端 emit 逻辑即可。

---

## 验收标准

- [x] `npm run dev` 启动无报错
- [x] GitHub OAuth 登录/登出正常
- [ ] **Guest 匿名登录正常（一键进入，无需 GitHub）**
- [x] 三栏布局渲染正确（左侧对话列表 + 中间 Chat + 右侧编辑/预览）
- [x] Prisma 连接 Supabase 成功
- [x] `fetchAPI()` 封装就绪
- [ ] **`fetchSSE()` 支持自定义 SSE 事件（`code_complete`、`agent_done`）**
- [ ] **Guest Login 成功后 `guestId` 写入 `localStorage`**
- [ ] **登录页检测 `localStorage`，提供"恢复访客会话"按钮**
- [ ] **`dynamic_app_data` 表 RLS 策略已在 Supabase 配置**
- [x] 未登录时重定向到登录页

## 依赖

- 无（第一个 Phase）
