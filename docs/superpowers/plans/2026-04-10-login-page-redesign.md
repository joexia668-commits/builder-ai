# Login Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the login page to a light-gradient landing-page style with prominent Agent cards, upgraded button styles, and a polished white floating card.

**Architecture:** Pure Tailwind class changes across three files — no logic changes, no new dependencies. The `/ui-ux-pro-max` skill is invoked before each component is written to produce precise, production-quality style values.

**Tech Stack:** Next.js 14, Tailwind CSS, shadcn/ui (Button), next-auth

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/login/page.tsx` | Modify | Page layout, gradient background, card shell, Agent cards, tagline |
| `components/layout/login-button.tsx` | Modify | GitHub login button style |
| `components/layout/guest-login-buttons.tsx` | Modify | Guest button styles (outline + ghost) |

---

### Task 1: Baseline — run existing tests

- [ ] **Step 1: Run the guest-login-buttons tests to confirm they pass before any changes**

```bash
npm test -- --testPathPatterns="guest-login-buttons"
```

Expected output: `Tests: 6 passed, 6 total` (all green)

- [ ] **Step 2: Commit nothing — this is a baseline check only**

---

### Task 2: Upgrade `LoginButton` styles

**Files:**
- Modify: `components/layout/login-button.tsx`

- [ ] **Step 1: Invoke `/ui-ux-pro-max` skill for GitHub button design**

Before editing, invoke the `ui-ux-pro-max` skill with this prompt:
> "Design a GitHub login button for a Next.js app using Tailwind CSS. Indigo primary color (#4f46e5), full-width, rounded-[10px], height 42px, white text, GitHub SVG icon on the left with gap-[7px]. On hover: purple glow shadow `0_4px_16px_rgba(79,70,229,0.3)`. Use shadcn Button component. Give me the exact className string."

Apply the output's className to the Button below.

- [ ] **Step 2: Replace `components/layout/login-button.tsx` with the upgraded version**

```tsx
"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LoginButton() {
  return (
    <Button
      onClick={() => signIn("github", { callbackUrl: "/" })}
      className="w-full h-[42px] rounded-[10px] transition-all duration-150 hover:shadow-[0_4px_16px_rgba(79,70,229,0.3)]"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
      </svg>
      使用 GitHub 登录
    </Button>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/layout/login-button.tsx
git commit -m "style: upgrade GitHub login button with rounded corners and hover glow"
```

---

### Task 3: Upgrade `GuestLoginButtons` styles

**Files:**
- Modify: `components/layout/guest-login-buttons.tsx`

- [ ] **Step 1: Invoke `/ui-ux-pro-max` skill for guest button design**

Before editing, invoke the `ui-ux-pro-max` skill with this prompt:
> "Design two secondary login buttons for a Next.js login page using Tailwind + shadcn Button. First button ('Continue as Guest'): outline variant, full-width, rounded-[10px], border-[1.5px] border-[#e5e7eb], height 40px, hover darkens border to #d1d5db. Second button ('Try as Guest'): ghost variant, full-width, text-[#9ca3af], no border, smaller visual weight. Give me exact className strings for both."

Apply the output's classNames below.

- [ ] **Step 2: Replace only the JSX return in `components/layout/guest-login-buttons.tsx`**

Keep all logic unchanged. Replace only the `return` block:

```tsx
  return (
    <div className="flex flex-col gap-2 w-full">
      {savedGuestId && (
        <Button
          variant="outline"
          onClick={handleRestoreGuest}
          disabled={isLoading}
          className="w-full h-[40px] rounded-[10px] border-[1.5px] border-[#e5e7eb] hover:border-[#d1d5db] transition-colors"
        >
          Continue as Guest
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={handleNewGuest}
        disabled={isLoading}
        className="w-full text-[#9ca3af] hover:text-[#6b7280]"
      >
        Try as Guest
      </Button>
    </div>
  );
```

- [ ] **Step 3: Run guest-login-buttons tests to confirm still passing**

```bash
npm test -- --testPathPatterns="guest-login-buttons"
```

Expected output: `Tests: 6 passed, 6 total`

- [ ] **Step 4: Commit**

```bash
git add components/layout/guest-login-buttons.tsx
git commit -m "style: upgrade guest login buttons with unified border and ghost style"
```

---

### Task 4: Redesign `app/login/page.tsx`

**Files:**
- Modify: `app/login/page.tsx`

- [ ] **Step 1: Invoke `/ui-ux-pro-max` skill for the page layout**

Before editing, invoke the `ui-ux-pro-max` skill with this prompt:
> "Design a login page layout for a Next.js app (Server Component, no 'use client'). Full-screen gradient background: from-[#eef2ff] via-[#ede9fe] to-[#faf5ff] at 150deg. Centered white card: max-w-[340px], rounded-[20px], p-8, shadow-[0_8px_40px_rgba(79,70,229,0.14),0_2px_8px_rgba(0,0,0,0.04)]. Inside the card: logo 'BuilderAI' (font-black text-[22px] tracking-[-0.5px]), subtitle text-[12px] text-[#6b7280], then three Agent cards in a row (bg-[#f5f3ff] border border-[#ede9fe] rounded-[12px]), then login buttons. Give me the complete JSX structure with exact Tailwind classes."

Use the output to validate and refine the JSX below.

- [ ] **Step 2: Replace `app/login/page.tsx` with the redesigned version**

```tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { LoginButton } from "@/components/layout/login-button";
import { GuestLoginButtons } from "@/components/layout/guest-login-buttons";

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
          {[
            { icon: "📋", role: "PM", label: "需求分析" },
            { icon: "🏗️", role: "Architect", label: "方案设计" },
            { icon: "👨‍💻", role: "Engineer", label: "代码生成" },
          ].map((agent) => (
            <div
              key={agent.role}
              className="flex-1 bg-[#f5f3ff] border border-[#ede9fe] rounded-[12px] py-3 px-2 text-center"
            >
              <div className="text-xl mb-1">{agent.icon}</div>
              <div className="text-[9px] font-bold text-indigo-600">{agent.role}</div>
              <div className="text-[8px] text-[#9ca3af] mt-0.5">{agent.label}</div>
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

        {/* Guest login */}
        <GuestLoginButtons />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and visually verify the login page**

```bash
npm run dev
```

Open `http://localhost:3000/login` (log out first if already logged in, or open incognito).

Check:
- Background is light purple gradient (not gray)
- White card is centered with visible shadow
- Three Agent cards show emoji + role name + label
- GitHub button fills card width
- Guest buttons below divider

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/login/page.tsx
git commit -m "style: redesign login page with gradient background and agent cards"
```

---

### Task 5: Final verification and push

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass (styling changes don't break any logic tests).

- [ ] **Step 2: Push to remote**

```bash
git push origin main
```

Vercel will auto-deploy. Visit the production URL and verify the login page looks correct.
