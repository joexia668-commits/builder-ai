# Dependency Injection for Generate Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the `POST` handler in `app/api/generate/route.ts` with a `createHandler(deps)` factory so tests can inject a mock `createProvider` and cover all 9 behavioral scenarios.

**Architecture:** Add a `GenerateDeps` interface with a single `createProvider` field, move the existing `POST` body into `createHandler`'s return value, replace the two hardcoded `createProvider(...)` call sites with `deps.createProvider(...)`, and export `POST = createHandler(defaultDeps)`. Tests call `createHandler(mockDeps)` directly — zero `jest.mock` for provider behavior.

**Tech Stack:** TypeScript, Next.js Edge Runtime, Jest (node env), `next/server` NextRequest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `app/api/generate/route.ts` | Add `GenerateDeps`, `createHandler`, update 2 call sites, re-export `POST` |
| Create | `__tests__/generate-route-handler.test.ts` | 9 behavioral tests + 3 helper functions |

---

## Task 1: Refactor `route.ts` to export `createHandler`

**Files:**
- Modify: `app/api/generate/route.ts`

This is a structural refactor only — no behavior changes. Existing tests must still pass after this task.

- [ ] **Step 1: Add `AIProvider` import and `GenerateDeps` interface**

At the top of `app/api/generate/route.ts`, the current imports are:
```typescript
import { getToken } from "next-auth/jwt";
import { type NextRequest } from "next/server";
import { extractReactCode } from "@/lib/extract-code";
import { getSystemPrompt } from "@/lib/generate-prompts";
import { createProvider, resolveModelId, isRateLimitError } from "@/lib/ai-providers";
import { isValidModelId } from "@/lib/model-registry";
import { inferErrorCode } from "@/lib/error-codes";
import type { AgentRole, CompletionOptions, ErrorCode } from "@/lib/types";
```

Add one import (after the existing imports):
```typescript
import type { AIProvider } from "@/lib/ai-providers";
```

Then add the interface and default deps (after all imports, before the `send` helper):
```typescript
interface GenerateDeps {
  readonly createProvider: (modelId: string) => AIProvider;
}

const defaultDeps: GenerateDeps = { createProvider };
```

- [ ] **Step 2: Wrap `POST` in `createHandler`**

Currently the file exports:
```typescript
export async function POST(req: NextRequest) { ... }
```

Replace with:
```typescript
export function createHandler(deps: GenerateDeps) {
  return async function POST(req: NextRequest): Promise<Response> {
    // --- paste the entire existing POST body here unchanged ---
  };
}

export const POST = createHandler(defaultDeps);
```

The complete new `route.ts` should look like this (full file):

