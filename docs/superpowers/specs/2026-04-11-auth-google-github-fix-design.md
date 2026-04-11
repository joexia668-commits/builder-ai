# Auth: GitHub Fix + Google OAuth — Design Spec

**Date:** 2026-04-11  
**Status:** Approved

## Problem

1. **GitHub login account switching bug**: When the browser already has GitHub Account B logged in, logging into BuilderAI with Account A causes GitHub to prompt for Account B's 2FA verification instead of a clean account selection.
2. **Missing Google OAuth**: Target users are general Chinese users who may not have GitHub accounts. Google is a widely accessible alternative.

## Goals

- Fix the GitHub account-switching issue with minimal code change
- Add Google as a second OAuth provider
- Keep Guest login unchanged
- Keep existing session/JWT architecture unchanged

## Out of Scope

- QQ OAuth (decided against — requires Tencent Open Platform approval process)
- Phone number / SMS login
- Email + password login
- NextAuth v5 migration
- Supabase Auth migration

## Design

### 1. GitHub Fix (`lib/auth.ts`)

Add `authorization.params.login: ""` to `GithubProvider`. This forces GitHub to always show the account selection screen, preventing it from auto-using the browser's cached session.

```ts
GithubProvider({
  clientId: process.env.GITHUB_ID!,
  clientSecret: process.env.GITHUB_SECRET!,
  authorization: { params: { login: "" } },
})
```

No other changes to GitHub auth flow.

### 2. Google OAuth (`lib/auth.ts`)

Add `GoogleProvider` from `next-auth/providers/google`. NextAuth's PrismaAdapter will automatically persist Google accounts in the `Account` table — no schema changes needed.

```ts
import GoogleProvider from "next-auth/providers/google";

GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
})
```

**Required env vars** (add to `.env.example` and Vercel):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

**Google Cloud Console setup** (one-time, done by developer):
1. Create OAuth 2.0 credentials at console.cloud.google.com
2. Add authorized redirect URI: `{NEXTAUTH_URL}/api/auth/callback/google`

### 3. Login Page UI (`components/layout/login-button.tsx` + `app/login/page.tsx`)

Extract a shared `OAuthLoginButton` component or add a standalone `GoogleLoginButton` component alongside the existing `LoginButton` (GitHub). Both buttons sit above the divider, stacked vertically, consistent styling.

Layout after change:
```
[ GitHub 登录 ]
[ Google 登录 ]
─────── 或 ───────
[ Guest 登录 ]
```

### 4. Unchanged

- `CredentialsProvider` (Guest logic) — no changes
- Session strategy (`jwt`) — no changes
- JWT / session callbacks — no changes
- PrismaAdapter — no schema changes needed
- All API routes using `getServerSession` — no changes

## Files to Change

| File | Change |
|------|--------|
| `lib/auth.ts` | Add `GoogleProvider`, fix GitHub `login` param |
| `components/layout/login-button.tsx` | Rename/refactor into generic OAuth button, or keep as-is and add `GoogleLoginButton` |
| `app/login/page.tsx` | Add Google login button to UI |
| `.env.example` | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

## Testing

- [ ] GitHub login: verify that clicking login always shows GitHub account chooser, not Account B's 2FA
- [ ] Google login: new user creates a DB record; existing user gets same session
- [ ] Guest login: unaffected
- [ ] Session persistence: both GitHub and Google sessions survive page reload
