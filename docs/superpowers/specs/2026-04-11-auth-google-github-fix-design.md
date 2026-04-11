# Auth: GitHub Fix + Email Magic Link — Design Spec

**Date:** 2026-04-11  
**Status:** Approved (revised — Google OAuth replaced with Email Magic Link)

## Problem

1. **GitHub login account switching bug**: When the browser already has GitHub Account B logged in, logging into BuilderAI with Account A causes GitHub to prompt for Account B's 2FA verification instead of a clean account selection.
2. **Low accessibility for non-developer users**: Many target users (general Chinese users) don't have GitHub accounts. Need a universally accessible alternative that works with any email (QQ mail, 163, Outlook, etc.).

## Goals

- Fix the GitHub account-switching issue with minimal code change
- Add Email Magic Link login: user enters any email, receives a login link, clicks to authenticate — no password needed
- Keep Guest login unchanged
- Keep existing session/JWT architecture unchanged
- No database schema changes

## Out of Scope

- Google OAuth (decided against — requires Google account)
- QQ OAuth (decided against — requires Tencent Open Platform approval)
- Phone number / SMS login
- Email + password login (magic link is simpler — no registration flow needed)
- NextAuth v5 migration
- Supabase Auth migration

## Design

### 1. GitHub Fix (`lib/auth.ts`)

Add `authorization.params.login: ""` to `GithubProvider`. Forces GitHub to always show the account selection screen, preventing it from auto-using the browser's cached session.

```ts
GithubProvider({
  clientId: process.env.GITHUB_ID!,
  clientSecret: process.env.GITHUB_SECRET!,
  authorization: { params: { login: "" } },
})
```

### 2. Email Magic Link (`lib/auth.ts`)

Add `EmailProvider` from `next-auth/providers/email` with a custom `sendVerificationRequest` using the Resend SDK.

```ts
import EmailProvider from "next-auth/providers/email";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

EmailProvider({
  from: process.env.EMAIL_FROM!,
  sendVerificationRequest: async ({ identifier, url, provider }) => {
    await resend.emails.send({
      from: provider.from,
      to: identifier,
      subject: "登录 BuilderAI",
      html: `<p>点击下方链接登录 BuilderAI（链接 10 分钟内有效）：</p><p><a href="${url}">立即登录</a></p>`,
      text: `登录链接：${url}`,
    });
  },
})
```

**Why Resend**: Free tier is 3,000 emails/month, modern API, reliable deliverability, no SMTP config needed.

**Required env vars** (add to `.env.example` and Vercel):
- `RESEND_API_KEY` — from resend.com dashboard
- `EMAIL_FROM` — e.g. `BuilderAI <noreply@yourdomain.com>` (domain must be verified in Resend)

**New dependency**: `resend` package (`npm install resend`)

**Database**: `VerificationToken` model already exists in `prisma/schema.prisma` — no migration needed.

### 3. Login Page UI

Replace the GitHub-only button area with two sections:
- GitHub OAuth button (existing `LoginButton`, unchanged)
- Email input form: text input + submit button → calls `signIn("email", { email, callbackUrl: "/" })`

New component: `components/layout/email-login-form.tsx`

Layout after change:
```
[ GitHub 登录 ]
─────── 或 ───────
[ 邮箱输入框        ]
[ 发送登录链接      ]
─────── 或 ───────
[ Guest 登录 ]
```

### 4. Unchanged

- `CredentialsProvider` (Guest logic) — no changes
- Session strategy (`jwt`) — no changes
- JWT / session callbacks — no changes
- PrismaAdapter — no schema changes
- All API routes using `getServerSession` — no changes

## Files to Change

| File | Change |
|------|--------|
| `lib/auth.ts` | Fix GitHub `login` param; add `EmailProvider` with Resend |
| `components/layout/email-login-form.tsx` | New: email input + submit button |
| `app/login/page.tsx` | Add `EmailLoginForm` between GitHub button and Guest section |
| `.env.example` | Add `RESEND_API_KEY`, `EMAIL_FROM` |
| `package.json` | Add `resend` dependency |

## Testing

- [ ] GitHub login: clicking login always shows GitHub account chooser, not cached account's 2FA
- [ ] Email login: entering email sends a magic link email; clicking the link creates a session
- [ ] Email login: same email address on second login reuses the existing user record (no duplicates)
- [ ] Guest login: unaffected
- [ ] Session persistence: both GitHub and email sessions survive page reload
