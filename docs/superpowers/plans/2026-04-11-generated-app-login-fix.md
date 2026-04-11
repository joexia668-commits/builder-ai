# Generated App Login Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix generated apps whose login pages permanently fail with "Email not confirmed" by banning `supabase.auth.*` in the engineer prompt and injecting a mock auth fallback in the Sandpack client.

**Architecture:** Two independent changes — a prompt-level rule that guides the AI to use local `useState` for login, and a Sandpack injection that intercepts any `supabase.auth.*` calls that slip through and makes them succeed silently.

**Tech Stack:** TypeScript, Jest (tests), Next.js (no framework changes required)

---

## File Map

| File | Change |
|---|---|
| `lib/generate-prompts.ts` | Add auth restriction block to the `engineer` system prompt |
| `lib/sandpack-config.ts` | Extend `buildSupabaseClientCode()` to append auth mock to the injected client |
| `__tests__/generate-prompts.test.ts` | Add test asserting the auth restriction is present in the engineer prompt |
| `__tests__/sandpack-config.test.ts` | Add test asserting the injected `supabaseClient.js` contains the auth mock |

---

## Task 1: Engineer prompt — auth restriction

**Files:**
- Modify: `lib/generate-prompts.ts` (engineer prompt string, after the `classnames 等。` line)
- Test: `__tests__/generate-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Open `__tests__/generate-prompts.test.ts`. Add this test inside the existing `describe("getSystemPrompt")` block, after the last `it(...)` in that block:

```typescript
// GP-AUTH-01: engineer prompt bans supabase.auth methods
it("GP-AUTH-01: engineer 提示词禁止使用 supabase.auth 方法", () => {
  const prompt = getSystemPrompt("engineer", "proj-1");
  expect(prompt).toContain("supabase.auth");
  expect(prompt).toContain("signInWithPassword");
  expect(prompt).toContain("认证限制");
});

