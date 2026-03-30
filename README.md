# BuilderAI

AI Agent 驱动的代码生成平台 — 输入一句需求，三个 Agent 协作为你生成完整 Web 应用。

## Demo

> 部署后在此填入线上链接

## Features

- **多 Agent 协作可视化** — PM → Architect → Engineer 顺序流转，每个 Agent 的思考过程实时可见
- **Sandpack 沙箱实时预览** — 生成的 React 应用在浏览器内编译运行，零服务器开销
- **BaaS 伪全栈** — 生成的应用通过 Supabase Anon Key 直连数据库，实现真实数据持久化
- **版本时间线 + 一键回滚** — 每次生成自动保存版本快照，可浏览历史并一键还原
- **多 AI 模型支持** — Gemini 2.0 Flash / Gemini 1.5 Pro / DeepSeek V3 / Groq Llama 3.3 70B，工厂模式统一抽象，工作区内可随时切换
- **用户偏好持久化** — 全局模型偏好写入 DB 跨会话保留，项目级模型设置可覆盖全局偏好
- **对话持久化** — 消息记录存入 DB，刷新页面后完整还原，无数据丢失
- **侧边栏项目管理** — 左侧边栏显示所有项目，点击切换，支持新建与删除（AlertDialog 二次确认）
- **代码编辑器** — Monaco Editor 内嵌，可直接编辑生成代码并实时刷新预览
- **设备预览切换** — Desktop / Tablet / Mobile 三档宽度切换，验证响应式布局
- **生成锁** — 生成过程中输入框置灰、Stop 按钮可见，AbortController 立即取消所有 SSE 请求
- **GitHub OAuth + Guest 匿名登录** — 支持两种登录方式，Guest 模式无需注册即可体验

## Tech Stack

| 层 | 技术 |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui, Sonner (toast) |
| Code Preview | Sandpack (CodesandBox), Monaco Editor |
| AI Provider | Gemini 2.0 Flash / Gemini 1.5 Pro / DeepSeek V3 / Groq Llama 3.3 70B |
| Auth | NextAuth.js v4 (GitHub OAuth + Guest session) |
| Database | Supabase (PostgreSQL) via Prisma ORM + PrismaPg Driver Adapter |
| Deployment | Vercel (Hobby) |
| Testing | Jest + React Testing Library (unit/integration), Playwright (E2E) |

## Architecture

### 生成流

```
User Input
    │
    ▼
ChatArea (SSE Client)
    │
    ├──► /api/generate (PM Agent)       ─┐
    ├──► /api/generate (Architect)       ├──► AIProvider Factory
    └──► /api/generate (Engineer)       ─┘         │
              │ code_complete                       ├── GeminiProvider   ──► Gemini API
              ▼                                     ├── DeepSeekProvider ──► DeepSeek API
      PreviewPanel (Sandpack)                       └── GroqProvider     ──► Groq API
              │
              ▼
      /api/versions (DB snapshot)
```

### 持久化流

```
User Message ──► /api/messages  ──► Message Table
AI Response  ──► /api/messages  ──► Message Table

Code Output  ──► /api/versions  ──► Version Table (immutable INSERT only)
                      │
         /api/versions/[id]/restore
                      │
                      └── 读取旧版本 code → INSERT 新版本记录（零数据丢失）
```

### 模型偏好 & 认证流

```
Login (GitHub OAuth / Guest) ──► NextAuth ──► User Table

Header Dialog ──► PATCH /api/user/preferences ──► User.preferredModel
ChatInput Selector ──► PATCH /api/projects/[id] ──► Project.preferredModel

resolveModelId 优先级链：
  request → project → user → AI_PROVIDER env → DEFAULT_MODEL_ID
```

**完整数据流：**
1. 用户输入需求 → ChatArea 发起串行 SSE 请求（PM → Architect → Engineer）
2. 每个 Agent 接收上游输出作为 context，流式输出到 UI
3. Engineer 输出经多层提取策略解析出 React 代码（代码围栏 → import/export 定位 → 尾部截断）
4. 代码注入 Sandpack 渲染预览，同时 INSERT 到 versions 表
5. 生成的应用通过 Supabase JS Client 直接读写 `dynamic_app_data` 表

## API Routes

