# 环境配置指南

## 前置条件

Node.js 18+、Supabase 项目（免费 tier 即可）、至少一个 AI API Key。

## .env.local 配置

复制 `.env.example` 为 `.env.local`，填入以下变量：

### 数据库（必需）

| 变量 | 用途 | 说明 |
|------|------|------|
| `DATABASE_URL` | Prisma 运行时连接串 | **必须是 Supavisor pooler 端口 6543（transaction mode）**。使用 5432 会在 Vercel Lambda 冻结-解冻时触发 `Connection terminated`。详见 ADR 0002 |
| `DIRECT_URL` | Prisma migration 连接串 | 直连 5432，仅用于 `prisma db push`，运行时不走这里 |

### 认证

| 变量 | 用途 | 必需 | 说明 |
|------|------|------|------|
| `NEXTAUTH_SECRET` | JWT 签名密钥 | 是 | 随机 32 字符字符串 |
| `NEXTAUTH_URL` | Auth 回调基础 URL | 是 | 本地开发用 `http://localhost:3000` |
| `GITHUB_ID` | GitHub OAuth App ID | 否 | 在 GitHub Settings → Developer settings → OAuth Apps 创建 |
| `GITHUB_SECRET` | GitHub OAuth App Secret | 否 | 同上 |
| `RESEND_API_KEY` | Email Magic Link 服务 | 推荐 | 在 [resend.com](https://resend.com) 注册获取 |
| `EMAIL_FROM` | 邮件发件人地址 | 随 Resend | Demo 环境可用 `BuilderAI <onboarding@resend.dev>`，生产需验证域名 |

### AI Provider（至少配置一个）

| 变量 | Provider | 默认 | 说明 |
|------|----------|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek V3 | ✅ 默认 | 性价比最优，推荐首选 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini 2.0 Flash | — | 免费 15 RPM |
| `GROQ_API_KEY` | Groq Llama 3.3 70B | — | 免费 30 RPM，Gemini 限速时自动 fallback |

### Supabase（前端可见）

| 变量 | 用途 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | 生成应用访问 Supabase 的 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon Key（受 RLS 保护，可安全暴露到前端） |

### Demo 模式（可选）

| 变量 | 用途 |
|------|------|
| `DEMO_USER_ID` | 开发者账户 userId，Demo 用户只读查看该账户下的项目 |
| `DEMO_VIEWER_ID` | 系统自动生成的 Demo 用户 ID，首次启动后从日志中复制 |

## 启动项目

```bash
git clone <repo-url>
cd builder-ai
npm install
cp .env.example .env.local   # 按上表填入变量
npx prisma db push           # 初始化数据库 schema
npm run dev                  # → http://localhost:3000
```

## 配置 Demo 模式（可选）

Demo 模式允许访客无需注册即可查看你的项目演示。

1. **启动项目**（不配置 `DEMO_VIEWER_ID`）：`npm run dev`
2. **获取 DEMO_VIEWER_ID**：启动日志中会打印自动生成的 demo 用户 ID
3. **配置 DEMO_USER_ID**：用 GitHub 或 Email 登录后，运行 `npx prisma studio`，在 User 表找到你的账户 `id`
4. **填入 .env.local**：
   ```env
   DEMO_USER_ID="你的userId"
   DEMO_VIEWER_ID="日志中的ID"
   ```
5. **重启**：`npm run dev`，登录页点击"查看演示项目"即可体验

> 修改 `lib/` 下配置文件后，用 `npm run dev:clean` 清除 webpack 缓存重启。
