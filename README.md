# BuilderAI

AI Agent 驱动的代码生成平台 — 输入一句需求，三个 Agent 协作为你生成完整 Web 应用。

## Demo

> 部署后在此填入线上链接

## Features

- **多 Agent 协作可视化** — PM → Architect → Engineer 顺序流转，每个 Agent 的思考过程实时可见
- **多文件分层生成** — Architect 输出 JSON Scaffold，Engineer 按拓扑排序分层并行生成各文件，AgentStatusBar 实时显示层进度
- **Sandpack 沙箱实时预览** — 生成的多文件 React 应用在浏览器内编译运行，零服务器开销
- **BaaS 伪全栈** — 生成的应用通过 Supabase Anon Key 直连数据库，实现真实数据持久化
- **版本时间线 + 一键回滚** — 每次生成自动保存多文件版本快照，可浏览历史并一键还原
- **多 AI 模型支持** — Gemini 2.0 Flash / Gemini 1.5 Pro / DeepSeek V3 / Groq Llama 3.3 70B，工厂模式统一抽象，工作区内可随时切换
- **用户偏好持久化** — 全局模型偏好写入 DB 跨会话保留，项目级模型设置可覆盖全局偏好
- **对话持久化** — 消息记录存入 DB，刷新页面后完整还原，无数据丢失
- **侧边栏项目管理** — 左侧边栏显示所有项目，点击切换，支持新建与删除（AlertDialog 二次确认）
- **多文件代码编辑器** — Monaco Editor 内嵌文件 tab 栏，可直接编辑各文件并实时刷新预览
- **设备预览切换** — Desktop / Tablet / Mobile 三档宽度切换，验证响应式布局
- **生成锁** — 生成过程中输入框置灰、Stop 按钮可见，AbortController 立即取消所有 SSE 请求
- **GitHub OAuth + Guest 匿名登录** — 支持两种登录方式，Guest 模式无需注册即可体验

## Tech Stack

| 层 | 技术 |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui, Sonner (toast) |
| Code Preview | Sandpack (CodesandBox), Monaco Editor (multi-file tab bar) |
| AI Provider | Gemini 2.0 Flash / Gemini 1.5 Pro / DeepSeek V3 / Groq Llama 3.3 70B |
| AI SDK | @anthropic-ai/sdk (预留), zod v4 (schema 校验) |
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
    ├──► /api/generate (PM Agent)       → JSON PmOutput (intent, features, persistence, modules)
    ├──► /api/generate (Architect)      → JSON ScaffoldData (files[], sharedTypes, designNotes)
    │         │ extractScaffold()
    │         │ topologicalSort()  → layers[][]
    │         │
    │    for each layer (sequential):
    │      for each file in layer (parallel):
    └──────► /api/generate (Engineer × N)
                  │ files_complete / code_complete
                  ▼
          PreviewPanel (Sandpack multi-file)
                  │
                  ▼
          /api/versions { code, files }  (DB snapshot)
```

AIProvider Factory:
- GeminiProvider   → Gemini API
- DeepSeekProvider → DeepSeek API
- GroqProvider     → Groq API

### 持久化流

```
User Message ──► /api/messages  ──► Message Table
AI Response  ──► /api/messages  ──► Message Table

Files Output ──► /api/versions  { code: "/App.js", files: Record<string,string> }
                      ──► Version Table (immutable INSERT only)
                      │
         /api/versions/[id]/restore
                      │
                      └── getVersionFiles(version) → INSERT 新版本记录（零数据丢失）
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
1. 用户输入需求 → ChatArea 发起串行 SSE 请求（PM → Architect）
2. PM 以 JSON 格式输出 `PmOutput`（intent、features、persistence、modules）
3. Architect 以 JSON 格式输出 `ScaffoldData`（files[]、sharedTypes、designNotes）
4. `extractScaffold()` 解析 Scaffold → `topologicalSort()` 按依赖关系分层
5. ChatArea 按层顺序、层内并行调用 Engineer，每文件独立一次 SSE 请求
6. 所有文件汇聚为 `Record<string, string>` → 注入 Sandpack 渲染，INSERT 到 versions 表（含 `files` 字段）
7. 生成的应用通过 Supabase JS Client 直接读写 `dynamic_app_data` 表

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
  ├── isGuest         Boolean   ← Guest 匿名账户标记
  ├── preferredModel  String?   ← 全局模型偏好
  ├── createdAt, updatedAt
  ├── Account[]                 ← NextAuth OAuth
  ├── Session[]                 ← NextAuth Session
  └── Project[]

