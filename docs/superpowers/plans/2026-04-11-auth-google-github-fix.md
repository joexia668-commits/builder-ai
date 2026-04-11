# Auth: Google OAuth + GitHub Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub account-switching bug and add Google OAuth as a second login method.

**Architecture:** Two config changes to `lib/auth.ts` (one-liner GitHub fix + GoogleProvider), one new component `GoogleLoginButton`, minor update to the login page UI. Guest login is untouched throughout.

**Tech Stack:** NextAuth v4, `next-auth/providers/google` (built-in), React, Tailwind, Jest + Testing Library

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `lib/auth.ts` | Modify | Add `authorization.params.login: ""` to GitHub; add `GoogleProvider` |
| `components/layout/google-login-button.tsx` | Create | New Google OAuth button component |
| `components/layout/login-button.tsx` | No change | GitHub button stays as-is |
| `app/login/page.tsx` | Modify | Import and render `GoogleLoginButton` below `LoginButton` |
| `.env.example` | Modify | Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` |
| `__tests__/auth-config.test.ts` | Create | Unit tests for authOptions providers config |
| `__tests__/google-login-button.test.tsx` | Create | Component tests for `GoogleLoginButton` |

---

## Task 1: Fix GitHub login + add Google provider to auth config

**Files:**
- Modify: `lib/auth.ts`
- Create: `__tests__/auth-config.test.ts`

### Context

`lib/auth.ts` currently exports `authOptions` with `GithubProvider` and `CredentialsProvider` (Guest). The GitHub fix adds `authorization.params.login: ""` which forces GitHub to always show account selection. The Google fix adds `GoogleProvider` which NextAuth + PrismaAdapter handles automatically (no schema change needed).

- [ ] **Step 1: Write failing tests**

Create `__tests__/auth-config.test.ts`:

```typescript
import { authOptions } from "@/lib/auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

