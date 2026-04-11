# Email Login Unavailable Notice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable the email login form and show a "temporarily unavailable" notice to users until a verified domain is configured on Resend.

**Architecture:** Single-file change to `components/layout/email-login-form.tsx`. The form is rendered as always-disabled with an explanatory hint. No API changes, no env vars, no new files.

**Tech Stack:** React 18, TypeScript strict, Tailwind CSS, shadcn/ui (`Input`, `Button`)

---

## File Structure

| File | Change |
|------|--------|
| `components/layout/email-login-form.tsx` | Disable form, update placeholder, add hint text, remove loading logic |
| `__tests__/email-login-form.test.tsx` | Update tests to match new disabled state |

---

## Task 1: Update EmailLoginForm to show unavailable state

**Files:**
- Modify: `components/layout/email-login-form.tsx`
- Modify: `__tests__/email-login-form.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `__tests__/email-login-form.test.tsx` with:

```typescript
import { render, screen } from "@testing-library/react";
import { EmailLoginForm } from "@/components/layout/email-login-form";

jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
}));

describe("EmailLoginForm — unavailable state", () => {
  it("renders the input as disabled", () => {
    render(<EmailLoginForm />);
    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
  });

  it("shows unavailable placeholder text", () => {
    render(<EmailLoginForm />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("placeholder", "邮箱登录暂不可用");
  });

  it("renders the submit button as disabled", () => {
    render(<EmailLoginForm />);
    const button = screen.getByRole("button", { name: "发送登录链接" });
    expect(button).toBeDisabled();
  });

  it("shows the hint text", () => {
    render(<EmailLoginForm />);
    expect(screen.getByText("📧 域名验证后即可开放使用")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="email-login-form"
```

Expected: FAIL — current form is enabled, placeholder is different, no hint text.

- [ ] **Step 3: Replace `components/layout/email-login-form.tsx`**

```typescript
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EmailLoginForm() {
  return (
    <div className="flex flex-col gap-2 w-full">
      <label htmlFor="email-input" className="sr-only">
        邮箱
      </label>
      <Input
        id="email-input"
        type="email"
        placeholder="邮箱登录暂不可用"
        disabled
        className="h-[42px] rounded-[10px] border-[#e5e7eb] text-sm"
      />
      <Button
        type="button"
        variant="outline"
        disabled
        className="w-full h-[42px] rounded-[10px] border-[1.5px] border-indigo-200 text-indigo-600 hover:bg-indigo-50 duration-150"
      >
        发送登录链接
      </Button>
      <p className="text-[11px] text-[#9ca3af] text-center">
        📧 域名验证后即可开放使用
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="email-login-form"
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add components/layout/email-login-form.tsx __tests__/email-login-form.test.tsx
git commit -m "feat: disable email login form with unavailable notice"
```