// GP-AUTH-02: engineer prompt provides the DEMO_CREDENTIALS pattern
it("GP-AUTH-02: engineer 提示词包含 DEMO_CREDENTIALS 本地状态登录示例", () => {
  const prompt = getSystemPrompt("engineer", "proj-1");
  expect(prompt).toContain("DEMO_CREDENTIALS");
  expect(prompt).toContain("isLoggedIn");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="generate-prompts" --testNamePattern="GP-AUTH"
```

Expected: FAIL — "expect(received).toContain(expected)" for `认证限制`

- [ ] **Step 3: Add auth restriction to the engineer prompt**

In `lib/generate-prompts.ts`, find this line in the `engineer` prompt string (around line 81):

```
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。
```

Immediately after that line (before `\n\nUI 样式只使用 Tailwind CSS class。`), insert:

```
\n\n【认证限制 - 违反将导致登录永远失败】
绝对禁止使用 supabase.auth 的任何方法，包括：
  signInWithPassword, signUp, signOut, getSession, onAuthStateChange 等

如需实现登录功能，必须使用本地状态模拟：
  const DEMO_CREDENTIALS = { email: "admin@demo.com", password: "demo123" }
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  // 表单提交时比对 DEMO_CREDENTIALS，匹配则 setIsLoggedIn(true)

必须在登录表单内显著展示 demo 凭据，例如：
  <p>演示账号：admin@demo.com &nbsp;密码：demo123</p>
```

The relevant section in `lib/generate-prompts.ts` currently reads (lines 77–84):

```typescript
绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
```

Replace with:

```typescript
绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

【认证限制 - 违反将导致登录永远失败】
绝对禁止使用 supabase.auth 的任何方法，包括：
  signInWithPassword, signUp, signOut, getSession, onAuthStateChange 等

如需实现登录功能，必须使用本地状态模拟：
  const DEMO_CREDENTIALS = { email: "admin@demo.com", password: "demo123" }
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  // 表单提交时比对 DEMO_CREDENTIALS，匹配则 setIsLoggedIn(true)

必须在登录表单内显著展示 demo 凭据，例如：
  <p>演示账号：admin@demo.com &nbsp;密码：demo123</p>

UI 样式只使用 Tailwind CSS class。
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="generate-prompts" --testNamePattern="GP-AUTH"
```

Expected: PASS (2 tests)

- [ ] **Step 5: Run the full generate-prompts test suite to check for regressions**

```bash
npm test -- --testPathPatterns="generate-prompts"
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
git commit -m "feat: ban supabase.auth in engineer prompt, require DEMO_CREDENTIALS login pattern"
```

---

## Task 2: Sandpack — auth mock fallback injection

**Files:**
- Modify: `lib/sandpack-config.ts` (`buildSupabaseClientCode` function, lines 86–91)
- Test: `__tests__/sandpack-config.test.ts`

- [ ] **Step 1: Write the failing test**

Open `__tests__/sandpack-config.test.ts`. Add this test inside the existing `describe("buildSandpackConfig")` block, after the last `it(...)`:

```typescript
it("injects supabase.auth mock into supabaseClient.js", () => {
  const files = {
    "/App.js": `import { supabase } from '/supabaseClient.js'\nexport default function App() { return null; }`,
  };
  const config = buildSandpackConfig(files, "proj-1");
  const clientCode = config.files["/supabaseClient.js"].code;
  expect(clientCode).toContain("supabase.auth");
  expect(clientCode).toContain("signInWithPassword");
  expect(clientCode).toContain("signOut");
  expect(clientCode).toContain("getSession");
  expect(clientCode).toContain("onAuthStateChange");
});

it("supabase.auth mock does not overwrite supabase data methods", () => {
  const files = {
    "/App.js": `export default function App() { return null; }`,
  };
  const config = buildSandpackConfig(files, "proj-1");
  const clientCode = config.files["/supabaseClient.js"].code;
  // Real Supabase client is still created via createClient — data methods intact
  expect(clientCode).toContain("createClient");
  // Auth mock is added after client creation, not replacing it
  const createClientIdx = clientCode.indexOf("createClient");
  const authMockIdx = clientCode.indexOf("supabase.auth");
  expect(authMockIdx).toBeGreaterThan(createClientIdx);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="sandpack-config" --testNamePattern="supabase.auth mock"
```

Expected: FAIL — "expect(received).toContain(expected)" for `supabase.auth`

- [ ] **Step 3: Extend buildSupabaseClientCode to include the auth mock**

In `lib/sandpack-config.ts`, find `buildSupabaseClientCode` (lines 86–91):

```typescript
function buildSupabaseClientCode(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('${url}', '${key}');`;
}
```

Replace with:

```typescript
function buildSupabaseClientCode(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('${url}', '${key}');
// Auth mock — supabase.auth is non-functional in the Sandpack sandbox.
// All calls are intercepted and return harmless success responses so that
// any AI-generated auth code does not permanently block the app's login page.
supabase.auth = {
  signInWithPassword: async ({ email }) =>
    ({ data: { user: { email }, session: { access_token: "demo" } }, error: null }),
  signUp: async ({ email }) =>
    ({ data: { user: { email }, session: null }, error: null }),
  signOut: async () =>
    ({ error: null }),
  getSession: async () =>
    ({ data: { session: null }, error: null }),
  onAuthStateChange: () =>
    ({ data: { subscription: { unsubscribe: () => {} } } }),
};`;
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
npm test -- --testPathPatterns="sandpack-config" --testNamePattern="supabase.auth mock"
```

Expected: PASS (2 tests)

- [ ] **Step 5: Run the full sandpack-config test suite to check for regressions**

```bash
npm test -- --testPathPatterns="sandpack-config"
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add lib/sandpack-config.ts __tests__/sandpack-config.test.ts
git commit -m "feat: inject supabase.auth mock into Sandpack client — prevents login page stall"
```

---

## Task 3: Full test run and smoke test

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no regressions

- [ ] **Step 2: Manual smoke test — login works in generated app**

1. Start the dev server: `npm run dev`
2. Open `http://localhost:3000`
3. Create a new project and prompt: `做一个学生管理系统`
4. Wait for generation to complete
5. In the Sandpack preview, find the login page
6. Enter the demo credentials shown on screen
7. Click login — the app should navigate to the main dashboard

Expected: login succeeds, no "Email not confirmed" error

- [ ] **Step 3: Manual smoke test — non-login app unaffected**

1. Create a new project and prompt: `做一个待办事项列表`
2. Wait for generation
3. Confirm the to-do app works normally (no auth errors in console)

Expected: app functions normally, Sandpack console shows no auth-related errors