describe("authOptions", () => {
  it("includes a GitHub provider with login param to force account selection", () => {
    const github = authOptions.providers.find(
      (p) => (p as OAuthConfig<unknown>).id === "github"
    ) as OAuthConfig<unknown> | undefined;
    expect(github).toBeDefined();
    // login: "" forces GitHub to always show account chooser
    expect((github?.authorization as { params?: { login?: string } })?.params?.login).toBe("");
  });

  it("includes a Google provider", () => {
    const google = authOptions.providers.find(
      (p) => (p as OAuthConfig<unknown>).id === "google"
    );
    expect(google).toBeDefined();
  });

  it("still includes a credentials provider for Guest login", () => {
    const credentials = authOptions.providers.find(
      (p) => (p as { id?: string }).id === "credentials"
    );
    expect(credentials).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="auth-config"
```

Expected: FAIL — `google` provider not found, GitHub `login` param missing.

- [ ] **Step 3: Update `lib/auth.ts`**

Replace the full file content:

```typescript
import { PrismaAdapter } from "@auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { findGuestUser } from "@/app/api/auth/guest/guest-service";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      authorization: { params: { login: "" } },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Guest",
      credentials: {
        guest: { type: "text" },
        guestId: { type: "text" },
      },
      async authorize(credentials) {
        if (!credentials) return null;

        if (credentials.guestId) {
          const user = await findGuestUser(credentials.guestId);
          if (user) {
            return { id: user.id, name: user.name ?? "Guest", email: null };
          }
          return null;
        }

        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="auth-config"
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts __tests__/auth-config.test.ts
git commit -m "feat: add Google OAuth provider and fix GitHub account-switching"
```

---

## Task 2: Create GoogleLoginButton component

**Files:**
- Create: `components/layout/google-login-button.tsx`
- Create: `__tests__/google-login-button.test.tsx`

### Context

The existing `components/layout/login-button.tsx` has a `LoginButton` that calls `signIn("github", ...)`. We create a parallel `GoogleLoginButton` that calls `signIn("google", ...)`. Same visual style — full-width, 42px height, rounded-[10px]. The Google button gets a Google "G" SVG icon (same pattern as GitHub's SVG icon in LoginButton).

- [ ] **Step 1: Write failing tests**

Create `__tests__/google-login-button.test.tsx`:

```typescript
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoogleLoginButton } from "@/components/layout/google-login-button";

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

describe("GoogleLoginButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a button with Google login text", () => {
    render(<GoogleLoginButton />);
    expect(
      screen.getByRole("button", { name: /google/i })
    ).toBeInTheDocument();
  });

  it('calls signIn("google") with callbackUrl "/" on click', () => {
    render(<GoogleLoginButton />);
    fireEvent.click(screen.getByRole("button", { name: /google/i }));
    expect(mockSignIn).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="google-login-button"
```

Expected: FAIL — module `@/components/layout/google-login-button` not found.

- [ ] **Step 3: Create `components/layout/google-login-button.tsx`**

```typescript
"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function GoogleLoginButton() {
  return (
    <Button
      variant="outline"
      onClick={() => signIn("google", { callbackUrl: "/" })}
      className="w-full h-[42px] rounded-[10px] border border-[#e5e7eb] hover:border-[#d1d5db] duration-150 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      使用 Google 登录
    </Button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="google-login-button"
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add components/layout/google-login-button.tsx __tests__/google-login-button.test.tsx
git commit -m "feat: add GoogleLoginButton component"
```

---

## Task 3: Update login page to show Google button

**Files:**
- Modify: `app/login/page.tsx`

### Context

`app/login/page.tsx` currently renders `<LoginButton />` (GitHub) above a divider and `<GuestLoginButtons />` below. Add `<GoogleLoginButton />` directly below `<LoginButton />`, before the divider. No new tests needed — this is a layout-only change to a server component with no logic.

- [ ] **Step 1: Update `app/login/page.tsx`**

```typescript
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginButton } from "@/components/layout/login-button";
import { GoogleLoginButton } from "@/components/layout/google-login-button";
import { GuestLoginButtons } from "@/components/layout/guest-login-buttons";

const LOGIN_AGENT_CARDS = [
  { icon: "📋", role: "PM", label: "需求分析" },
  { icon: "🏗️", role: "Architect", label: "方案设计" },
  { icon: "👨‍💻", role: "Engineer", label: "代码生成" },
] as const;

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#eef2ff] via-[#ede9fe] to-[#faf5ff]">
      <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(79,70,229,0.14),0_2px_8px_rgba(0,0,0,0.04)] p-8 w-full max-w-[340px] text-center">

        {/* Logo */}
        <div className="mb-6">
          <h1 className="text-[22px] font-black text-[#030712] tracking-[-0.5px]">
            Builder<span className="text-indigo-600">AI</span>
          </h1>
          <p className="text-[12px] text-[#6b7280] mt-1">
            用自然语言构建 Web 应用
          </p>
        </div>

        {/* Agent cards */}
        <div className="flex gap-2 mb-6">
          {LOGIN_AGENT_CARDS.map((agent) => (
            <div
              key={agent.role}
              className="flex-1 bg-[#f5f3ff] border border-[#ede9fe] rounded-[12px] py-3 px-2 text-center"
            >
              <div className="text-xl mb-1">{agent.icon}</div>
              <div className="text-[10px] font-bold text-indigo-600">{agent.role}</div>
              <div className="text-[10px] text-[#9ca3af] mt-0.5">{agent.label}</div>
            </div>
          ))}
        </div>

        {/* OAuth login buttons */}
        <div className="flex flex-col gap-2">
          <LoginButton />
          <GoogleLoginButton />
        </div>

        {/* Divider */}
        <div className="relative my-3">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#f3f4f6]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-[#d1d5db]">或</span>
          </div>
        </div>

        {/* Guest login */}
        <GuestLoginButtons />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite to verify nothing regressed**

```bash
npm test
```

Expected: All existing tests pass. No new failures.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: add Google login button to login page"
```

---

## Task 4: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Google env vars to `.env.example`**

Find the `# --- Auth ---` section and update it:

```
# --- Auth ---

# GitHub OAuth (optional if Guest-only mode is sufficient)
GITHUB_ID=Ov23li...
GITHUB_SECRET=abc123...

# Google OAuth
# Setup: console.cloud.google.com → APIs & Services → Credentials → Create OAuth 2.0 Client ID
# Authorized redirect URI: {NEXTAUTH_URL}/api/auth/callback/google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# NextAuth
# Generate with: openssl rand -base64 32
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.example"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass
- [ ] `npm run build` — production build succeeds (catches any type errors)
- [ ] Dev server: GitHub login button → GitHub shows account chooser (not cached account's 2FA)
- [ ] Dev server: Google login button → redirects to Google sign-in
- [ ] Dev server: Guest login — unaffected
