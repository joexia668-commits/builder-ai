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
- **局部容错与可见重试** — 单层输出截断时保留已成功解析的文件，仅对失败子集重试；UI 实时展示重试进度与原因
- **Scaffold 抢救** — Architect 的多文件 JSON 被流超时/token 上限截断时，从不完整输出里救回已写完的文件条目（逐元素括号匹配），避免回退到 legacy 单文件路径的级联失败
- **Serverless 友好的 DB 层** — Prisma `$extends` 拦截瞬态连接错误（Supavisor 丢 socket、冷启动 stale TCP）自动退避重试，用户无感知
- **迭代上下文记忆** — 新增功能时 PM 和 Engineer 均感知上一版本状态，输出增量而非重建
- **Sandpack 沙箱预览** — 多文件 React 应用在浏览器内编译运行，零服务器开销
- **BaaS 数据持久化** — 生成的应用通过 Supabase Anon Key 直连数据库
- **版本时间线** — 每次生成自动快照，可浏览历史并一键回滚
- **Scaffold 校验与自动修正** — 生成前自动检测并修复 Architect 输出的幽灵依赖、循环依赖、hints 路径错误；校验结果内联显示在 Architect 消息下方，Engineer 输出缺失文件时发起一轮补全
- **代码实时流式预览** — 生成期间代码标签页自动切换并跟随当前写入文件，暗色 `<pre>` 展示流式输出与光标；文件生成完毕后无缝切换回 Monaco 编辑器；文件树同步显示绿色脉冲 / 灰色勾 / 红色叉状态指示器
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
│   ├── preview/                      # PreviewPanel、FileTreeCodeViewer（含流式）、设备切换
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
│   ├── engineer-stream-tap.ts        # SSE 流观测 tap：检测 FILE 边界，emit file_start/chunk/end 事件
│   ├── coalesce-chunks.ts            # 合并同一文件的连续 file_chunk 事件（降低 SSE 频率）
│   ├── generation-session.ts         # 跨组件 liveStreams 状态（模块级存储，非 useState）
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

## Multi-Agent Orchestration

系统按意图将请求路由到不同编排路径：

| 意图 | 触发条件 | Agent 路径 | 典型耗时 |
|------|---------|-----------|---------|
| `bug_fix` | "修复/bug/报错" 等关键词 | Engineer only | ~20s |
| `style_change` | "颜色/样式/dark mode" 等关键词 | Engineer only | ~20s |
| `new_project` | 无现有代码，或"重新做"关键词 | PM → Architect → Engineer × N | ~60s |
| `feature_add` | 默认（有现有代码） | PM → Architect → Engineer × N（含 V1 上下文） | ~60s |

全流程路径中，Engineer 按文件依赖关系**分层串行、层内并行**生成：同层文件并发调用 `/api/generate`，层间严格有序，每层完成后才进入下一层。

内置三级容错：局部解析保留 → 仅失败文件重试（最多 2 次全层 + 2 次逐文件）→ 熔断（已完成文件正常渲染）。重试期间 UI 显示进度横幅，自适应 Prompt 仅请求失败文件并附加截断上下文。

Architect scaffold 解析也有独立的抢救路径：当 JSON 被流超时截断时，`extractScaffoldFromTwoPhase` 会用括号匹配定位 `"files": [...]` 数组，逐元素识别已写完的 top-level 对象，合成出一个只含完整条目的部分 scaffold。即便 architect 输出在第 N 个文件的字符串中间被砍，前 N-1 个文件仍能进入 Engineer 层级路径。

→ **[完整流程图、场景示例、容错详情](docs/examples/agent-orchestration.md)**

---

## Key Engineering Decisions

