# BuilderAI

AI Agent 驱动的代码生成平台 — 输入一句需求，三个 Agent 协作为你生成完整的多文件 Web 应用。

**线上体验：** [https://builder-ai-v2.vercel.app](https://builder-ai-v2.vercel.app)

---

## Features

- **多 Agent 协作** — PM → Architect → Engineer 顺序流转，每个 Agent 的思考过程实时可见
- **意图识别路由** — 关键词分类器自动识别意图（bug_fix / style_change / feature_add / new_project），修 bug 和调样式直接触达 Engineer，响应速度提升 2–3 倍
- **多文件分层并行生成** — Architect 输出 JSON Scaffold，Engineer 按拓扑排序分层并行生成各文件
- **迭代上下文记忆** — 新增功能时 Engineer 自动收到 V1 代码；PM 收到上一版功能摘要，输出增量 PRD
- **Sandpack 沙箱实时预览** — 生成的多文件 React 应用在浏览器内编译运行，零服务器开销
- **BaaS 伪全栈** — 生成的应用通过 Supabase Anon Key 直连数据库，实现真实数据持久化
- **版本时间线 + 一键回滚** — 每次生成自动保存多文件版本快照，可浏览历史并还原
- **多 AI 模型支持** — Gemini 2.0 Flash / DeepSeek V3 / Groq Llama 3.3 70B，工作区内随时切换
- **GitHub OAuth + Guest 匿名登录** — 支持两种登录方式，无需注册即可体验

---

## Tech Stack

| 层 | 技术 |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui |
| Code Preview | Sandpack (CodeSandbox), Monaco Editor |
| AI Providers | Gemini 2.0 Flash / DeepSeek V3 / Groq Llama 3.3 70B |
| Auth | NextAuth.js v4 (GitHub OAuth + Guest session) |
| Database | Supabase (PostgreSQL) via Prisma ORM |
| Deployment | Vercel |
| Testing | Jest + React Testing Library, Playwright (E2E) |

---

## Quick Start

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

# AI（至少配置一个，优先使用 GOOGLE_GENERATIVE_AI_API_KEY）
GOOGLE_GENERATIVE_AI_API_KEY="AIza..."  # Gemini 2.0 Flash
DEEPSEEK_API_KEY="sk-..."               # DeepSeek V3（可选）
GROQ_API_KEY="gsk_..."                  # Groq Llama 3.3 70B（可选）

# Supabase（public — 前端可见）
NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
```

### 启动

```bash
npx prisma db push   # 初始化数据库 schema
npm run dev          # 启动开发服务器 → http://localhost:3000
```

> 修改 `lib/` 下的配置文件后，使用 `npm run dev:clean` 清除 webpack 缓存重启。

---

## Architecture

### 生成流

```
User Input
    │
    ▼
classifyIntent(prompt, hasExistingCode)
    │
    ├── bug_fix / style_change ──────────────────────── DIRECT PATH
    │                                                        │
    │   单文件 V1: buildDirectEngineerContext()              │
    │   多文件 V1: buildDirectMultiFileEngineerContext()     │
    │                                                        ▼
    │                                          /api/generate (Engineer only)
    │                                               │ code_complete / files_complete
    │                                               ▼
    │                                          merge with V1 → Sandpack + /api/versions
    │
    └── new_project / feature_add ──────────── FULL PIPELINE
                                                        │
        PM context: buildPmIterationContext()           │
                                                        ▼
                                           /api/generate (PM → JSON PmOutput)
                                                        ▼
                                           /api/generate (Architect → ScaffoldData)
                                           topologicalSort() → layers[][]
                                                        │
                                           for each layer (sequential):
                                             for each file in layer (parallel):
                                                        ▼
                                           /api/generate (Engineer × N)
                                                        ▼
                                           findMissingLocalImports() → stub 注入
                                           Sandpack + /api/versions
```

### 关键模块

| 模块 | 职责 |
|------|------|
| `lib/intent-classifier.ts` | 关键词路由，无 LLM 调用，优先级：bug_fix > style_change > new_project > feature_add |
| `lib/agent-context.ts` | 各路径的上下文拼装（V1 代码注入、PM 功能摘要、多文件 Engineer prompt） |
| `lib/generate-prompts.ts` | PM / Architect / Engineer 系统提示词；`snipCompletedFiles()` 上下文压缩 |
| `lib/topo-sort.ts` | 按文件依赖关系分层，同层可并行，层间严格有序 |
| `lib/engineer-circuit.ts` | 三级容错：全层重试 → 逐文件回退 → 熔断 |
| `lib/extract-code.ts` | 多层代码提取（代码围栏 → import 定位 → 尾部截断）；`findMissingLocalImports()` 检测幻觉导入 |
| `lib/sandpack-config.ts` | 构建 Sandpack 配置；自动注入缺失模块的 Proxy stub，防止预览白屏 |
| `lib/error-codes.ts` | ErrorCode 枚举与用户可见的错误展示文案 |

### SSE 事件协议

`/api/generate` 发送换行分隔的 JSON 流：

```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}
data: {"type":"code_complete","code":"..."}       // Engineer 单文件
data: {"type":"files_complete","files":{...}}     // Engineer 多文件
data: {"type":"reset"}                            // 触发限速回退时重置
data: {"type":"done"}
data: {"type":"error","error":"...","errorCode":"rate_limited|parse_failed|missing_imports|..."}
```

### 模型选择优先级链

```
request-level → project.preferredModel → user.preferredModel → AI_PROVIDER env → DEFAULT_MODEL_ID
```

`DEFAULT_MODEL_ID = "gemini-2.0-flash"`

---

## API Routes

| Method | Path | 说明 |
|--------|------|------|
| `GET` `POST` | `/api/projects` | 项目列表 / 创建项目 |
| `GET` `PATCH` `DELETE` | `/api/projects/[id]` | 项目详情 / 更新 / 删除 |
| `POST` | `/api/generate` | SSE 流式 AI 生成，Edge Runtime，maxDuration=300s |
| `GET` `POST` | `/api/messages` | 消息列表（按项目）/ 保存消息 |
| `GET` `POST` | `/api/versions` | 版本列表（按项目）/ 创建版本快照 |
| `POST` | `/api/versions/[id]/restore` | 回滚到指定版本（INSERT 新版本记录） |
| `GET` `PATCH` | `/api/user/preferences` | 用户全局模型偏好读写 |
| `*` | `/api/auth/[...nextauth]` | NextAuth GitHub OAuth 路由 |
| `POST` | `/api/auth/guest` | Guest 匿名登录 |
| `GET` | `/api/export` | 导出项目为 Next.js ZIP 包 |
| `POST` | `/api/deploy` | 触发 Vercel 部署 |
| `GET` | `/api/deploy/[id]` | 轮询部署状态 |

---

## Database Schema

```
User
  ├── id, name, email, image
  ├── isGuest         Boolean   ← Guest 匿名账户标记
  ├── preferredModel  String?   ← 全局模型偏好
  └── Project[]