| Method | Path | 说明 |
|--------|------|------|
| `GET` `POST` | `/api/projects` | 项目列表 / 创建项目 |
| `GET` `PATCH` `DELETE` | `/api/projects/[id]` | 项目详情 / 更新（名称、代码、preferredModel）/ 删除 |
| `POST` | `/api/generate` | SSE 流式 AI 生成，Edge Runtime，maxDuration=300s |
| `GET` `POST` | `/api/messages` | 消息列表（按项目）/ 保存消息 |
| `GET` `POST` | `/api/versions` | 版本列表（按项目）/ 创建版本快照 |
| `POST` | `/api/versions/[id]/restore` | 回滚到指定版本（INSERT 新版本记录） |
| `GET` `PATCH` | `/api/user/preferences` | 用户全局模型偏好读写 |
| `*` | `/api/auth/[...nextauth]` | NextAuth GitHub OAuth 路由 |
| `POST` | `/api/auth/guest` | Guest 匿名登录（创建持久化 User 记录） |

## Database Schema

```
User
  ├── id, name, email, image
  ├── preferredModel  String?   ← 全局模型偏好（EPIC 7）
  ├── Account[]                 ← NextAuth OAuth
  ├── Session[]                 ← NextAuth Session
  └── Project[]

Project
  ├── id, name, description
  ├── currentCode     String?   ← 当前预览代码
  ├── preferredModel  String?   ← 项目级模型覆盖（EPIC 7）
  ├── userId          ─────────► User
  ├── Version[]
  └── Message[]

Version
  ├── id, code, prompt
  ├── createdAt                 ← 不可变，只 INSERT
  └── projectId       ─────────► Project

Message
  ├── id, role, content, metadata (JSONB)
  ├── createdAt
  └── projectId       ─────────► Project

DynamicAppData
  ├── id, appId (= projectId), key
  ├── data            JSONB     ← 生成应用的运行时数据
  └── createdAt, updatedAt
```

## Project Structure

```
builder-ai/
├── app/
│   ├── page.tsx                        # 首页：项目列表（已登录）/ Landing（未登录）
│   ├── layout.tsx                      # 根布局（providers、字体、metadata）
│   ├── api/
│   │   ├── auth/[...nextauth]/         # NextAuth handler
│   │   ├── auth/guest/                 # Guest 登录
│   │   ├── generate/                   # SSE AI 生成（Edge Runtime）
│   │   ├── messages/                   # 消息 CRUD
│   │   ├── projects/                   # 项目 CRUD
│   │   ├── versions/                   # 版本快照 + 回滚
│   │   └── user/preferences/           # 用户偏好
│   └── project/[id]/page.tsx           # 工作区页面
│
├── components/
│   ├── agent/                          # Agent 状态栏、消息气泡、思考动画
│   ├── home/                           # 项目卡片、项目列表
│   ├── layout/                         # Header、登录按钮、Session Provider
│   ├── preview/                        # PreviewPanel、PreviewFrame、Monaco Editor、设备选择
│   ├── sidebar/                        # 对话侧边栏、项目列表项
│   ├── timeline/                       # 版本时间线
│   ├── ui/                             # shadcn/ui 组件（勿手动编辑）
│   └── workspace/                      # ChatArea、ChatInput、ModelSelector、Workspace
│
├── hooks/
│   ├── use-agent-stream.ts             # SSE 流式请求 + Agent 编排
│   ├── use-versions.ts                 # 版本 CRUD + 时间线状态
│   └── use-project.ts                  # 项目数据拉取
│
├── lib/
│   ├── ai-providers.ts                 # AIProvider 接口 + Gemini/DeepSeek/Groq 实现 + resolveModelId
│   ├── model-registry.ts              # 模型注册表（4 个模型定义）
│   ├── agent-context.ts               # Agent 上下文拼装
│   ├── generate-prompts.ts            # PM / Architect / Engineer 系统提示词
│   ├── extract-code.ts                # 多层代码提取策略
│   ├── sandpack-config.ts             # Sandpack 沙箱配置
│   ├── api-client.ts                  # fetchAPI / fetchSSE 统一抽象
│   ├── auth.ts                        # NextAuth 配置
│   ├── prisma.ts                      # Prisma Client 单例
│   └── types.ts                       # 共享 TypeScript 类型
│
├── e2e/                               # Playwright E2E 测试
├── __tests__/                         # Jest 单元 + 集成测试
└── prisma/schema.prisma               # 数据库 Schema
```

## 关键工程决策

### 1. 为什么选 Sandpack 而非 WebContainer
WebContainer 需要 COOP/COEP 响应头，Vercel Hobby 计划不支持自定义响应头配置，导致部署后预览必然失败。Sandpack 在普通 iframe 中运行，零部署风险，100% 可演示。

