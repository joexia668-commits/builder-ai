# Design: Dependency Injection for Generate Route (Plan C)

**Date:** 2026-04-10  
**Status:** Approved  
**Inspired by:** Claude Code Book — Chapter 2, QueryDeps pattern for testability

---

## Problem

`app/api/generate/route.ts` hardcodes `createProvider()` calls inside the `POST` handler. This makes the three critical behavioral branches untestable without brittle module-level mocking:

- Rate limit → Groq fallback
- Max tokens → conciseness retry
- Parse failure → `parse_failed` error code

The existing `__tests__/generate-route.test.ts` tests only static functions (`getSystemPrompt`, system prompt content) — zero coverage of the handler's flow logic.

---

## Goal

- Inject `createProvider` into the route handler via a factory function
- Enable testing all 9 behavioral scenarios without restructuring any business logic
- Zero changes to existing passing tests

---

## Approach

**Option chosen: Factory pattern — `createHandler(deps)` wraps the POST handler**

Rejected alternatives:
- Module-level mutable `_deps` variable: global state, test pollution risk
- Extract to `lib/generate-handler.ts`: largest change surface, requires threading `ReadableStreamDefaultController` across file boundary

---

## Design

### 1. `GenerateDeps` Interface

```typescript
// app/api/generate/route.ts — new additions

import type { AIProvider } from "@/lib/ai-providers";

interface GenerateDeps {
  readonly createProvider: (modelId: string) => AIProvider;
}

const defaultDeps: GenerateDeps = { createProvider };
```

Only `createProvider` is injected. `isRateLimitError` is a pure function with no side effects — not injected. `getToken` remains a module-level mock in tests (already handled by `jest.mock("next-auth/jwt")`).

### 2. Factory Wrapper

```typescript
export function createHandler(deps: GenerateDeps) {
  return async function POST(req: NextRequest): Promise<Response> {
    // All existing POST logic — unchanged except:
    // createProvider(...) → deps.createProvider(...)
    // Two call sites:
    //   Line ~51: const provider = deps.createProvider(resolvedModelId);
    //   Line ~106: const groqProvider = deps.createProvider("llama-3.3-70b");
  };
}

// Production export — Next.js routing system sees this
export const POST = createHandler(defaultDeps);
```

Internal change surface: **2 lines** — both `createProvider(...)` calls become `deps.createProvider(...)`.

### 3. Test File: `__tests__/generate-route-handler.test.ts`

#### Mock Helpers

```typescript
// Mock provider factory — controls streamCompletion behavior
function makeMockProvider(behavior: "success" | "rate_limit" | "max_tokens" | "error") {
  return {
    streamCompletion: jest.fn(async (_msgs: unknown, onChunk: (t: string) => void) => {
      if (behavior === "success")    { onChunk("some code"); return; }
      if (behavior === "rate_limit") { throw new Error("429 rate limit exceeded"); }
      if (behavior === "max_tokens") { throw new Error("max_tokens_exceeded"); }
      if (behavior === "error")      { throw new Error("provider error"); }
    }),
  };
}

// Parse SSE response body into event array
async function collectSSE(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

// Build a mock NextRequest
function makeReq(body: object): NextRequest {
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
```

#### 9 Test Scenarios

| # | Test | Verified via |
|---|------|-------------|
| 1 | PM agent normal generation | SSE has `done`; `chunk` events carry content |
| 2 | Architect agent normal generation | Same |
| 3 | Engineer single-file generation | SSE has `code_complete` with non-empty code |
| 4 | Engineer multi-file generation | SSE has `files_complete` with expected paths |
| 5 | Rate limit → Groq fallback | `createProvider` called twice; 2nd call with `"llama-3.3-70b"`; SSE has `reset` then `done` |
| 6 | Max tokens → conciseness retry | Engineer agent; `streamCompletion` called twice; SSE has `reset` then `code_complete` |
| 7 | Parse failure → `parse_failed` | `streamCompletion` returns garbage; SSE has `{ type: "error", errorCode: "parse_failed" }` |
| 8 | No auth token → 401 | `getToken` returns null; response status 401 |
| 9 | Invalid modelId → 400 | Request body has unknown `modelId`; response status 400 |

#### Mock Setup

```typescript
jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn().mockResolvedValue({ sub: "user-1" }),
}));

// isRateLimitError uses actual implementation — mock provider throws real "429" error
// so the actual isRateLimitError check works correctly end-to-end
jest.mock("@/lib/ai-providers", () => ({
  ...jest.requireActual("@/lib/ai-providers"),
  createProvider: jest.fn(), // overridden per-test via deps injection
}));
```

For rate limit test: mock provider 1 throws `new Error("429 rate limit exceeded")`, mock provider 2 succeeds. `createProvider` mock returns provider 1 on first call, provider 2 on second.

For max tokens test: `streamCompletion` on first call throws `new Error("max_tokens_exceeded")`, on second call succeeds.

---

## File Change Summary

| File | Change | Size |
|------|--------|------|
| `app/api/generate/route.ts` | Add `GenerateDeps` + `createHandler` + export wiring + 2x `deps.createProvider` | +15 lines |
| `__tests__/generate-route-handler.test.ts` | New file — 9 tests + 3 helpers | ~150 lines |

**Not changed:** `generate-route.test.ts`, `lib/ai-providers.ts`, any other file.

---

## Out of Scope

- Injecting `getToken` (low test value, already covered by `jest.mock`)
- Injecting `inferErrorCode` or `isRateLimitError` (pure functions, no injection value)
- Refactoring to `lib/generate-handler.ts` (larger scope, separate concern)
- Testing the SSE streaming infrastructure itself (Next.js Edge runtime concern)
