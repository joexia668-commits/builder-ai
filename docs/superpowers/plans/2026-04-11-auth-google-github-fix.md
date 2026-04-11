# Auth: Email Magic Link + GitHub Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub account-switching bug and add Email Magic Link login so any user with any email address can sign in without needing a GitHub account.

**Architecture:** Add `EmailProvider` (NextAuth built-in) to `lib/auth.ts` using Resend SDK for email delivery. `VerificationToken` model already exists in schema — no DB migration needed. New `EmailLoginForm` component handles email input on the login page. GitHub one-liner fix prevents cached-session account confusion.

**Tech Stack:** NextAuth v4 `EmailProvider`, `resend` SDK (new dependency), React, Tailwind, Jest + Testing Library

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/auth.ts` | Modify | Add GitHub `login` param; add `EmailProvider` with Resend `sendVerificationRequest` |
| `lib/resend.ts` | Create | Resend client singleton (same pattern as `lib/prisma.ts`) |
| `components/layout/email-login-form.tsx` | Create | Email input form — controlled input + submit → `signIn("email", ...)` |
| `app/login/page.tsx` | Modify | Add `EmailLoginForm` between GitHub button and Guest section |
| `.env.example` | Modify | Add `RESEND_API_KEY`, `EMAIL_FROM` |
| `__tests__/auth-config.test.ts` | Create | Verify authOptions has GitHub fix + email provider |
| `__tests__/email-login-form.test.tsx` | Create | Component tests for `EmailLoginForm` |

---

## Task 1: Install Resend and create Resend client singleton

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/resend.ts`

- [ ] **Step 1: Install resend**

```bash
npm install resend
```

Expected: `resend` appears in `package.json` dependencies.

- [ ] **Step 2: Create `lib/resend.ts`**

```typescript
import { Resend } from "resend";

const globalForResend = globalThis as unknown as { resend: Resend };

export const resend =
  globalForResend.resend ||
  new Resend(process.env.RESEND_API_KEY);

if (process.env.NODE_ENV !== "production") {
  globalForResend.resend = resend;
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json lib/resend.ts
git commit -m "feat: add Resend client singleton for email delivery"
```

---

## Task 2: Fix GitHub login + add EmailProvider to auth config

**Files:**
- Modify: `lib/auth.ts`
- Create: `__tests__/auth-config.test.ts`

### Context

`lib/auth.ts` currently exports `authOptions` with `GithubProvider` and `CredentialsProvider` (Guest).

- GitHub fix: `authorization: { params: { login: "" } }` — forces GitHub to always show account chooser instead of reusing the browser's active GitHub session.
- `EmailProvider` uses `sendVerificationRequest` with Resend SDK. NextAuth stores the token in the `VerificationToken` table (already in schema) and redirects user to check their email. When user clicks the link, NextAuth validates the token and creates a JWT session.

- [ ] **Step 1: Write failing tests**

Create `__tests__/auth-config.test.ts`:

```typescript
import { authOptions } from "@/lib/auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

// Prevent Resend from making real network calls during tests
jest.mock("@/lib/resend", () => ({
  resend: { emails: { send: jest.fn() } },
}));

describe("authOptions", () => {
  it("includes a GitHub provider with login param to force account selection", () => {
    const github = authOptions.providers.find(
      (p) => (p as OAuthConfig<unknown>).id === "github"
    ) as OAuthConfig<unknown> | undefined;
    expect(github).toBeDefined();
    expect(
      (github?.authorization as { params?: { login?: string } })?.params?.login
    ).toBe("");
  });

  it("includes an email provider", () => {
    const email = authOptions.providers.find(
      (p) => (p as { id?: string }).id === "email"
    );
    expect(email).toBeDefined();
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

Expected: FAIL — email provider not found, GitHub `login` param missing.

- [ ] **Step 3: Update `lib/auth.ts`**

```typescript
import { PrismaAdapter } from "@auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { resend } from "@/lib/resend";
import { findGuestUser } from "@/app/api/auth/guest/guest-service";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      authorization: { params: { login: "" } },
    }),
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
git commit -m "feat: add EmailProvider with Resend and fix GitHub account-switching"
```

---

## Task 3: Create EmailLoginForm component

**Files:**
- Create: `components/layout/email-login-form.tsx`
- Create: `__tests__/email-login-form.test.tsx`

### Context

Controlled form with a single email `<input>` and a submit button. On submit it calls `signIn("email", { email, callbackUrl: "/" })` from `next-auth/react`. NextAuth handles the redirect to a "check your email" page (`/api/auth/verify-request`). Shows a loading state while submitting to prevent double-submit.

- [ ] **Step 1: Write failing tests**

Create `__tests__/email-login-form.test.tsx`:

```typescript
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmailLoginForm } from "@/components/layout/email-login-form";

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

