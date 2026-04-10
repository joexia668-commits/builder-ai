# Fine-Grained Error Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single generic `"生成失败"` error with six typed error codes, each with a distinct user-facing icon, title, description, and (for `context_overflow`) a "新建项目" action button.

**Architecture:** Add `ErrorCode` union type to `lib/types.ts`, extract display config and `inferErrorCode` into `lib/error-codes.ts`, emit `errorCode` from the SSE route, propagate it through SSE readers in `chat-area.tsx`, and render per-code UI. No changes to SSE protocol shape or other components.

**Tech Stack:** TypeScript, Next.js Edge Runtime, React, Tailwind CSS, Jest + React Testing Library

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `lib/types.ts` | Add `ErrorCode` union + `SSEEvent.errorCode?` |
| Create | `lib/error-codes.ts` | `inferErrorCode()` + `ERROR_DISPLAY` mapping table |
| Modify | `app/api/generate/route.ts` | Call `inferErrorCode` in catch; add `errorCode` to inline parse-fail sends |
| Modify | `components/workspace/chat-area.tsx` | Propagate `errorCode` in SSE readers; structured error state; typed error UI |
| Modify | `components/workspace/workspace.tsx` | Pass `onNewProject` prop to `ChatArea` |
| Create | `__tests__/error-codes.test.ts` | Unit tests for `inferErrorCode` + `ERROR_DISPLAY` completeness |
| Modify | `__tests__/chat-area-error-retry.test.tsx` | Add tests for typed error display and `context_overflow` button |

---

## Task 1: Add `ErrorCode` type and extend `SSEEvent`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `ErrorCode` union type and extend `SSEEvent`**

Open `lib/types.ts`. After the `SSEEventType` type (line ~90), add:

```typescript
export type ErrorCode =
  | "rate_limited"
  | "context_overflow"
  | "provider_unavailable"
  | "generation_timeout"
  | "parse_failed"
  | "unknown";
```

Then in the `SSEEvent` interface, add one optional field:

```typescript
export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  messageId?: string;
  error?: string;
  errorCode?: ErrorCode;   // ← new: present only when type === "error"
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add ErrorCode union type and SSEEvent.errorCode field"
```

---

## Task 2: Create `lib/error-codes.ts` with display config and `inferErrorCode`

**Files:**
- Create: `lib/error-codes.ts`
- Create: `__tests__/error-codes.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `__tests__/error-codes.test.ts`:

```typescript
import { inferErrorCode, ERROR_DISPLAY } from "@/lib/error-codes";
import type { ErrorCode } from "@/lib/types";

describe("inferErrorCode", () => {
  it("returns rate_limited for 429 message", () => {
    expect(inferErrorCode(new Error("HTTP 429 Too Many Requests"))).toBe("rate_limited");
  });

  it("returns rate_limited for 'rate limit' message", () => {
    expect(inferErrorCode(new Error("rate limit exceeded"))).toBe("rate_limited");
  });

  it("returns context_overflow for 'context length' message", () => {
    expect(inferErrorCode(new Error("context length exceeded"))).toBe("context_overflow");
  });

  it("returns context_overflow for 'too long' message", () => {
    expect(inferErrorCode(new Error("prompt is too long"))).toBe("context_overflow");
  });

  it("returns generation_timeout for 'timeout' message", () => {
    expect(inferErrorCode(new Error("Request timed out"))).toBe("generation_timeout");
  });

  it("returns provider_unavailable for 'api key' message", () => {
    expect(inferErrorCode(new Error("Invalid api key"))).toBe("provider_unavailable");
  });

  it("returns provider_unavailable for '503' message", () => {
    expect(inferErrorCode(new Error("HTTP 503 Service Unavailable"))).toBe("provider_unavailable");
  });

  it("returns parse_failed when error has errorCode property", () => {
    const err = Object.assign(new Error("parse failed"), { errorCode: "parse_failed" as const });
    expect(inferErrorCode(err)).toBe("parse_failed");
  });

  it("returns unknown for unrecognized error", () => {
    expect(inferErrorCode(new Error("something completely different"))).toBe("unknown");
  });

  it("returns unknown for non-Error values", () => {
    expect(inferErrorCode("a string")).toBe("unknown");
    expect(inferErrorCode(null)).toBe("unknown");
    expect(inferErrorCode(42)).toBe("unknown");
  });
});