### 2. Hybrid Stable 渲染策略
放弃流式沙箱更新（每 chunk 刷新 Sandpack），改为等 `code_complete` 事件后一次性渲染。原因：Sandpack 频繁 remount 在流式场景下会产生闪烁和性能问题，稳定性 > 视觉花哨。

### 3. BaaS 伪全栈
生成的应用通过 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 直连 Supabase。Demo 阶段开启 `dynamic_app_data` 表的 anon key 读写权限。生产级方案应通过 Next.js API 路由用 service role key 代理写入。

### 4. 不可变版本设计
版本表只 INSERT 不 UPDATE/DELETE。回滚操作 = 读取旧版本 code → 创建新版本记录。以最低工程代价实现完整时间线，零数据丢失风险。

### 5. 多 Provider 工厂模式
`lib/ai-providers.ts` 实现统一的 `AIProvider` 接口，`lib/model-registry.ts` 维护模型注册表。模型选择优先级链：请求级 → 项目级 → 用户级 → 环境变量 → 默认值，无需修改代码即可切换 Provider。

### 6. Prisma Driver Adapter
使用 `PrismaPg` 适配器替代内置连接器，适配 Supabase Transaction Mode（端口 6543）的连接池限制（max=3）。生产环境配合 Vercel Serverless 函数的无状态特性，避免连接泄漏。

### 7. 生成锁 + AbortController
每次生成持有唯一 `AbortController` ref，Stop 按钮调用 `.abort()` 后 SSE 连接立即中止，UI 状态同步重置。生成进行中 ChatInput 整体 disabled，防止并发重复提交。

### 8. Guest 匿名账户设计
Guest 登录在 DB 中创建真实 `User` 记录（非 session-only），保证刷新后项目、消息、版本数据均可持久化。通过固定 guest email 格式防止重复创建，同一浏览器多次访问复用同一账户。

### 9. 代码提取多层策略
`extract-code.ts` 按优先级依次尝试：① Markdown 代码围栏提取 → ② `import`/`export default` 关键字定位 → ③ 尾部截断兜底。确保 Gemini / DeepSeek / Groq 各类输出格式均可提取出可运行的 React 代码。

## Testing

| 层级 | 框架 | 覆盖范围 |
|------|------|---------|
| Unit | Jest + React Testing Library | lib 函数、React 组件、Hook 行为 |
| Integration | Jest | API Route handlers（mock DB + mock Auth）|
| E2E | Playwright | 多 Agent 流程、版本时间线、持久化、模型选择、项目删除 |

```bash
npm test              # Unit + Integration tests (Jest)
npm run test:e2e      # E2E tests (Playwright)
```

## Local Development

### 前置条件

- Node.js 18+
- Supabase 项目（免费层即可）
- 至少一个 AI Provider 的 API Key（Gemini / DeepSeek / Groq 任选其一）
- GitHub OAuth App

### 安装

```bash
git clone <repo-url>
cd builder-ai
npm install
```

### 环境变量

复制 `.env.example` 为 `.env.local` 并填入：

```env
# Database (Supabase)
DATABASE_URL="postgresql://..."        # Connection pooling (port 6543)
DIRECT_URL="postgresql://..."          # Direct connection (port 5432)

# Auth
GITHUB_ID="your-github-oauth-app-id"
GITHUB_SECRET="your-github-oauth-app-secret"
NEXTAUTH_SECRET="random-32-char-string"
NEXTAUTH_URL="http://localhost:3000"

# AI (至少配置一个，优先使用 GOOGLE_GENERATIVE_AI_API_KEY)
GOOGLE_GENERATIVE_AI_API_KEY="AIza..."  # Gemini 2.0 Flash / 1.5 Pro
DEEPSEEK_API_KEY="sk-..."               # DeepSeek V3（可选）
GROQ_API_KEY="gsk_..."                  # Groq Llama 3.3 70B（可选）
AI_PROVIDER="gemini"                    # 默认 Provider：gemini | deepseek | groq（可选）

# Supabase (public — safe to expose)
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
```

### 数据库初始化

```bash
npx prisma db push
```

### 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

## Deployment (Vercel)

1. Fork 本仓库，在 Vercel 中导入项目
2. 配置上述所有环境变量
3. 将 GitHub OAuth App 的 callback URL 更新为 `https://<your-app>.vercel.app/api/auth/callback/github`
4. 运行 `npx prisma db push` 同步生产数据库 schema
5. Deploy ✅
