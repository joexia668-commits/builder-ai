# Auth: Email Magic Link + GitHub Fix + Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub account-switching bug, add Email Magic Link login (any email), and add a read-only Demo Mode that shows the developer's test projects to visitors.

**Architecture:** Three independent auth additions to `lib/auth.ts` (GitHub fix, EmailProvider with Resend, demo CredentialsProvider). Demo mode is enforced at the API layer via `session.user.isDemo` checks. The Workspace UI reads `isDemo` from the server session and shows a banner + disables ChatInput. No global store changes needed.

**Tech Stack:** NextAuth v4, `next-auth/providers/email`, `resend` SDK, Prisma, React, Tailwind, Jest + Testing Library

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add `isDemoViewer Boolean @default(false)` to `User` |
| `lib/resend.ts` | Create | Resend client singleton |
| `lib/demo-bootstrap.ts` | Create | Auto-create demo viewer account on first run |
| `lib/auth.ts` | Modify | GitHub fix; EmailProvider; demo CredentialsProvider; extended JWT/session types |
| `components/layout/email-login-form.tsx` | Create | Controlled email input + submit → `signIn("email", ...)` |
| `components/layout/demo-login-button.tsx` | Create | Button → `signIn("demo", ...)` |
| `components/layout/demo-banner.tsx` | Create | Fixed read-only warning banner for demo users |
| `app/login/page.tsx` | Modify | Add email form + demo button between GitHub and Guest |
| `app/project/[id]/page.tsx` | Modify | Allow demo viewer to read `DEMO_USER_ID` projects; pass `isDemo` to Workspace |
| `components/workspace/workspace.tsx` | Modify | Accept `isDemo` prop; render DemoBanner; pass `disabled` to ChatInput |
| `app/api/projects/route.ts` | Modify | Demo GET returns `DEMO_USER_ID` projects; 403 on POST |
| `app/api/projects/[id]/route.ts` | Modify | Allow demo GET on `DEMO_USER_ID` project; 403 on PATCH/DELETE |
| `app/api/messages/route.ts` | Modify | 403 on POST for demo |
| `app/api/versions/route.ts` | Modify | 403 on POST for demo; allow GET on `DEMO_USER_ID` projects |
| `app/api/versions/[id]/restore/route.ts` | Modify | 403 on POST for demo |
| `app/api/generate/handler.ts` | Modify | 403 on POST for demo (uses `getToken`, not `getServerSession`) |
| `.env.example` | Modify | Add `RESEND_API_KEY`, `EMAIL_FROM`, `DEMO_USER_ID`, `DEMO_VIEWER_ID` |
| `__tests__/auth-config.test.ts` | Create | authOptions has GitHub fix, email provider, demo provider |
| `__tests__/email-login-form.test.tsx` | Create | EmailLoginForm component tests |
| `__tests__/demo-login-button.test.tsx` | Create | DemoLoginButton component tests |
| `__tests__/demo-banner.test.tsx` | Create | DemoBanner renders correct text |
| `__tests__/demo-api-protection.test.ts` | Create | API routes return 403 for demo session |

---

## Task 1: Schema — add isDemoViewer field

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `isDemoViewer` to the `User` model**

In `prisma/schema.prisma`, find the `User` model and add the field after `isGuest`:

```prisma
model User {
  id             String    @id @default(cuid())
  name           String?
  email          String?   @unique
  emailVerified  DateTime?
  image          String?
  isGuest        Boolean   @default(false)
  isDemoViewer   Boolean   @default(false)
  preferredModel String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  accounts       Account[]
  projects       Project[]
  sessions       Session[]
}
```

- [ ] **Step 2: Push schema to DB**

```bash
npx prisma db push
```

Expected output: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add isDemoViewer field to User schema"
```

---

## Task 2: Install Resend + create singletons

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/resend.ts`
- Create: `lib/demo-bootstrap.ts`

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
  globalForResend.resend ?? new Resend(process.env.RESEND_API_KEY);

if (process.env.NODE_ENV !== "production") {
  globalForResend.resend = resend;
}
```

- [ ] **Step 3: Create `lib/demo-bootstrap.ts`**

```typescript
import { prisma } from "@/lib/prisma";

/**
 * Ensures a demo viewer account exists in the DB.
 * Call once at module init (imported by lib/auth.ts).
 *
 * If DEMO_VIEWER_ID is set but the user doesn't exist, creates it.
 * If DEMO_VIEWER_ID is not set, logs a warning — demo login will fail gracefully.
 */