describe("ERROR_DISPLAY", () => {
  const ALL_CODES: ErrorCode[] = [
    "rate_limited",
    "context_overflow",
    "provider_unavailable",
    "generation_timeout",
    "parse_failed",
    "unknown",
  ];

  it("has an entry for every ErrorCode", () => {
    for (const code of ALL_CODES) {
      expect(ERROR_DISPLAY[code]).toBeDefined();
    }
  });

  it("every entry has icon, title, description", () => {
    for (const code of ALL_CODES) {
      const entry = ERROR_DISPLAY[code];
      expect(typeof entry.icon).toBe("string");
      expect(entry.icon.length).toBeGreaterThan(0);
      expect(typeof entry.title).toBe("string");
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("only context_overflow has an action", () => {
    expect(ERROR_DISPLAY.context_overflow.action).toBeDefined();
    expect(ERROR_DISPLAY.context_overflow.action?.type).toBe("new_project");

    const otherCodes = ALL_CODES.filter((c) => c !== "context_overflow");
    for (const code of otherCodes) {
      expect(ERROR_DISPLAY[code].action).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="error-codes"
```

Expected: FAIL — `Cannot find module '@/lib/error-codes'`

- [ ] **Step 3: Create `lib/error-codes.ts`**

```typescript
import type { ErrorCode } from "@/lib/types";

interface ErrorDisplay {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly action?: { label: string; type: "new_project" };
}

export const ERROR_DISPLAY: Record<ErrorCode, ErrorDisplay> = {
  rate_limited: {
    icon: "⏳",
    title: "请求太频繁",
    description: "AI 服务达到频率限制，请等待约 30 秒后再试",
  },
  context_overflow: {
    icon: "📦",
    title: "对话内容过长",
    description: "当前对话上下文已超出模型限制，建议新建项目重新开始",
    action: { label: "新建项目", type: "new_project" },
  },
  provider_unavailable: {
    icon: "🔌",
    title: "AI 服务暂时不可用",
    description: "无法连接到 AI 提供商，请检查网络或稍后重试",
  },
  generation_timeout: {
    icon: "⌛",
    title: "生成超时",
    description: "本次生成耗时过长，请重新发送请求",
  },
  parse_failed: {
    icon: "⚠️",
    title: "结果解析失败",
    description: "AI 输出格式异常，已自动重试仍失败，请重新描述需求",
  },
  unknown: {
    icon: "❌",
    title: "生成失败",
    description: "发生未知错误，请重试",
  },
};

/**
 * Infers a typed ErrorCode from an unknown caught error.
 * Checks for an explicit `errorCode` property first (set by internal throwers),
 * then falls back to message-string matching.
 */
export function inferErrorCode(err: unknown): ErrorCode {
  if (err !== null && typeof err === "object" && "errorCode" in err) {
    return (err as { errorCode: ErrorCode }).errorCode;
  }
  if (!(err instanceof Error)) return "unknown";
  const msg = err.message.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return "rate_limited";
  if (msg.includes("context length") || msg.includes("too long")) return "context_overflow";
  if (msg.includes("timeout") || msg.includes("timed out")) return "generation_timeout";
  if (
    msg.includes("api key") ||
    msg.includes("unauthorized") ||
    /5\d\d/.test(msg)
  )
    return "provider_unavailable";
  return "unknown";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="error-codes"
```

Expected: all PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/error-codes.ts __tests__/error-codes.test.ts
git commit -m "feat: add error-codes lib with inferErrorCode and ERROR_DISPLAY"
```

---

## Task 3: Update `app/api/generate/route.ts` to emit `errorCode`

**Files:**
- Modify: `app/api/generate/route.ts`

There are three places to update:
1. Import `inferErrorCode` from `lib/error-codes`
2. The two inline `send(controller, { type: "error", ... })` calls for null extraction results (parse failures) — add `errorCode: "parse_failed"`
3. The outer `catch` block — call `inferErrorCode(err)` and include in the send

- [ ] **Step 1: Add import**

At the top of `app/api/generate/route.ts`, add after the existing imports:

```typescript
import { inferErrorCode } from "@/lib/error-codes";
import type { ErrorCode } from "@/lib/types";
```

- [ ] **Step 2: Tag inline parse-fail sends**

Find the two null-extraction error sends (around lines 117–127). Change both from:

```typescript
send(controller, { type: "error", error: "生成的代码不完整，请重试" });
```

to:

```typescript
send(controller, { type: "error", error: "生成的代码不完整，请重试", errorCode: "parse_failed" satisfies ErrorCode });
```

There are two of these — one inside `if (filesResult === null)` and one inside `if (finalCode === null)`. Update both.

- [ ] **Step 3: Update the outer catch block**

Find the outer `catch (err)` block (around line 133). Change:

```typescript
} catch (err) {
  console.error(`[generate] agent=${agent} model=${resolvedModelId} error:`, err);
  send(controller, {
    type: "error",
    error: err instanceof Error ? err.message : "Generation failed",
  });
}
```

to:

```typescript
} catch (err) {
  console.error(`[generate] agent=${agent} model=${resolvedModelId} error:`, err);
  const errorCode = inferErrorCode(err);
  send(controller, {
    type: "error",
    error: err instanceof Error ? err.message : "Generation failed",
    errorCode,
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run existing generate route tests**

```bash
npm test -- --testPathPatterns="generate-route"
```

Expected: all PASS (no behavior change, only new field added).

- [ ] **Step 6: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat: emit errorCode in generate route SSE error events"
```

---

## Task 4: Propagate `errorCode` through SSE readers in `chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

There are two SSE reading paths in `chat-area.tsx` that throw on `type === "error"` events:

**Path A** — `readEngineerSSE` function (around line 164):
```typescript
} else if (event.type === "error") {
  throw new Error(event.error ?? "Stream error");
}
```

**Path B** — `processSSELines` inside the PM/Architect loop (around line 566):
```typescript
} else if (event.type === "error") {
  throw new Error(event.error ?? "Stream error");
}
```

Both need to attach the `errorCode` to the thrown error so the outer `catch` can read it.

- [ ] **Step 1: Update `readEngineerSSE` — add `errorCode` to parsed event type**

In `readEngineerSSE`, the parsed event type (around line 153) currently is:
```typescript
const event = JSON.parse(data) as {
  type: string;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  error?: string;
};
```

Change to:
```typescript
const event = JSON.parse(data) as {
  type: string;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  error?: string;
  errorCode?: import("@/lib/types").ErrorCode;
};
```

Then change the throw (line ~165) from:
```typescript
} else if (event.type === "error") {
  throw new Error(event.error ?? "Stream error");
}
```

to:
```typescript
} else if (event.type === "error") {
  throw Object.assign(
    new Error(event.error ?? "Stream error"),
    { errorCode: event.errorCode ?? "unknown" }
  );
}
```

- [ ] **Step 2: Update `processSSELines` — same change**

In `processSSELines` (inside the PM/Architect loop, around line 557), the parsed event type is:
```typescript
const event = JSON.parse(data) as { type: string; content?: string; code?: string; error?: string };
```

Change to:
```typescript
const event = JSON.parse(data) as {
  type: string;
  content?: string;
  code?: string;
  error?: string;
  errorCode?: import("@/lib/types").ErrorCode;
};
```

Then change the throw from:
```typescript
} else if (event.type === "error") {
  throw new Error(event.error ?? "Stream error");
}
```

to:
```typescript
} else if (event.type === "error") {
  throw Object.assign(
    new Error(event.error ?? "Stream error"),
    { errorCode: event.errorCode ?? "unknown" }
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing chat-area tests**

```bash
npm test -- --testPathPatterns="chat-area"
```

Expected: all PASS (no behavior change yet — just enriched thrown errors).

- [ ] **Step 5: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: propagate errorCode from SSE error events through chat-area readers"
```

---

## Task 5: Update ChatArea state, UI, and props for typed errors

**Files:**
- Modify: `components/workspace/chat-area.tsx`
- Modify: `__tests__/chat-area-error-retry.test.tsx`

This task changes three things:
1. `generationError` state from `string | null` to `{ code: ErrorCode; raw: string } | null`
2. The `catch` block sets structured error
3. The error UI renders per-code icon/title/description + `context_overflow` button
4. New optional prop `onNewProject?: () => void`

- [ ] **Step 1: Write new failing tests**

Open `__tests__/chat-area-error-retry.test.tsx`. Add these tests after the existing ones (before the closing `}`):

```typescript
import { inferErrorCode } from "@/lib/error-codes"; // add to imports at top

// Add these two tests inside the existing describe block:

it("shows typed icon and title for rate_limited error", async () => {
  const rateLimitErr = Object.assign(
    new Error("HTTP 429 Too Many Requests"),
    { errorCode: "rate_limited" as const }
  );
  (global.fetch as jest.Mock).mockRejectedValue(rateLimitErr);

  render(
    <ChatArea
      project={project}
      messages={[]}
      onMessagesChange={jest.fn()}
      onFilesGenerated={jest.fn()}
    />
  );

  fireEvent.click(screen.getByTestId("submit-btn"));

  await waitFor(() => {
    expect(screen.getByText("请求太频繁")).toBeInTheDocument();
  });
});

it("shows new_project button for context_overflow error", async () => {
  const overflowErr = Object.assign(
    new Error("context length exceeded"),
    { errorCode: "context_overflow" as const }
  );
  (global.fetch as jest.Mock).mockRejectedValue(overflowErr);

  const onNewProject = jest.fn();

  render(
    <ChatArea
      project={project}
      messages={[]}
      onMessagesChange={jest.fn()}
      onFilesGenerated={jest.fn()}
      onNewProject={onNewProject}
    />
  );

  fireEvent.click(screen.getByTestId("submit-btn"));

  await waitFor(() => {
    expect(screen.getByText("新建项目")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText("新建项目"));
  expect(onNewProject).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
npm test -- --testPathPatterns="chat-area-error-retry"
```

Expected: the two new tests FAIL — `"请求太频繁"` and `"新建项目"` not in document.

- [ ] **Step 3: Add imports to `chat-area.tsx`**

At the top of `components/workspace/chat-area.tsx`, add:

```typescript
import { ERROR_DISPLAY } from "@/lib/error-codes";
import type { ErrorCode } from "@/lib/types";
```

- [ ] **Step 4: Add `onNewProject` to `ChatAreaProps` interface**

In the `ChatAreaProps` interface (around line 33), add:

```typescript
onNewProject?: () => void;
```

- [ ] **Step 5: Destructure `onNewProject` in the component function**

In the `export function ChatArea({...})` destructuring (around line 55), add `onNewProject` to the list:

```typescript
export function ChatArea({
  project,
  messages,
  onMessagesChange,
  onFilesGenerated,
  onGeneratingChange,
  isPreviewingHistory = false,
  initialModel,
  currentFiles = {},
  lastPmOutput,
  onPmOutputGenerated,
  onNewProject,          // ← add this
}: ChatAreaProps) {
```

- [ ] **Step 6: Change `generationError` state type**

Find (around line 72):
```typescript
const [generationError, setGenerationError] = useState<string | null>(null);
```

Change to:
```typescript
const [generationError, setGenerationError] = useState<{
  code: ErrorCode;
  raw: string;
} | null>(null);
```

- [ ] **Step 7: Update the catch block to set structured error**

In the outer `catch (err)` block of `handleGenerate` (around line 636), find:
```typescript
const message = err instanceof Error ? err.message : "未知错误";
setGenerationError(`生成失败：${message}`);
```

Change to:
```typescript
const message = err instanceof Error ? err.message : "未知错误";
const errorCode: ErrorCode =
  err !== null && typeof err === "object" && "errorCode" in err
    ? (err as { errorCode: ErrorCode }).errorCode
    : "unknown";
setGenerationError({ code: errorCode, raw: message });
```

- [ ] **Step 8: Replace the error UI block**

Find the current error UI (around line 706):
```tsx
{generationError && (
  <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg mx-2">
    <span className="text-red-500 text-lg shrink-0">⚠️</span>
    <div className="flex-1 min-w-0">
      <p className="text-sm text-red-700 font-medium">出错了</p>
      <p className="text-xs text-red-500 mt-0.5 truncate">{generationError}</p>
    </div>
    <button
      data-testid="retry-btn"
      onClick={() => handleSubmit(lastPrompt)}
      className="shrink-0 text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
    >
      重试
    </button>
  </div>
)}
```

Replace with:
```tsx
{generationError && (() => {
  const display = ERROR_DISPLAY[generationError.code];
  return (
    <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg mx-2">
      <span className="text-red-500 text-lg shrink-0">{display.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-700 font-medium">{display.title}</p>
        <p className="text-xs text-red-500 mt-0.5">{display.description}</p>
        {display.action?.type === "new_project" && (
          <button
            onClick={onNewProject}
            className="mt-1.5 text-xs underline text-red-700 hover:text-red-900"
          >
            {display.action.label}
          </button>
        )}
      </div>
      <button
        data-testid="retry-btn"
        onClick={() => handleSubmit(lastPrompt)}
        className="shrink-0 text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
      >
        重试
      </button>
    </div>
  );
})()}
```

- [ ] **Step 9: Run all chat-area tests**

```bash
npm test -- --testPathPatterns="chat-area"
```

Expected: all PASS, including the two new tests.

- [ ] **Step 10: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add components/workspace/chat-area.tsx __tests__/chat-area-error-retry.test.tsx
git commit -m "feat: typed error state and per-code error UI in ChatArea"
```

---

## Task 6: Wire `onNewProject` in `workspace.tsx`

**Files:**
- Modify: `components/workspace/workspace.tsx`

`workspace.tsx` renders `ChatArea`. We need to pass an `onNewProject` callback that opens `CreateProjectDialog`. Check how the home page opens that dialog — in `workspace.tsx` there is no create dialog yet, so we'll route to the home page instead (simplest wiring: `router.push("/")`).

- [ ] **Step 1: Add `useRouter` import**

At the top of `components/workspace/workspace.tsx`, add:
```typescript
import { useRouter } from "next/navigation";
```

- [ ] **Step 2: Instantiate router**

Inside the `Workspace` function body (after the existing `useState` calls), add:
```typescript
const router = useRouter();
```

- [ ] **Step 3: Pass `onNewProject` to `ChatArea`**

In the `<ChatArea ...>` JSX (around line 107), add:
```tsx
onNewProject={() => router.push("/")}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/workspace.tsx
git commit -m "feat: wire onNewProject in Workspace to navigate to home"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all tests with coverage**

```bash
npm run test:coverage
```

Expected: all tests PASS.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Start dev server:
```bash
npm run dev
```

Open a project. Simulate an error by temporarily setting an invalid API key in `.env.local`. Submit a prompt and verify:
- Error card shows an icon + specific title (not just "出错了")
- Error description matches the error type

Restore `.env.local` after testing.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -p   # stage only intentional changes
git commit -m "chore: fine-grained error types cleanup"
```