```typescript
import { getToken } from "next-auth/jwt";
import { type NextRequest } from "next/server";
import { extractReactCode } from "@/lib/extract-code";
import { getSystemPrompt } from "@/lib/generate-prompts";
import { createProvider, resolveModelId, isRateLimitError } from "@/lib/ai-providers";
import { isValidModelId } from "@/lib/model-registry";
import { inferErrorCode } from "@/lib/error-codes";
import type { AgentRole, CompletionOptions, ErrorCode } from "@/lib/types";
import type { AIProvider } from "@/lib/ai-providers";

export const runtime = "edge";
export const maxDuration = 300;

interface GenerateDeps {
  readonly createProvider: (modelId: string) => AIProvider;
}

const defaultDeps: GenerateDeps = { createProvider };

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
  );
}

export function createHandler(deps: GenerateDeps) {
  return async function POST(req: NextRequest): Promise<Response> {
    const token = await getToken({ req });
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { agent, prompt, context, projectId, modelId, targetFiles } =
      body as {
        projectId: string;
        prompt: string;
        agent: AgentRole;
        context?: string;
        modelId?: string;
        targetFiles?: Array<{
          path: string;
          description: string;
          exports: string[];
          deps: string[];
          hints: string;
        }>;
      };

    if (modelId !== undefined && modelId !== null && !isValidModelId(modelId)) {
      return new Response(
        JSON.stringify({ error: `Unknown modelId: ${modelId}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const resolvedModelId = resolveModelId(modelId);
    const provider = deps.createProvider(resolvedModelId);

    const userContent =
      agent === "pm"
        ? context
          ? `用户需求：${prompt}\n\n${context}`
          : `用户需求：${prompt}`
        : agent === "architect"
          ? `PM 的产品需求文档：\n\n${context}\n\n请基于以上 PRD 设计多文件 React 项目的文件结构和技术方案。`
          : `请根据以下完整背景信息，生成完整可运行的 React 组件代码：\n\n${context}`;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          send(controller, { type: "thinking", content: `${agent} 正在分析...` });

          let fullContent = "";

          const messages: Parameters<typeof provider.streamCompletion>[0] = [
            { role: "system", content: getSystemPrompt(agent, projectId) },
            { role: "user", content: userContent },
          ];

          const onChunk = (text: string) => {
            fullContent += text;
            send(controller, { type: "chunk", content: text });
          };

          const completionOptions: CompletionOptions =
            agent === "pm" ? { jsonMode: true } : {};

          try {
            await provider.streamCompletion(messages, onChunk, completionOptions);
          } catch (err) {
            const isMaxTokens = err instanceof Error && err.message === "max_tokens_exceeded";
            if (isMaxTokens && agent === "engineer") {
              fullContent = "";
              send(controller, { type: "reset" });
              const retryMessages: Parameters<typeof provider.streamCompletion>[0] = [
                messages[0],
                {
                  role: "user",
                  content: `${messages[1].content}\n\n⚠️ 严格控制：代码必须在 280 行以内完成，不写任何注释，变量名可缩短。`,
                },
              ];
              await provider.streamCompletion(retryMessages, onChunk, completionOptions);
            } else if (isRateLimitError(err) && process.env.GROQ_API_KEY) {
              fullContent = "";
              send(controller, { type: "reset" });
              const groqProvider = deps.createProvider("llama-3.3-70b");
              await groqProvider.streamCompletion(messages, onChunk, completionOptions);
            } else {
              throw err;
            }
          }

          if (agent === "engineer") {
            if (targetFiles && targetFiles.length > 0) {
              const { extractMultiFileCode } = await import("@/lib/extract-code");
              const expectedPaths = targetFiles.map((f) => f.path);
              const filesResult = extractMultiFileCode(fullContent, expectedPaths);
              if (filesResult === null) {
                send(controller, { type: "error", error: "生成的代码不完整，请重试", errorCode: "parse_failed" satisfies ErrorCode });
              } else {
                send(controller, { type: "files_complete", files: filesResult });
              }
            } else {
              const finalCode = extractReactCode(fullContent);
              if (finalCode === null) {
                send(controller, { type: "error", error: "生成的代码不完整，请重试", errorCode: "parse_failed" satisfies ErrorCode });
              } else {
                send(controller, { type: "code_complete", code: finalCode });
              }
            }
          }

          send(controller, { type: "done" });
        } catch (err) {
          console.error(`[generate] agent=${agent} model=${resolvedModelId} error:`, err);
          const errorCode = inferErrorCode(err);
          send(controller, {
            type: "error",
            error: err instanceof Error ? err.message : "Generation failed",
            errorCode,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}

export const POST = createHandler(defaultDeps);
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npx tsc --noEmit 2>&1 | grep -v "__tests__" | head -20
```

Expected: no errors from `app/api/generate/route.ts`.

- [ ] **Step 4: Existing tests still pass**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npm test -- --testPathPatterns="generate-route" 2>&1 | tail -15
```

Expected: same results as before (15 passing, 1 pre-existing failure for `G-03`).

- [ ] **Step 5: Commit**

```bash
cd /Users/ruby/Projects/personal/builder-ai && git add app/api/generate/route.ts && git commit -m "refactor: wrap POST in createHandler factory for dependency injection"
```

---

## Task 2: Write auth and validation tests (tests 8–9)

**Files:**
- Create: `__tests__/generate-route-handler.test.ts`

- [ ] **Step 1: Create the test file with helpers and first two tests**

Create `__tests__/generate-route-handler.test.ts`:

```typescript
/**
 * Behavioral tests for the generate route handler.
 * Uses createHandler(deps) to inject mock providers — no jest.mock for provider behavior.
 * Tests cover all 9 scenarios from the DI design spec.
 */

import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn().mockResolvedValue({ sub: "user-1" }),
}));

jest.mock("@/lib/extract-code", () => ({
  extractReactCode: jest.fn(),
  extractMultiFileCode: jest.fn(),
}));

import { createHandler } from "@/app/api/generate/route";
import { extractReactCode, extractMultiFileCode } from "@/lib/extract-code";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: object): NextRequest {
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function collectSSE(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

function makeSuccessProvider(chunks: string[] = ["hello"]) {
  return {
    streamCompletion: jest.fn(async (_msgs: unknown, onChunk: (t: string) => void) => {
      for (const chunk of chunks) onChunk(chunk);
    }),
  };
}

// ── Auth & validation ────────────────────────────────────────────────────────

describe("Generate Route Handler — auth and validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
  });

  it("test 8: returns 401 when no auth token", async () => {
    (getToken as jest.Mock).mockResolvedValue(null);
    const mockCreateProvider = jest.fn();
    const handler = createHandler({ createProvider: mockCreateProvider });

    const res = await handler(makeReq({ agent: "pm", prompt: "test", projectId: "p1" }));

    expect(res.status).toBe(401);
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it("test 9: returns 400 for invalid modelId", async () => {
    const mockCreateProvider = jest.fn();
    const handler = createHandler({ createProvider: mockCreateProvider });

    const res = await handler(makeReq({
      agent: "pm",
      prompt: "test",
      projectId: "p1",
      modelId: "nonexistent-model-xyz",
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("nonexistent-model-xyz");
  });
});
```

- [ ] **Step 2: Run to confirm both tests pass**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npm test -- --testPathPatterns="generate-route-handler" 2>&1 | tail -15
```

Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/ruby/Projects/personal/builder-ai && git add __tests__/generate-route-handler.test.ts && git commit -m "test: add auth and validation tests for generate handler"
```

---

## Task 3: Add normal generation tests (tests 1–4)

**Files:**
- Modify: `__tests__/generate-route-handler.test.ts`

- [ ] **Step 1: Add PM, Architect, and Engineer generation tests**

Append a new `describe` block to `__tests__/generate-route-handler.test.ts`:

```typescript
// ── Normal generation ────────────────────────────────────────────────────────

describe("Generate Route Handler — normal generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
  });

  it("test 1: PM agent streams chunks and sends done", async () => {
    const provider = makeSuccessProvider(["feature1", " feature2"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });

    const res = await handler(makeReq({ agent: "pm", prompt: "build a todo app", projectId: "p1" }));
    const events = await collectSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("chunk");
    expect(types).toContain("done");
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.map((e) => e.content).join("")).toBe("feature1 feature2");
  });

  it("test 2: Architect agent streams chunks and sends done", async () => {
    const provider = makeSuccessProvider(["arch output"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });

    const res = await handler(makeReq({ agent: "architect", prompt: "design system", projectId: "p1", context: "pm output" }));
    const events = await collectSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("chunk");
    expect(types).toContain("done");
  });

  it("test 3: Engineer single-file sends code_complete", async () => {
    const provider = makeSuccessProvider(["function App() { return <div /> }"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });
    (extractReactCode as jest.Mock).mockReturnValue("function App() { return <div /> }");

    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx" }));
    const events = await collectSSE(res);

    const codeEvent = events.find((e) => e.type === "code_complete");
    expect(codeEvent).toBeDefined();
    expect(typeof codeEvent?.code).toBe("string");
    expect((codeEvent?.code as string).length).toBeGreaterThan(0);
  });

  it("test 4: Engineer multi-file sends files_complete", async () => {
    const provider = makeSuccessProvider(["// FILE: /App.js\nfunction App(){}"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });
    (extractMultiFileCode as jest.Mock).mockReturnValue({ "/App.js": "function App(){}" });

    const targetFiles = [{ path: "/App.js", description: "main", exports: ["App"], deps: [], hints: "" }];
    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx", targetFiles }));
    const events = await collectSSE(res);

    const filesEvent = events.find((e) => e.type === "files_complete");
    expect(filesEvent).toBeDefined();
    expect((filesEvent?.files as Record<string, string>)["/App.js"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to confirm 4 new tests pass**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npm test -- --testPathPatterns="generate-route-handler" 2>&1 | tail -15
```

Expected: 6 PASS total.

- [ ] **Step 3: Commit**

```bash
cd /Users/ruby/Projects/personal/builder-ai && git add __tests__/generate-route-handler.test.ts && git commit -m "test: add normal generation tests for PM, Architect, Engineer"
```

---

## Task 4: Add behavioral branch tests (tests 5–7)

**Files:**
- Modify: `__tests__/generate-route-handler.test.ts`

- [ ] **Step 1: Add rate limit, max tokens, and parse failure tests**

Append another `describe` block to `__tests__/generate-route-handler.test.ts`:

```typescript
// ── Behavioral branches ──────────────────────────────────────────────────────

describe("Generate Route Handler — behavioral branches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
  });

  it("test 5: rate limit triggers Groq fallback", async () => {
    // Primary provider throws 429; Groq provider succeeds
    const primaryProvider = {
      streamCompletion: jest.fn().mockRejectedValue(new Error("429 rate limit exceeded")),
    };
    const groqProvider = makeSuccessProvider(["groq response"]);
    const mockCreateProvider = jest.fn()
      .mockReturnValueOnce(primaryProvider)  // first call: primary model
      .mockReturnValueOnce(groqProvider);    // second call: llama-3.3-70b fallback

    const originalKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-groq-key";

    try {
      const handler = createHandler({ createProvider: mockCreateProvider });
      const res = await handler(makeReq({ agent: "pm", prompt: "build", projectId: "p1" }));
      const events = await collectSSE(res);

      // createProvider called twice: once for primary, once for Groq
      expect(mockCreateProvider).toHaveBeenCalledTimes(2);
      expect(mockCreateProvider.mock.calls[1][0]).toBe("llama-3.3-70b");

      // SSE has reset (discard partial) then done
      const types = events.map((e) => e.type);
      expect(types).toContain("reset");
      expect(types).toContain("done");
    } finally {
      if (originalKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalKey;
    }
  });

  it("test 6: max_tokens triggers conciseness retry for engineer", async () => {
    (extractReactCode as jest.Mock).mockReturnValue("function App(){}");

    const provider = {
      streamCompletion: jest.fn()
        .mockRejectedValueOnce(new Error("max_tokens_exceeded"))         // first attempt fails
        .mockImplementationOnce(async (_: unknown, onChunk: (t: string) => void) => {
          onChunk("function App(){}");                                    // retry succeeds
        }),
    };
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });

    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx" }));
    const events = await collectSSE(res);

    // streamCompletion called twice: original + retry
    expect(provider.streamCompletion).toHaveBeenCalledTimes(2);
    // Retry request contains the conciseness instruction
    const retryCall = provider.streamCompletion.mock.calls[1];
    expect(JSON.stringify(retryCall[0])).toContain("280 行以内");

    // SSE has reset then code_complete
    const types = events.map((e) => e.type);
    expect(types).toContain("reset");
    expect(types).toContain("code_complete");
  });

  it("test 7: parse failure emits parse_failed error code", async () => {
    // streamCompletion succeeds but extractReactCode returns null (garbage output)
    const provider = makeSuccessProvider(["GARBAGE_OUTPUT_NOT_CODE"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });
    (extractReactCode as jest.Mock).mockReturnValue(null);

    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx" }));
    const events = await collectSSE(res);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.errorCode).toBe("parse_failed");
  });
});
```

- [ ] **Step 2: Run to confirm all 9 tests pass**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npm test -- --testPathPatterns="generate-route-handler" 2>&1 | tail -20
```

Expected: 9 PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/ruby/Projects/personal/builder-ai && git add __tests__/generate-route-handler.test.ts && git commit -m "test: add rate limit, max tokens, and parse failure behavioral tests"
```

---

## Task 5: Final verification

**Files:** none

- [ ] **Step 1: Full test suite**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npm test 2>&1 | tail -20
```

Expected: same pre-existing failures, 9 new tests passing, no regressions.

- [ ] **Step 2: Build**

```bash
cd /Users/ruby/Projects/personal/builder-ai && npm run build 2>&1 | tail -15
```

Expected: build succeeds.

- [ ] **Step 3: Confirm git log**

```bash
cd /Users/ruby/Projects/personal/builder-ai && git log --oneline -5
```

Expected commits:
- `refactor: wrap POST in createHandler factory for dependency injection`
- `test: add auth and validation tests for generate handler`
- `test: add normal generation tests for PM, Architect, Engineer`
- `test: add rate limit, max tokens, and parse failure behavioral tests`