export async function ensureDemoViewer(): Promise<void> {
  const id = process.env.DEMO_VIEWER_ID;
  if (!id) {
    console.warn("[demo-bootstrap] DEMO_VIEWER_ID is not set — demo login disabled");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    await prisma.user.create({
      data: { id, name: "Demo Viewer", isDemoViewer: true },
    });
    console.log(`[demo-bootstrap] Created demo viewer with id: ${id}`);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/resend.ts lib/demo-bootstrap.ts
git commit -m "feat: add Resend singleton and demo-bootstrap utility"
```

---

## Task 3: Update auth config (GitHub fix + Email + Demo providers)

**Files:**
- Modify: `lib/auth.ts`
- Create: `__tests__/auth-config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/auth-config.test.ts`:

```typescript
import { authOptions } from "@/lib/auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

jest.mock("@/lib/resend", () => ({
  resend: { emails: { send: jest.fn() } },
}));
jest.mock("@/lib/demo-bootstrap", () => ({
  ensureDemoViewer: jest.fn(),
}));

describe("authOptions providers", () => {
  it("GitHub provider has login param to force account selection", () => {
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

  it("includes a demo credentials provider", () => {
    const demo = authOptions.providers.find(
      (p) => (p as { id?: string }).id === "demo"
    );
    expect(demo).toBeDefined();
  });

  it("still includes the guest credentials provider", () => {
    const guest = authOptions.providers.find(
      (p) => (p as { id?: string }).id === "credentials"
    );
    expect(guest).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="auth-config"
```

Expected: FAIL — email and demo providers not found, GitHub param missing.

- [ ] **Step 3: Replace `lib/auth.ts`**

```typescript
import { PrismaAdapter } from "@auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { resend } from "@/lib/resend";
import { ensureDemoViewer } from "@/lib/demo-bootstrap";
import { findGuestUser } from "@/app/api/auth/guest/guest-service";

// Ensure demo viewer account exists on cold start
ensureDemoViewer().catch(console.error);

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
      id: "demo",
      name: "Demo",
      credentials: {},
      async authorize() {
        const id = process.env.DEMO_VIEWER_ID;
        if (!id) return null;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user?.isDemoViewer) return null;
        return { id: user.id, name: "Demo Viewer", email: null, isDemo: true };
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
        token.isDemo = (user as { isDemo?: boolean }).isDemo ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isDemo = (token.isDemo as boolean) ?? false;
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
      isDemo?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    isDemo?: boolean;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="auth-config"
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts __tests__/auth-config.test.ts
git commit -m "feat: add EmailProvider, demo CredentialsProvider, and fix GitHub account-switching"
```

---

## Task 4: Create EmailLoginForm component

**Files:**
- Create: `components/layout/email-login-form.tsx`
- Create: `__tests__/email-login-form.test.tsx`

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
  beforeEach(() => jest.clearAllMocks());

  it("renders an email input and submit button", () => {
    render(<EmailLoginForm />);
    expect(screen.getByRole("textbox", { name: /邮箱/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /发送登录链接/i })).toBeInTheDocument();
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
    mockSignIn.mockReturnValue(new Promise(() => {}));
    render(<EmailLoginForm />);
    fireEvent.change(screen.getByRole("textbox", { name: /邮箱/i }), {
      target: { value: "user@163.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送登录链接/i }));
    expect(screen.getByRole("button", { name: /发送登录链接/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="email-login-form"
```

Expected: FAIL — module not found.

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
        placeholder="输入邮箱地址（QQ、163 等均可）"
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
git commit -m "feat: add EmailLoginForm component"
```

---

## Task 5: Create DemoLoginButton + DemoBanner components

**Files:**
- Create: `components/layout/demo-login-button.tsx`
- Create: `components/layout/demo-banner.tsx`
- Create: `__tests__/demo-login-button.test.tsx`
- Create: `__tests__/demo-banner.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/demo-login-button.test.tsx`:

```typescript
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DemoLoginButton } from "@/components/layout/demo-login-button";

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

describe("DemoLoginButton", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders a button with demo text", () => {
    render(<DemoLoginButton />);
    expect(screen.getByRole("button", { name: /查看演示项目/i })).toBeInTheDocument();
  });

  it('calls signIn("demo") with callbackUrl "/" on click', () => {
    render(<DemoLoginButton />);
    fireEvent.click(screen.getByRole("button", { name: /查看演示项目/i }));
    expect(mockSignIn).toHaveBeenCalledWith("demo", { callbackUrl: "/" });
  });
});
```

Create `__tests__/demo-banner.test.tsx`:

```typescript
import React from "react";
import { render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/layout/demo-banner";

describe("DemoBanner", () => {
  it("renders the read-only warning message", () => {
    render(<DemoBanner />);
    expect(screen.getByText(/演示模式/i)).toBeInTheDocument();
    expect(screen.getByText(/无法编辑/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="demo-login-button|demo-banner"
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `components/layout/demo-login-button.tsx`**

```typescript
"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function DemoLoginButton() {
  return (
    <Button
      variant="outline"
      onClick={() => signIn("demo", { callbackUrl: "/" })}
      className="w-full h-[42px] rounded-[10px] border-[1.5px] border-[#e5e7eb] text-[#6b7280] hover:border-[#d1d5db] hover:text-[#374151] duration-150"
    >
      查看演示项目
    </Button>
  );
}
```

- [ ] **Step 4: Create `components/layout/demo-banner.tsx`**

```typescript
export function DemoBanner() {
  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
      当前为<strong>演示模式</strong>，仅可查看开发者测试项目，无法编辑
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="demo-login-button|demo-banner"
```

Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add components/layout/demo-login-button.tsx components/layout/demo-banner.tsx \
  __tests__/demo-login-button.test.tsx __tests__/demo-banner.test.tsx
git commit -m "feat: add DemoLoginButton and DemoBanner components"
```

---

## Task 6: Update login page UI

**Files:**
- Modify: `app/login/page.tsx`

- [ ] **Step 1: Replace `app/login/page.tsx`**

```typescript
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginButton } from "@/components/layout/login-button";
import { EmailLoginForm } from "@/components/layout/email-login-form";
import { DemoLoginButton } from "@/components/layout/demo-login-button";
import { GuestLoginButtons } from "@/components/layout/guest-login-buttons";

const LOGIN_AGENT_CARDS = [
  { icon: "📋", role: "PM", label: "需求分析" },
  { icon: "🏗️", role: "Architect", label: "方案设计" },
  { icon: "👨‍💻", role: "Engineer", label: "代码生成" },
] as const;

function Divider() {
  return (
    <div className="relative my-3">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-[#f3f4f6]" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-white px-2 text-[#d1d5db]">或</span>
      </div>
    </div>
  );
}

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/");

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

        <LoginButton />
        <Divider />
        <EmailLoginForm />
        <Divider />
        <DemoLoginButton />
        <Divider />
        <GuestLoginButtons />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All existing tests pass. No new failures.

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: update login page with email form and demo button"
```

---

## Task 7: Demo-protect API routes

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Modify: `app/api/messages/route.ts`
- Modify: `app/api/versions/route.ts`
- Modify: `app/api/versions/[id]/restore/route.ts`
- Modify: `app/api/generate/handler.ts`
- Create: `__tests__/demo-api-protection.test.ts`

### Context

A demo session has `session.user.isDemo === true`. Write routes must return `403` immediately after auth check. Read routes for projects/versions must use `DEMO_USER_ID` instead of the demo viewer's own (empty) user ID. `generate/handler.ts` uses `getToken` (Edge Runtime) — check `token.isDemo` there.

- [ ] **Step 1: Write failing tests**

Create `__tests__/demo-api-protection.test.ts`:

```typescript
import { GET as projectsGET, POST as projectsPOST } from "@/app/api/projects/route";
import { POST as messagesPOST } from "@/app/api/messages/route";
import { POST as versionsPOST } from "@/app/api/versions/route";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => mockGetServerSession(...args) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    message: { create: jest.fn() },
    version: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

const demoSession = { user: { id: "demo_viewer_id", isDemo: true } };

function makeReq(body?: object): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Demo mode API protection", () => {
  beforeEach(() => mockGetServerSession.mockResolvedValue(demoSession));

  it("POST /api/projects returns 403 for demo user", async () => {
    const res = await projectsPOST(makeReq({ name: "New Project" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/messages returns 403 for demo user", async () => {
    const res = await messagesPOST(makeReq({ projectId: "p1", role: "user", content: "hi" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/versions returns 403 for demo user", async () => {
    const res = await versionsPOST(makeReq({ projectId: "p1", code: "x" }));
    expect(res.status).toBe(403);
  });

  it("GET /api/projects returns projects for demo user (no 403)", async () => {
    process.env.DEMO_USER_ID = "developer_id";
    const res = await projectsGET();
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="demo-api-protection"
```

Expected: FAIL — routes don't check `isDemo` yet, POST returns 201/400 instead of 403.

- [ ] **Step 3: Update `app/api/projects/route.ts`**

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.isDemo
    ? process.env.DEMO_USER_ID!
    : session.user.id;

  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      userId: session.user.id,
    },
  });

  return NextResponse.json(project, { status: 201 });
}
```

- [ ] **Step 4: Update `app/api/projects/[id]/route.ts`**

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidModelId } from "@/lib/model-registry";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowedUserId = session.user.isDemo
    ? process.env.DEMO_USER_ID!
    : session.user.id;

  if (project.userId !== allowedUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(project);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, currentCode, preferredModel } = body;

  if (preferredModel !== undefined && preferredModel !== null) {
    if (!isValidModelId(preferredModel)) {
      return NextResponse.json(
        { error: "Unknown modelId: " + preferredModel },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.project.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() ?? null }),
      ...(currentCode !== undefined && { currentCode }),
      ...(preferredModel !== undefined && { preferredModel: preferredModel ?? null }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.project.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: Update `app/api/messages/route.ts`** — add demo guard after auth check

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { saveMessage } from "./message-service";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { projectId, role, content, metadata } = body as {
    projectId: string;
    role: string;
    content: string;
    metadata?: Prisma.InputJsonValue;
  };

  if (!projectId || !role || !content) {
    return NextResponse.json(
      { error: "projectId, role, content are required" },
      { status: 400 }
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });

  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const message = await saveMessage({ projectId, role, content, metadata });
  return NextResponse.json(message, { status: 201 });
}
```

- [ ] **Step 6: Update `app/api/versions/route.ts`** — demo guard on POST; demo-aware GET

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const allowedUserId = session.user.isDemo
    ? process.env.DEMO_USER_ID!
    : session.user.id;

  const versions = await prisma.version.findMany({
    where: { projectId, project: { userId: allowedUserId } },
    orderBy: { versionNumber: "asc" },
  });

  return NextResponse.json({ versions });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { projectId, code, files, description } = body as {
    projectId?: string;
    code?: string;
    files?: Record<string, string>;
    description?: string;
  };

  const effectiveCode = files?.["/App.js"] ?? code;
  if (!projectId || !effectiveCode) {
    return NextResponse.json(
      { error: "projectId and (code or files with /App.js) are required" },
      { status: 400 }
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lastVersion = await prisma.version.findFirst({
    where: { projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const version = await prisma.version.create({
    data: {
      projectId,
      code: effectiveCode,
      ...(files ? { files } : {}),
      description,
      versionNumber,
    },
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(version, { status: 201 });
}
```

- [ ] **Step 7: Update `app/api/versions/[id]/restore/route.ts`** — add demo guard

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sourceVersion = await prisma.version.findFirst({
    where: { id: params.id, project: { userId: session.user.id } },
  });
  if (!sourceVersion) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lastVersion = await prisma.version.findFirst({
    where: { projectId: sourceVersion.projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const newVersion = await prisma.version.create({
    data: {
      projectId: sourceVersion.projectId,
      code: sourceVersion.code,
      ...(sourceVersion.files ? { files: sourceVersion.files as Record<string, string> } : {}),
      description: `从 v${sourceVersion.versionNumber} 恢复`,
      versionNumber,
    },
  });

  return NextResponse.json(newVersion, { status: 201 });
}
```

- [ ] **Step 8: Update `app/api/generate/handler.ts`** — add demo guard after token check

Find the lines after `const token = await getToken({ req });` and add the demo check:

```typescript
const token = await getToken({ req });
if (!token) {
  return new Response("Unauthorized", { status: 401 });
}
if (token.isDemo) {
  return new Response("Forbidden", { status: 403 });
}
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="demo-api-protection"
```

Expected: PASS — all 4 tests green.

- [ ] **Step 10: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add app/api/projects/route.ts app/api/projects/[id]/route.ts \
  app/api/messages/route.ts app/api/versions/route.ts \
  app/api/versions/[id]/restore/route.ts app/api/generate/handler.ts \
  __tests__/demo-api-protection.test.ts
git commit -m "feat: enforce demo mode read-only restrictions across all write API routes"
```

---

## Task 8: Update Workspace UI for demo mode

**Files:**
- Modify: `app/project/[id]/page.tsx`
- Modify: `components/workspace/workspace.tsx`

### Context

`app/project/[id]/page.tsx` reads the session server-side. Pass `isDemo` to `Workspace`. `Workspace` renders `DemoBanner` at the top and passes `disabled={true}` to `ChatInput` when demo. The `ChatInput` already handles `disabled` prop — its textarea shows a placeholder and the submit button is disabled. Update the placeholder text to say "演示模式，无法发送消息" when `isDemo`.

- [ ] **Step 1: Update `app/project/[id]/page.tsx`**

```typescript
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { Workspace } from "@/components/workspace/workspace";
import type { Project, ProjectMessage, ProjectVersion } from "@/lib/types";

interface PageProps {
  params: { id: string };
}

export default async function ProjectPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const isDemo = session.user.isDemo ?? false;
  const allowedUserId = isDemo ? process.env.DEMO_USER_ID! : session.user.id;

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: allowedUserId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { versionNumber: "asc" } },
    },
  });

  if (!project) notFound();

  const allProjects = await prisma.project.findMany({
    where: { userId: allowedUserId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />
      <Workspace
        project={project as unknown as Project & { messages: ProjectMessage[]; versions: ProjectVersion[] }}
        allProjects={allProjects}
        isDemo={isDemo}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update `components/workspace/workspace.tsx`**

Add `isDemo` to `WorkspaceProps` and wire it up:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConversationSidebar } from "@/components/sidebar/conversation-sidebar";
import { ChatArea } from "@/components/workspace/chat-area";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getVersionFiles } from "@/lib/version-files";
import type { Project, ProjectMessage, ProjectVersion, PmOutput } from "@/lib/types";

interface WorkspaceProps {
  project: Project & {
    messages: ProjectMessage[];
    versions: ProjectVersion[];
  };
  allProjects: { id: string; name: string; updatedAt: Date }[];
  isDemo?: boolean;
}

type MobileTab = "chat" | "preview";

export function Workspace({ project, allProjects, isDemo = false }: WorkspaceProps) {
  const router = useRouter();
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");

  useEffect(() => {
    function handleOffline() {
      toast.error("网络已断开，请检查你的网络连接");
    }
    function handleOnline() {
      toast.success("网络已恢复");
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const lastVersion = project.versions[project.versions.length - 1];
  const [currentFiles, setCurrentFiles] = useState<Record<string, string>>(
    lastVersion ? getVersionFiles(lastVersion as { code: string; files?: Record<string, string> | null }) : {}
  );
  const [versions, setVersions] = useState<ProjectVersion[]>(project.versions);
  const [messages, setMessages] = useState<ProjectMessage[]>(project.messages);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewingVersion, setPreviewingVersion] = useState<ProjectVersion | null>(null);
  const [lastPmOutput, setLastPmOutput] = useState<PmOutput | null>(null);

  const displayFiles = previewingVersion
    ? getVersionFiles(previewingVersion as { code: string; files?: Record<string, string> | null })
    : currentFiles;

  function handleRestoreVersion(newVersion: ProjectVersion) {
    setCurrentFiles(
      getVersionFiles(newVersion as { code: string; files?: Record<string, string> | null })
    );
    setVersions((prev) => [...prev, newVersion]);
    setPreviewingVersion(null);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {isDemo && <DemoBanner />}

      {/* Mobile tab bar */}
      <div className="flex md:hidden border-b bg-white shrink-0">
        <button
          data-testid="mobile-tab-chat"
          data-active={mobileTab === "chat"}
          onClick={() => setMobileTab("chat")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mobileTab === "chat"
              ? "text-indigo-600 border-b-2 border-indigo-600"
              : "text-gray-500"
          }`}
        >
          对话
        </button>
        <button
          data-testid="mobile-tab-preview"
          data-active={mobileTab === "preview"}
          onClick={() => setMobileTab("preview")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mobileTab === "preview"
              ? "text-indigo-600 border-b-2 border-indigo-600"
              : "text-gray-500"
          }`}
        >
          预览
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="hidden md:flex shrink-0">
          <ConversationSidebar
            currentProjectId={project.id}
            projects={allProjects}
          />
        </div>

        <div
          className={`flex-1 flex flex-col overflow-hidden border-r md:flex ${
            mobileTab === "chat" ? "flex" : "hidden md:flex"
          }`}
        >
          <ChatArea
            initialModel={project.preferredModel ?? undefined}
            project={project}
            messages={messages}
            onMessagesChange={setMessages}
            onGeneratingChange={setIsGenerating}
            isPreviewingHistory={previewingVersion !== null}
            isDemo={isDemo}
            currentFiles={currentFiles}
            lastPmOutput={lastPmOutput}
            onPmOutputGenerated={setLastPmOutput}
            onFilesGenerated={(files, version) => {
              setCurrentFiles(files);
              setVersions((prev) => [...prev, version]);
              setPreviewingVersion(null);
            }}
            onNewProject={() => router.push("/")}
          />
        </div>

        <div
          className={`relative flex-1 flex flex-col overflow-hidden ${
            mobileTab === "preview" ? "flex" : "hidden md:flex"
          }`}
        >
          <PreviewPanel
            files={displayFiles}
            projectId={project.id}
            isGenerating={isGenerating}
            onFilesChange={setCurrentFiles}
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={setPreviewingVersion}
            onVersionRestore={handleRestoreVersion}
            latestVersionId={versions[versions.length - 1]?.id}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `ChatArea` to accept and use `isDemo` prop**

In `components/workspace/chat-area.tsx`, find the `ChatAreaProps` interface and add `isDemo?: boolean`. Then find where `<ChatInput>` is rendered and pass `disabled={isDemo || isGenerating}`. Also update the placeholder: in `chat-input.tsx`, add a condition for `isDemo` prop — pass `isDemo` to `ChatInput` and update the placeholder logic:

In `components/workspace/chat-input.tsx`, add `isDemo?: boolean` to `ChatInputProps` and update the placeholder:

```typescript
placeholder={
  isDemo
    ? "演示模式，无法发送消息"
    : isPreviewingHistory
    ? "正在预览历史版本，请返回当前版本后再发送"
    : disabled
    ? "AI 正在生成中..."
    : "描述你想要的应用（Enter 发送，Shift+Enter 换行）"
}
disabled={disabled || isDemo}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/project/[id]/page.tsx components/workspace/workspace.tsx \
  components/workspace/chat-area.tsx components/workspace/chat-input.tsx
git commit -m "feat: show DemoBanner and disable ChatInput in demo mode"
```

---

## Task 9: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add new env vars to `.env.example`**

Find `# --- Auth ---` section and replace with:

```
# --- Auth ---

# GitHub OAuth (optional if Guest-only mode is sufficient)
GITHUB_ID=Ov23li...
GITHUB_SECRET=abc123...

# Email Magic Link (via Resend — resend.com)
# 1. Sign up, verify your domain, create an API key
# 2. EMAIL_FROM format: "BuilderAI <noreply@yourdomain.com>"
RESEND_API_KEY=re_...
EMAIL_FROM=BuilderAI <noreply@yourdomain.com>

# Demo Mode
# DEMO_USER_ID: your (developer) real userId — whose projects are shown in demo
# DEMO_VIEWER_ID: a fixed userId for the demo viewer account
#   First run: leave DEMO_VIEWER_ID blank, start the server, copy the printed ID, then set it here
DEMO_USER_ID=
DEMO_VIEWER_ID=

# NextAuth
# Generate with: openssl rand -base64 32
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add RESEND_API_KEY, EMAIL_FROM, DEMO_USER_ID, DEMO_VIEWER_ID to .env.example"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm test` — all tests pass
- [ ] `npm run build` — production build succeeds (type-checks everything)
- [ ] **GitHub login**: clicking button always shows GitHub account chooser
- [ ] **Email login**: enter QQ/163 address → magic link email arrives → click → session created, same email reuses same user record on subsequent logins
- [ ] **Demo login**: click "查看演示项目" → session with `isDemo: true` → redirected to project list showing `DEMO_USER_ID`'s projects → DemoBanner visible → ChatInput disabled with "演示模式，无法发送消息"
- [ ] **Demo API protection**: any write attempt returns 403 (try opening DevTools and calling the API directly)
- [ ] **Guest login**: fully unaffected

## First-Time Demo Setup

1. Leave `DEMO_VIEWER_ID` blank in `.env.local`
2. Start the server: `npm run dev`
3. Check terminal output for: `[demo-bootstrap] Created demo viewer with id: <id>`
4. Copy that ID into `DEMO_VIEWER_ID=<id>` in `.env.local`
5. Set `DEMO_USER_ID` to your own userId (find it in Prisma Studio: `npx prisma studio`)
6. Restart the server