Project
  ├── id, name, description
  ├── preferredModel  String?   ← 项目级模型覆盖（优先于用户全局偏好）
  ├── userId          ─────────► User
  ├── createdAt, updatedAt
  ├── Version[]
  └── Message[]

Version                         ← 不可变，只 INSERT，不 UPDATE/DELETE
  ├── id, code
  ├── files           Json?     ← 多文件 Record<string,string>（新版本写入此字段）
  ├── versionNumber   Int       ← 项目内自增，unique([projectId, versionNumber])
  ├── description     String?   ← 生成时 prompt 的前 80 字符
  ├── agentMessages   Json?     ← 保留字段，供未来使用
  ├── createdAt
  └── projectId       ─────────► Project

Message
  ├── id, role, content
  ├── metadata        JSONB     ← { agentName?, agentColor?, thinkingDuration? }
  ├── createdAt
  └── projectId       ─────────► Project

DynamicAppData                  ← 生成应用的运行时数据
  ├── id (uuid), appId (= projectId), key
  ├── data            JSONB
  ├── createdAt, updatedAt
  └── unique([appId, key])
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
│   ├── agent/                          # AgentStatusBar（层进度）、AgentCard、AgentMessage、ThinkingIndicator
│   ├── home/                           # 项目卡片、项目列表
│   ├── layout/                         # Header、登录按钮、Session Provider
│   ├── preview/                        # PreviewPanel、PreviewFrame、MultiFileEditor（tab 栏）、设备选择
│   ├── sidebar/                        # 对话侧边栏、项目列表项
│   ├── timeline/                       # 版本时间线
│   ├── ui/                             # shadcn/ui 组件（勿手动编辑）
│   └── workspace/                      # ChatArea（多层并行 Engineer 编排）、ChatInput、ModelSelector、Workspace
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
│   ├── generate-prompts.ts            # PM / Architect / Engineer 系统提示词（含多文件模板）
│   ├── extract-code.ts                # 多层代码提取策略（代码围栏 → import/export → 尾部截断）
│   ├── extract-json.ts                # JSON 解析：extractPmOutput / extractScaffold / extractArchOutput
│   ├── topo-sort.ts                   # 拓扑排序：按依赖分层，同层文件可并行生成
│   ├── version-files.ts               # getVersionFiles()：向后兼容读取 code/files 字段
│   ├── sandpack-config.ts             # Sandpack 沙箱配置（支持 string | Record<string,string> 输入）
│   ├── api-client.ts                  # fetchAPI / fetchSSE 统一抽象
│   ├── auth.ts                        # NextAuth 配置
│   ├── prisma.ts                      # Prisma Client 单例
│   └── types.ts                       # 共享类型：ScaffoldData, ScaffoldFile, EngineerProgress, PmOutput, ArchOutput
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

### 10. 多文件分层并行生成
Architect 以 JSON `ScaffoldData` 输出完整文件图，`topologicalSort()` 将文件按依赖关系分层。同层文件没有互相依赖，可并发调用 Engineer；层间严格顺序执行，确保后续文件能 import 前置文件的导出。每个文件独立一次 `/api/generate` SSE 请求，绕过单次请求的 token 上限瓶颈。

### 11. 向后兼容的版本读取
`getVersionFiles()` 统一封装版本读取：新版本从 `files` 字段返回 `Record<string,string>`，老版本（只有 `code` 字段）包装为 `{ "/App.js": code }`。UI 层无感知历史数据格式差异。

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
