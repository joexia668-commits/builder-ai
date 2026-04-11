# Generated App Login Fix — Design Spec

**Date:** 2026-04-11
**Status:** Approved for implementation planning

## Problem

When builder-ai generates an app that includes a login page (e.g., a student management system), the generated code often calls `supabase.auth.signInWithPassword()`. This always fails in the Sandpack sandbox with "Email not confirmed" because:

1. The Supabase project used by the sandbox is for data storage only — no real user accounts exist.
2. Supabase Auth requires email confirmation, which cannot happen in a demo environment.
3. No matter how many times the user iterates, the AI keeps generating Supabase Auth calls, so the login page remains permanently broken.

## Root Cause

The engineer system prompt in `lib/generate-prompts.ts` does not restrict `supabase.auth.*` methods. The model treats Supabase Auth as a legitimate auth solution and generates it for any app that describes a login feature.

## Goals

1. Prevent the AI from generating `supabase.auth.*` calls in any generated app.
2. Ensure login pages in generated apps always work out of the box with visible demo credentials.
3. Provide a hard fallback so that even if the AI ignores the prompt rule, login calls succeed in the sandbox.

## Non-Goals

- Supporting real authentication in generated apps (out of scope for a demo sandbox).
- Restricting `supabase.*` data methods (those are intentionally allowed and functional).

## Design

Two coordinated changes:

### 1. Engineer Prompt — Auth Restriction

**File:** `lib/generate-prompts.ts`, engineer system prompt

Add an "认证限制" rule block immediately after the existing "严禁包限制" section:

```
【认证限制 - 违反将导致登录永远失败】
绝对禁止使用 supabase.auth 的任何方法，包括：
  signInWithPassword, signUp, signOut, getSession, onAuthStateChange 等

如需实现登录功能，必须使用本地状态模拟：
  const DEMO_CREDENTIALS = { email: "admin@demo.com", password: "demo123" }
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  // 表单提交时比对 DEMO_CREDENTIALS，匹配则 setIsLoggedIn(true)

必须在登录表单内显著展示 demo 凭据，例如：
  <p>演示账号：admin@demo.com &nbsp;密码：demo123</p>
```

This guides the model to implement login as a local `useState` comparison, with credentials displayed on screen. Applies to both the full pipeline engineer and the direct-path engineer (both share the same system prompt base).

### 2. Sandpack Injection — Auth Mock Fallback

**File:** `lib/sandpack-config.ts`

In the injected `supabaseClient.js` content, append an `auth` namespace to the Supabase client object. All methods return safe success responses:

```js
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
};
```

The mock is always injected. It does not interfere with `supabase` data methods (`from`, `select`, `insert`, etc.) because those are defined on the real client instance and not overwritten.

## Implementation Order

1. **Prompt fix** (`lib/generate-prompts.ts`) — smallest change, immediate effect on all future generations.
2. **Sandpack auth mock** (`lib/sandpack-config.ts`) — fallback for model non-compliance.

## Testing

- Generate a student management system and confirm the login page shows demo credentials and logs in successfully.
- Generate a to-do app (no login) and confirm the Sandpack injection does not break anything.
- Unit test: verify the injected `supabaseClient.js` string contains the `auth` mock block.