describe("EmailLoginForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders an email input and a submit button", () => {
    render(<EmailLoginForm />);
    expect(screen.getByRole("textbox", { name: /邮箱/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /发送登录链接/i })
    ).toBeInTheDocument();
  });

  it("calls signIn with the entered email on submit", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    render(<EmailLoginForm />);

    fireEvent.change(screen.getByRole("textbox", { name: /邮箱/i }), {
      target: { value: "user@qq.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送登录链接/i }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("email", {
        email: "user@qq.com",
        callbackUrl: "/",
      });
    });
  });

  it("disables the button while submitting", async () => {
    mockSignIn.mockReturnValue(new Promise(() => {})); // never resolves
    render(<EmailLoginForm />);

    fireEvent.change(screen.getByRole("textbox", { name: /邮箱/i }), {
      target: { value: "user@163.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送登录链接/i }));

    expect(
      screen.getByRole("button", { name: /发送登录链接/i })
    ).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="email-login-form"
```

Expected: FAIL — module `@/components/layout/email-login-form` not found.

- [ ] **Step 3: Create `components/layout/email-login-form.tsx`**

```typescript
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EmailLoginForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    try {
      await signIn("email", { email, callbackUrl: "/" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full">
      <label htmlFor="email-input" className="sr-only">
        邮箱
      </label>
      <Input
        id="email-input"
        type="email"
        placeholder="输入邮箱地址"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        className="h-[42px] rounded-[10px] border-[#e5e7eb] text-sm"
        required
      />
      <Button
        type="submit"
        variant="outline"
        disabled={isLoading || !email}
        className="w-full h-[42px] rounded-[10px] border-[1.5px] border-indigo-200 text-indigo-600 hover:bg-indigo-50 duration-150"
      >
        发送登录链接
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="email-login-form"
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/layout/email-login-form.tsx __tests__/email-login-form.test.tsx
git commit -m "feat: add EmailLoginForm component with loading state"
```

---

## Task 4: Update login page UI

**Files:**
- Modify: `app/login/page.tsx`

### Context

Add a second divider + `EmailLoginForm` between the GitHub button and the Guest section. The `EmailLoginForm` is a Client Component so the page import is straightforward — Next.js handles the server/client boundary automatically.

- [ ] **Step 1: Update `app/login/page.tsx`**

```typescript
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginButton } from "@/components/layout/login-button";
import { EmailLoginForm } from "@/components/layout/email-login-form";
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

        {/* GitHub login */}
        <LoginButton />

        {/* Divider */}
        <div className="relative my-3">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#f3f4f6]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-2 text-[#d1d5db]">或</span>
          </div>
        </div>

        {/* Email magic link */}
        <EmailLoginForm />

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

Expected: All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: add email magic link form to login page"
```

---

## Task 5: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add email env vars to `.env.example`**

Find the `# --- Auth ---` section and update it:

```
# --- Auth ---

# GitHub OAuth (optional if Guest-only mode is sufficient)
GITHUB_ID=Ov23li...
GITHUB_SECRET=abc123...

# Email Magic Link (via Resend)
# Sign up at resend.com, verify your domain, create an API key
# EMAIL_FROM format: "BuilderAI <noreply@yourdomain.com>"
RESEND_API_KEY=re_...
EMAIL_FROM=BuilderAI <noreply@yourdomain.com>

# NextAuth
# Generate with: openssl rand -base64 32
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add RESEND_API_KEY and EMAIL_FROM to .env.example"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass
- [ ] `npm run build` — production build succeeds
- [ ] Dev server: GitHub login → GitHub shows account chooser (not cached account's 2FA)
- [ ] Dev server: Email form → enter QQ/163/Gmail address → email arrives with login link → click link → session created
- [ ] Dev server: Guest login — unaffected