Project
  ├── id, name, description
  ├── preferredModel  String?   ← 项目级覆盖（优先于用户全局偏好）
  ├── userId          ──► User
  ├── Version[]
  └── Message[]

Version                         ← 不可变，只 INSERT
  ├── id, code
  ├── files           Json?     ← 多文件 Record<string,string>
  ├── versionNumber   Int       ← 项目内自增
  ├── description     String?   ← prompt 前 80 字符
  └── projectId       ──► Project

Message
  ├── id, role, content
  ├── metadata        JSONB     ← { agentName?, agentColor? }
  └── projectId       ──► Project

DynamicAppData                  ← 生成应用的运行时数据
  ├── id, appId (= projectId), key
  ├── data            JSONB
  └── unique([appId, key])
```

---

## Project Structure

```
builder-ai/
├── app/
│   ├── page.tsx                      # 首页：项目列表 / Landing
│   ├── layout.tsx                    # 根布局
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
│   ├── home/                         # 项目卡片、项目列表
│   ├── layout/                       # Header、登录按钮
│   ├── preview/                      # PreviewPanel、MultiFileEditor、设备选择
│   ├── sidebar/                      # 侧边栏、项目列表项
│   ├── timeline/                     # 版本时间线
│   ├── ui/                           # shadcn/ui（勿手动编辑）
│   └── workspace/                    # ChatArea（核心编排）、ChatInput、Workspace
│
├── hooks/
│   ├── use-versions.ts               # 版本 CRUD + 时间线状态
│   └── use-project.ts                # 项目数据拉取
│
├── lib/
│   ├── types.ts                      # 共享类型（ScaffoldData、PmOutput、ErrorCode 等）
│   ├── intent-classifier.ts          # classifyIntent()：关键词路由
│   ├── agent-context.ts              # 各路径上下文拼装函数
│   ├── generate-prompts.ts           # Agent 系统提示词 + Snip 压缩
│   ├── extract-code.ts               # 代码提取策略 + findMissingLocalImports()
│   ├── extract-json.ts               # JSON 解析：PM / Scaffold 输出
│   ├── engineer-circuit.ts           # 层级容错重试（retryWithBackoff + runLayerWithFallback）
│   ├── topo-sort.ts                  # 拓扑排序分层
│   ├── sandpack-config.ts            # Sandpack 配置 + 缺失模块 stub 注入
│   ├── error-codes.ts                # ErrorCode 枚举与用户可见文案
│   ├── version-files.ts              # getVersionFiles()：向后兼容读取 code/files
│   ├── ai-providers.ts               # AIProvider 接口 + Gemini/DeepSeek/Groq 实现
│   ├── model-registry.ts             # 模型注册表
│   ├── api-client.ts                 # fetchAPI / fetchSSE 统一抽象
│   ├── auth.ts                       # NextAuth 配置
│   ├── prisma.ts                     # Prisma Client 单例
│   ├── project-assembler.ts          # 导出/部署拼装
│   ├── zip-exporter.ts               # ZIP 打包
│   └── vercel-deploy.ts              # Vercel Deploy API 封装
│
├── e2e/                              # Playwright E2E 测试
├── __tests__/                        # Jest 单元 + 集成测试
└── prisma/schema.prisma              # 数据库 Schema
```

---

## Key Engineering Decisions

### 1. Sandpack 而非 WebContainer
WebContainer 需要 COOP/COEP 响应头，Vercel Hobby 计划不支持自定义响应头，部署后预览必然失败。Sandpack 在普通 iframe 中运行，零部署风险。

### 2. Hybrid Stable 渲染
等 `code_complete` / `files_complete` 事件后一次性渲染，而非流式更新 Sandpack。频繁 remount 在流式场景下产生闪烁和性能问题。

### 3. 不可变版本设计
版本表只 INSERT 不 UPDATE/DELETE。回滚 = 读取旧版本文件 → INSERT 新版本记录，以最低工程代价实现完整时间线。

### 4. 多 Provider 工厂模式
`AIProvider` 接口统一抽象三个 Provider，模型选择优先级链无需改代码即可切换。Gemini 限速时自动 fallback 到 Groq。

### 5. 拓扑排序分层并行
Architect 输出完整文件依赖图，`topologicalSort()` 按层分组：同层文件无依赖可并行生成，层间严格顺序，绕过单次请求 token 上限。

### 6. Snip 上下文压缩
`snipCompletedFiles()` 对已完成文件差异化处理：直接依赖注入完整代码，非直接依赖只注入 export 签名。10 文件项目最后一层 prompt 从 ~7500 tokens 压缩到 ~500 tokens。

### 7. 三级 Engineer 容错
`runLayerWithFallback()`：全层失败后指数退避重试 → 逐文件单独请求 → 连续 3 次失败触发熔断，标记 failed 而非崩溃。

### 8. Architect 两阶段输出
`<thinking>` 推理 + `<output>` JSON 分离：模型在 thinking 中自由推理，output 中输出纯 JSON，避免 jsonMode 阻断思考链。

### 9. 缺失模块三层防御
AI 偶尔会 import 从未创建的本地文件路径（幻觉），导致 Sandpack 白屏：
- **提示词**：`getMultiFileEngineerPrompt` 明确禁止 import deps 列表外的本地路径
- **检测**：`findMissingLocalImports()` 在生成完成后扫描所有文件，发现缺失时向用户展示 `missing_imports` 错误
- **兜底**：`buildSandpackConfig()` 自动注入 Proxy stub，预览降级渲染而非白屏

### 10. Guest 匿名账户
Guest 在 DB 中创建真实 `User` 记录（非 session-only），保证刷新后项目和历史数据均可持久化。固定 guest email 格式防止重复创建。

### 11. 向后兼容版本读取
`getVersionFiles()` 统一封装：新版本从 `files` 字段返回，老版本只有 `code` 字段则包装为 `{ "/App.js": code }`，UI 层无感知。

### 12. 意图识别短路路由
`classifyIntent()` 纯关键词匹配，无 LLM 调用。bug_fix / style_change 跳过 PM + Architect，三次串行 SSE 缩减为一次，响应时间从 ~60s 降到 ~20s。

---

## Testing

| 层级 | 框架 | 覆盖范围 |
|------|------|---------|
| Unit | Jest + React Testing Library | lib 函数、React 组件 |
| Integration | Jest | API Route handlers（mock DB + Auth）|
| E2E | Playwright | 多 Agent 流程、版本时间线、持久化 |

```bash
npm test              # Unit + Integration (Jest)
npm run test:e2e      # E2E (Playwright，自动启动 dev server)
```

---

## Deployment (Vercel)

1. Fork 仓库，在 Vercel 导入项目
2. 配置上述所有环境变量
3. 将 GitHub OAuth App 的 callback URL 改为 `https://<your-app>.vercel.app/api/auth/callback/github`
4. 执行 `npx prisma db push` 同步生产数据库 schema
5. Deploy ✅
