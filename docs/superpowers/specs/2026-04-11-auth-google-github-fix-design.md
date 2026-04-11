# Auth: GitHub Fix + Email Magic Link + Demo Mode — Design Spec

**Date:** 2026-04-11  
**Status:** Approved

## Problem

1. **GitHub login account switching bug**: When the browser has GitHub Account B logged in, logging into BuilderAI with Account A triggers Account B's 2FA instead of a clean account selection.
2. **Low accessibility for non-developer users**: Many target users (general Chinese users) don't have GitHub accounts. Need a universally accessible alternative.
3. **No demo/showcase mode**: Visitors can't explore the app's capabilities without signing up.

## Goals

- Fix GitHub account-switching with a one-liner
- Add Email Magic Link login (works with any email: QQ, 163, Outlook, etc.)
- Add Demo Mode: a fixed "demo viewer" account that shows the developer's own test projects as read-only, with write operations blocked at the API layer
- Keep Guest login unchanged
- Keep existing session/JWT architecture unchanged

## Out of Scope

- Google OAuth
- QQ OAuth
- Phone/SMS login
- Email + password (magic link is simpler — no registration flow)
- NextAuth v5 migration

---

## Design

### 1. GitHub Fix (`lib/auth.ts`)

Add `authorization: { params: { login: "" } }` to `GithubProvider`. Forces GitHub to always show the account chooser, preventing auto-use of the browser's cached session.

### 2. Email Magic Link (`lib/auth.ts`)

Add NextAuth built-in `EmailProvider` with a custom `sendVerificationRequest` using the Resend SDK. User enters any email → receives a magic link → clicks to create a JWT session. No password required.

`VerificationToken` model already exists in `prisma/schema.prisma` — **no DB migration needed**.

**New dependency**: `resend` npm package  
**New env vars**: `RESEND_API_KEY`, `EMAIL_FROM`

### 3. Demo Mode

#### 3a. Schema change

Add `isDemoViewer Boolean @default(false)` to the `User` model in `prisma/schema.prisma`. Sync with `npx prisma db push` (no migration file needed).

#### 3b. Demo viewer account bootstrap

`lib/demo-bootstrap.ts` — called once at app startup (in `lib/auth.ts` module init). Reads `DEMO_VIEWER_ID` from env. If the user doesn't exist, creates one with `isDemoViewer: true` and logs the ID to stdout so the developer can copy it into the env var.

#### 3c. Auth config (`lib/auth.ts`)

New `CredentialsProvider(id: "demo")`:
- No credentials needed — just checks `DEMO_VIEWER_ID` env var exists
- Returns `{ id: DEMO_VIEWER_ID, name: "Demo Viewer", email: null, isDemo: true }`

JWT callback stores `isDemo: true` in the token. Session callback exposes `session.user.isDemo`.

**New env vars**: `DEMO_USER_ID` (developer's real userId whose projects are shown), `DEMO_VIEWER_ID` (the fixed demo account userId)

#### 3d. API write protection

Routes that mutate data check `session.user.isDemo` and return `403` immediately:

| Route | Method(s) blocked |
|-------|-------------------|
| `/api/projects` | `POST` |
| `/api/projects/[id]` | `PATCH`, `DELETE` |
| `/api/messages` | `POST` |
| `/api/versions` | `POST` |
| `/api/versions/[id]/restore` | `POST` |
| `/api/generate` | `POST` |

#### 3e. Project list for demo users

`GET /api/projects` — when `session.user.isDemo` is true, return projects where `userId = DEMO_USER_ID` instead of the demo viewer's own (empty) projects.

`GET /api/projects/[id]` — demo viewer can read any project belonging to `DEMO_USER_ID`.

#### 3f. UI — Demo banner

New component `components/layout/demo-banner.tsx`: a fixed top bar inside the workspace reading "当前为演示模式，仅可查看开发者测试项目，无法编辑". Shown when `session.user.isDemo === true`.

`ChatInput` already accepts a `disabled` prop — pass `disabled={true}` when `isDemo`. The existing placeholder text handling will show a disabled state automatically. Update the placeholder to say "演示模式，无法发送消息" in this case.

`Workspace` receives `isDemo` as a prop from `app/project/[id]/page.tsx` (which reads the session server-side).

#### 3g. Login page button

New `components/layout/demo-login-button.tsx` — calls `signIn("demo", { callbackUrl: "/" })`. Styled as a secondary outlined button, placed between the email form and the Guest section.

### 4. NextAuth session type extension

Add `isDemo?: boolean` to the `Session.user` type declaration in `lib/auth.ts`.

---

## Login Page Layout (final)

```
[ GitHub 登录              ]
─────────── 或 ───────────
[ 邮箱输入框               ]
[ 发送登录链接             ]
─────────── 或 ───────────
[ 查看演示项目             ]   ← new
─────────── 或 ───────────
[ Continue as Guest        ]
[ Try as Guest             ]
```

---

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `isDemoViewer` field to `User` |
| `lib/auth.ts` | GitHub fix; add `EmailProvider`; add demo `CredentialsProvider`; extend JWT/session types |
| `lib/resend.ts` | New: Resend client singleton |
| `lib/demo-bootstrap.ts` | New: auto-create demo viewer account if missing |
| `components/layout/email-login-form.tsx` | New: email input + submit |
| `components/layout/demo-login-button.tsx` | New: demo mode login button |
| `components/layout/demo-banner.tsx` | New: read-only warning banner |
| `app/login/page.tsx` | Add email form + demo button |
| `app/project/[id]/page.tsx` | Pass `isDemo` to Workspace; allow demo viewer to read `DEMO_USER_ID` projects |
| `components/workspace/workspace.tsx` | Accept + propagate `isDemo` prop; show `DemoBanner`; disable `ChatInput` |
| `app/api/projects/route.ts` | Demo redirect on GET; 403 on POST |
| `app/api/projects/[id]/route.ts` | Allow demo GET on DEMO_USER_ID projects; 403 on PATCH/DELETE |
| `app/api/messages/route.ts` | 403 on POST for demo |
| `app/api/versions/route.ts` | 403 on POST for demo |
| `app/api/versions/[id]/restore/route.ts` | 403 on POST for demo |
| `app/api/generate/route.ts` | 403 on POST for demo |
| `.env.example` | Add `RESEND_API_KEY`, `EMAIL_FROM`, `DEMO_USER_ID`, `DEMO_VIEWER_ID` |
| `package.json` | Add `resend` dependency |

---

## Testing

- [ ] GitHub login: always shows account chooser
- [ ] Email login: magic link email received and works; same email reuses existing user record
- [ ] Demo login: clicking button creates session with `isDemo: true`
- [ ] Demo mode: project list shows `DEMO_USER_ID`'s projects
- [ ] Demo mode: all write API routes return 403
- [ ] Demo mode: DemoBanner visible in workspace; ChatInput disabled
- [ ] Guest login: unaffected
