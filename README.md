# BuilderAI

输入一句需求，三个 AI Agent 协作为你生成完整的多文件 Web 应用，并在浏览器内实时预览。

**线上体验：** [https://builder-ai-v2.vercel.app](https://builder-ai-v2.vercel.app)

---

## 是什么

BuilderAI 是一个 AI 驱动的代码生成平台。你描述想要什么，系统自动完成需求分析、架构设计、代码生成，生成的应用直接在浏览器沙箱里运行，支持数据持久化、版本回滚、多模型切换。

核心流程：用户输入 → 意图分类 → Agent 编排（PM → Architect → Engineer）→ Sandpack 预览。

---

## Features

- **多 Agent 协作** — PM → Architect → Engineer 顺序流转，实时可见每个 Agent 的思考过程
- **意图路由** — 自动识别 bug_fix / style_change / feature_add / new_project，修 bug 和调样式直接跳过前两个 Agent，响应速度提升 2–3 倍
- **分层并行生成** — Architect 输出文件依赖图，Engineer 按拓扑排序分层并行生成，绕过单次 token 上限
- **迭代上下文记忆** — 新增功能时 PM 和 Engineer 均感知上一版本状态，输出增量而非重建
- **Sandpack 沙箱预览** — 多文件 React 应用在浏览器内编译运行，零服务器开销
- **BaaS 数据持久化** — 生成的应用通过 Supabase Anon Key 直连数据库
- **版本时间线** — 每次生成自动快照，可浏览历史并一键回滚
- **多模型支持** — Gemini 2.0 Flash / DeepSeek V3 / Groq Llama 3.3 70B，工作区内随时切换
- **灵活登录方式** — GitHub OAuth、Email Magic Link、Demo 模式，无需注册即可快速体验

---

## Tech Stack

| 层 | 技术 |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| UI | shadcn/ui |
| Code Preview | Sandpack (CodeSandbox in-browser), Monaco Editor |
| AI Providers | Gemini 2.0 Flash / DeepSeek V3 / Groq Llama 3.3 70B |
| Auth | NextAuth.js v4 (GitHub OAuth, Email Magic Link, Demo Mode) |
| Email | Resend (Email Magic Link provider) |
| Database | Supabase (PostgreSQL) via Prisma ORM |
| Deployment | Vercel |
| Testing | Jest + React Testing Library, Playwright (E2E) |

---

## Quick Start

**前置条件：** Node.js 18+、Supabase 项目、至少一个 AI API Key、GitHub OAuth App（可选）、Resend 账户（用于 Email Magic Link）

```bash
git clone <repo-url>
cd builder-ai
npm install
```

复制 `.env.example` 为 `.env.local`，填入所需的环境变量：

```env
# Database
DATABASE_URL="postgresql://..."        # Supabase 连接池，端口 6543
DIRECT_URL="postgresql://..."          # 直连，端口 5432（用于 prisma db push）

# Auth
GITHUB_ID="..."                        # 可选，GitHub OAuth
GITHUB_SECRET="..."
RESEND_API_KEY="re_..."                # Email Magic Link（推荐）
EMAIL_FROM="BuilderAI <onboarding@resend.dev>"
NEXTAUTH_SECRET="random-32-char-string"
NEXTAUTH_URL="http://localhost:3000"

# Demo Mode（可选）
DEMO_USER_ID="..."                     # 你的 userId（开发者账户）
DEMO_VIEWER_ID="..."                   # 演示用 userId

# AI（至少配置一个）
GOOGLE_GENERATIVE_AI_API_KEY="AIza..."
DEEPSEEK_API_KEY="sk-..."              # 可选
GROQ_API_KEY="gsk_..."                 # 可选

# Supabase（前端可见）
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
```

### 环境变量详解

| 变量 | 用途 | 必需 | 说明 |
|------|------|------|------|
| `GITHUB_ID` / `GITHUB_SECRET` | GitHub OAuth 登录 | 否 | 在 GitHub Settings 创建 OAuth App |
| `RESEND_API_KEY` | Email Magic Link 登录 | 是 | 登陆 [resend.com](https://resend.com) 获取 API key |
| `EMAIL_FROM` | 邮件发件人 | 是 | Demo 模式下可用 `onboarding@resend.dev`，生产环境需验证自己的域名 |
| `DEMO_USER_ID` | 演示账户开发者 ID | 否 | 设置后，demo 用户只能查看该账户的项目（只读）|
| `DEMO_VIEWER_ID` | 演示账户用户 ID | 否 | 第一次启动后由系统生成，需手动复制到 `.env.local` |

### 启动项目

```bash
npx prisma db push   # 初始化数据库
npm run dev          # → http://localhost:3000
```

### 配置 Demo 模式（可选）

如果要启用演示账户快速登录，需要配置 `DEMO_USER_ID` 和 `DEMO_VIEWER_ID`：

1. **启动项目**（不配 DEMO_VIEWER_ID）：`npm run dev`
2. **查找 DEMO_VIEWER_ID**：启动日志中会打印自动生成的 demo 用户 ID
3. **复制 ID**：将日志中的 ID 复制到 `.env.local` 的 `DEMO_VIEWER_ID` 字段
4. **配置 DEMO_USER_ID**：
   - 用浏览器登录应用（GitHub 或 Email 均可）
   - 打开 Prisma Studio：`npx prisma studio`
   - 在 User 表中找到你的账户，复制 `id` 字段
   - 将其设置为 `DEMO_USER_ID`
5. **重启项目**：`npm run dev`，点击登录页的"查看演示项目"按钮即可预览

> 修改 `lib/` 下配置文件后用 `npm run dev:clean` 清除 webpack 缓存重启。

---

## Multi-Agent Orchestration

系统按意图将请求路由到不同编排路径：

| 意图 | 触发条件 | Agent 路径 | 典型耗时 |
|------|---------|-----------|---------|
| `bug_fix` | "修复/bug/报错" 等关键词 | Engineer only | ~20s |
| `style_change` | "颜色/样式/dark mode" 等关键词 | Engineer only | ~20s |
| `new_project` | 无现有代码，或"重新做"关键词 | PM → Architect → Engineer × N | ~60s |
| `feature_add` | 默认（有现有代码） | PM → Architect → Engineer × N（含 V1 上下文） | ~60s |

全流程路径中，Engineer 按文件依赖关系**分层串行、层内并行**生成：同层文件并发调用 `/api/generate`，层间严格有序，每层完成后才进入下一层。

内置三级容错：全层重试 → 逐文件回退 → 熔断（已完成文件正常渲染）。

→ **[完整流程图、场景示例、容错详情](docs/examples/agent-orchestration.md)**

---

## Project Structure

```
builder-ai/
├── app/
│   ├── page.tsx                      # 首页：项目列表 / Landing
│   ├── api/
│   │   ├── auth/                     # NextAuth + Guest 登录
│   │   ├── generate/                 # SSE AI 生成（Edge Runtime）
│   │   ├── messages/                 # 消息 CRUD
│   │   ├── projects/                 # 项目 CRUD
│   │   ├── versions/                 # 版本快照 + 回滚
│   │   ├── user/preferences/         # 用户偏好
│   │   ├── export/                   # ZIP 导出
│   │   └── deploy/                   # Vercel 部署
│   └── project/[id]/page.tsx         # 工作区页面
│
├── components/
│   ├── agent/                        # AgentStatusBar、AgentCard、AgentMessage
│   ├── preview/                      # PreviewPanel、MultiFileEditor、设备切换
│   ├── timeline/                     # 版本时间线
│   ├── workspace/                    # ChatArea（核心编排）、ChatInput、Workspace
│   └── ui/                           # shadcn/ui（勿手动编辑）
│
├── lib/
│   ├── intent-classifier.ts          # classifyIntent()：关键词路由
│   ├── agent-context.ts              # 各路径上下文拼装
│   ├── generate-prompts.ts           # Agent 系统提示词 + Snip 压缩
│   ├── extract-code.ts               # 代码提取 + findMissingLocalImports()
│   ├── engineer-circuit.ts           # 三级容错重试
│   ├── topo-sort.ts                  # 拓扑排序分层
│   ├── sandpack-config.ts            # Sandpack 配置 + 缺失模块 stub 注入
│   ├── ai-providers.ts               # AIProvider 接口 + 三个 Provider 实现
│   ├── version-files.ts              # 向后兼容版本读取
│   ├── error-codes.ts                # ErrorCode 枚举与用户可见文案
│   └── api-client.ts                 # fetchAPI / fetchSSE 统一抽象
│
├── __tests__/                        # Jest 单元 + 集成测试
├── e2e/                              # Playwright E2E 测试
└── prisma/schema.prisma              # 数据库 Schema
```

→ **[完整 API Routes](docs/examples/api-routes.md)**  
→ **[Database Schema 详情](docs/examples/database-schema.md)**

---

## Key Engineering Decisions

| 决策 | 原因 |
|------|------|
| Sandpack 而非 WebContainer | Vercel Hobby 不支持 COOP/COEP 响应头，WebContainer 无法部署 |
| 一次性渲染而非流式更新 Sandpack | 频繁 remount 产生闪烁，稳定性优先 |
| 版本只 INSERT 不 UPDATE | 最低代价实现完整时间线，零数据丢失 |
| 多 Provider 工厂模式 | 统一接口，Gemini 限速时自动 fallback 到 Groq |
| 拓扑排序分层并行 | 绕过单次请求 token 上限，最大化并发 |
| Snip 上下文压缩 | 非直接依赖文件只注入 export 签名，大幅降低后期层的 prompt 长度 |
| Architect 两阶段输出 | `<thinking>` 自由推理 + `<output>` 纯 JSON，避免 jsonMode 阻断思考链 |
| 缺失模块三层防御 | 提示词限制 + 生成后检测 + Sandpack Proxy stub，防止幻觉导入白屏 |
| Guest 创建真实 User 记录 | 刷新后项目数据可持久化，固定 email 格式防重复创建 |
| 向后兼容版本读取 | `getVersionFiles()` 统一封装新旧格式，UI 无感知历史数据差异 |

---

## Testing

```bash
npm test              # Unit + Integration（Jest）
npm run test:e2e      # E2E（Playwright，自动启动 dev server）
```

| 层级 | 覆盖范围 |
|------|---------|
| Unit / Integration | lib 函数、React 组件、API Route handlers |
| E2E | 多 Agent 生成流程、版本时间线、持久化 |

---

## Deployment

1. Fork 仓库，在 Vercel 导入项目
2. 填入上述所有环境变量
3. 将 GitHub OAuth App callback URL 改为 `https://<your-app>.vercel.app/api/auth/callback/github`
4. 执行 `npx prisma db push` 同步生产数据库 schema
5. Deploy ✅