| 决策 | 原因 |
|------|------|
| Sandpack 而非 WebContainer | Vercel Hobby 不支持 COOP/COEP 响应头，WebContainer 无法部署 |
| 一次性渲染而非流式更新 Sandpack | 频繁 remount 产生闪烁，且会触发 ChunkLoadError（webpack chunk URL 解析为 undefined），稳定性优先 |
| 提取层自动去重 `export default` | `feature_add` 合并时 Engineer 常复制原文件尾部的 re-export 行，导致双 default export 语法错误；在 `extractMultiFileCodePartial` 等提取函数中统一后处理，无需改 Prompt |
| `normalizeExports` 用 `export { X }` 而非 `export { default as X }` | Sandpack 内置 Babel 不支持 `export { default as X }` 语法（"Unexpected keyword 'default'"），改为直接导出模块作用域内的标识符，语义等价且完全兼容 |
| 版本只 INSERT 不 UPDATE | 最低代价实现完整时间线，零数据丢失 |
| 多 Provider 工厂模式 | 统一接口，Gemini 限速时自动 fallback 到 Groq |
| 拓扑排序分层并行 | 绕过单次请求 token 上限，最大化并发 |
| Snip 上下文压缩 | 非直接依赖文件只注入 export 签名，大幅降低后期层的 prompt 长度 |
| Composer-layer 阈值防御 | target 文件 direct deps > 5 时也把直接依赖压缩为 signatures。针对"单文件 composer 独占一层"引发的 prompt 爆炸失败（MainLayout/App.js 类），常规场景零改动 |
| Architect 两阶段输出 | `<thinking>` 自由推理 + `<output>` 纯 JSON，避免 jsonMode 阻断思考链 |
| Scaffold 尾部截断抢救 | Architect 输出被截断时，`extractScaffoldFromTwoPhase` 从不完整 JSON 里逐元素救回已写完的 files 条目。避免 chat-area 静默 fall-through 到 legacy 单文件 Engineer 形成级联失败 |
| Prisma `$extends` 透明重试 | Supavisor 瞬态 drop socket 和冷启动 stale TCP 是 Vercel + Supabase 组合的已知脆弱点；client 层对 `Connection terminated/ECONNRESET` 类错误做指数退避重试（100→200→400ms），真正不可恢复的错误透传 |
| 缺失模块三层防御 | 提示词限制 + 生成后检测 + Sandpack Proxy stub，防止幻觉导入白屏 |
| Scaffold 依赖校验层 | Architect 输出的 `deps` 字段常混入 npm 包名或引用不存在的本地路径；`validateScaffold()` 在 `topologicalSort` 前运行四条确定性规则：移除自引用 → 移除幽灵依赖 → 清理 hints 幽灵路径 → 逆流启发式断环。校验结果以内联消息持久化到聊天记录 |
| 缺失文件一轮补全 | Engineer 生成完成后若仍有本地 import 缺失（≤3 个文件），发起一轮定向补全请求，成功则合并，失败回退到 stub 注入 |
| SSE 流纯观测 tap | `createEngineerStreamTap()` 旁路监听 Engineer SSE 流，检测 `// === FILE: /path ===` 边界并 emit `file_start/file_chunk/file_end` 事件，完全不碰授权解析路径；SAFE_TAIL=256 防止标记头被 token 切割；服务端 80ms 限流；客户端 `liveStreams` 在 `files_complete` 到达时被授权数据覆盖（自愈）|
| Guest 创建真实 User 记录 | 刷新后项目数据可持久化，固定 email 格式防重复创建 |
| 向后兼容版本读取 | `getVersionFiles()` 统一封装新旧格式，UI 无感知历史数据差异 |

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
DATABASE_URL="postgresql://...:6543/postgres"  # Supavisor pooler, transaction mode（必须 6543）
DIRECT_URL="postgresql://...:5432/postgres"    # 直连，端口 5432（用于 prisma db push）

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
| `DATABASE_URL` | Prisma 运行时连接串 | 是 | **必须是 Supavisor pooler 的 6543 (transaction mode)**。5432 是 session mode，Vercel Lambda 冻结-解冻时会 hand out 已被 pooler 丢弃的 stale socket，引发 `Connection terminated` 错误。详见 ADR 0002 |
| `DIRECT_URL` | Prisma migration/push 连接串 | 是 | 直连 5432 端口；仅用于 `prisma db push`/`migrate`，运行时不走这里 |
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
