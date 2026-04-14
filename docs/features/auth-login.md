# 认证与登录（Auth & Login）

## 概述

BuilderAI 支持四种登录方式：GitHub OAuth、Email Magic Link（Resend）、Demo 只读账户、Guest 匿名账户。认证逻辑集中在 `lib/auth.ts`（NextAuth 配置），启动时自动确保 Demo 和 Dev Guest 账户存在，过期 Guest 账户由 `lib/guest-cleanup.ts` 定期清理。

## 设计思路

核心取舍：四种 provider 统一走 NextAuth JWT 策略，`token.id` 和 `token.isDemo` 注入 session，避免在 Edge Runtime 路由（`/api/generate`）中调用 Prisma（不兼容 Edge）。

Guest 账户采用数据库持久化而非 cookie-only，原因是需要跨设备/刷新保持项目数据。STALE_DAYS=5 的清理策略在数据量和用户体验之间取平衡。

Demo 账户是只读的（`isDemoViewer: true`），deploy/export 操作在 API 路由中检查 `session.user.isDemo` 后返回 403。

## 代码逻辑

### 四种 Provider

**1. GithubProvider**

```typescript
GithubProvider({
  clientId: process.env.GITHUB_ID!,
  clientSecret: process.env.GITHUB_SECRET!,
})
```

标准 OAuth 2.0 流程，Prisma adapter 自动创建/关联 User 记录。

**2. EmailProvider（Resend）**

```typescript
EmailProvider({
  from: process.env.EMAIL_FROM!,
  sendVerificationRequest: async ({ identifier, url, provider }) => {
    await resend.emails.send({
      from: provider.from,
      to: identifier,
      subject: "登录 BuilderAI",
      html: `<a href="${url}">立即登录</a>`,  // Magic Link，10 分钟有效
    })
  },
})
```

Magic Link 由 NextAuth 生成，通过 Resend 发送。用户点击链接完成登录，无需密码。

**3. CredentialsProvider "demo"**

```typescript
CredentialsProvider({
  id: "demo",
  async authorize() {
    const id = process.env.DEMO_VIEWER_ID
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user?.isDemoViewer) return null
    return { id: user.id, name: "Demo Viewer", email: null, isDemo: true }
  },
})
```

前端 `<DemoLoginButton>` 调用 `signIn("demo")` 触发。`isDemo: true` 写入 JWT。

**4. CredentialsProvider "credentials"（Guest）**

```typescript
CredentialsProvider({
  id: "credentials",
  credentials: { guest: { type: "text" }, guestId: { type: "text" } },
  async authorize(credentials) {
    if (credentials?.guestId) {
      const user = await findGuestUser(credentials.guestId)
      if (user) return { id: user.id, name: user.name ?? "Guest", email: null }
    }
    return null
  },
})
```

`guestId` 从 localStorage 读取（已有 Guest 账户时刷新登录）；`guest: "true"` 触发新建流程（见 Guest 创建路由）。

### JWT Callback

```typescript
callbacks: {
  async jwt({ token, user }) {
    if (user) {
      token.id = user.id
      token.isDemo = (user as { isDemo?: boolean }).isDemo ?? false
    }
    return token
  },
  async session({ session, token }) {
    session.user.id = token.id
    session.user.isDemo = token.isDemo ?? false
    return session
  },
}
```

`/api/generate`（Edge Runtime）通过 `getToken()` 读取 JWT 而非 `getServerSession`，避免 Prisma 进入 Edge。

### Demo 与 Dev Guest 启动初始化

```typescript
// lib/demo-bootstrap.ts
export async function ensureDemoViewer(): Promise<void>
// 检查 DEMO_VIEWER_ID 是否设置
// 若 DB 中不存在该 user → 创建 { isDemoViewer: true }

export async function ensureDevGuest(): Promise<void>
// 仅当 DEV_GUEST_ID 设置时激活（.env.local 本地开发用）
// → 创建 { isGuest: true } 固定 ID Guest 账户
```

两函数在 `lib/auth.ts` 模块初始化时调用（`ensureDemoViewer().catch(console.error)`），服务器冷启动时自动执行。

### Guest 账户创建与刷新

```
前端 GuestLoginButton
  → POST /api/auth/guest
      → findOrCreateGuestUser()     // 创建 isGuest:true 账户
      → 返回 { guestId }
  → localStorage.setItem("guestId", guestId)
  → signIn("credentials", { guestId })
```

`guestId` 存 localStorage，页面刷新时读取并 re-signIn，保持 session 连续。

### Guest 清理（deleteStaleGuestUsers）

```typescript
// lib/guest-cleanup.ts
const STALE_DAYS = 5

export async function deleteStaleGuestUsers(): Promise<number>
// 查找：isGuest:true AND updatedAt < cutoff AND 无 project.updatedAt >= cutoff
// cascade delete：User → Projects → Messages → Versions → Deployments
// 返回删除数量
```

清理由定期 cron job 或管理接口触发（不自动运行）。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| GitHub OAuth 登录 | GithubProvider 标准流程，Prisma adapter 自动处理 |
| Email Magic Link | Resend 发送链接，NextAuth 验证 token |
| Demo 账户登录 | CredentialsProvider "demo"，isDemo=true 注入 JWT |
| 新 Guest 登录 | POST /api/auth/guest → 创建账户 → signIn |
| 已有 Guest 刷新页面 | localStorage guestId → signIn("credentials") re-授权 |
| Demo 用户访问 deploy/export | API 检查 isDemo → 返回 403 |
| DEMO_VIEWER_ID 未设置 | demo 登录返回 null，前端 Demo 按钮不可用 |
| Guest 账户 5 天无活动 | deleteStaleGuestUsers cascade 删除 |

## 未覆盖场景 / 已知限制

- **账户关联（Guest → 真实账户）**：Guest 用户注册真实账户后，Guest 创建的项目不会自动迁移。
- **多设备 Guest 合并**：同一用户在不同设备创建的 Guest 账户是独立的，无法合并项目。
- **Email 变更**：Magic Link 认证的 email 无法通过系统界面修改。
- **Google OAuth**：未集成，如需添加需扩展 `authOptions.providers`。
- **Guest 清理时机**：`deleteStaleGuestUsers` 未自动调度，需外部 cron 触发。

## 相关文件

- `lib/auth.ts` — NextAuth 配置（四种 provider、JWT callback）
- `lib/demo-bootstrap.ts` — `ensureDemoViewer`、`ensureDevGuest`
- `lib/guest-cleanup.ts` — `deleteStaleGuestUsers`
- `app/api/auth/guest/route.ts` — Guest 账户创建端点
- `app/api/auth/guest/guest-service.ts` — `findOrCreateGuestUser`、`findGuestUser`
- `components/layout/guest-login-buttons.tsx` — 前端 Guest 登录按钮
- `components/layout/demo-login-button.tsx` — Demo 登录按钮
