# Design: Fine-Grained Error Types (Plan B)

**Date:** 2026-04-10  
**Status:** Approved  
**Inspired by:** Claude Code Book — Chapter 2 (Dialogue Loop), Terminal state taxonomy

---

## Problem

The current error handling has two modes:
1. User aborted → silent reset
2. Everything else → `setGenerationError("生成失败：${raw message}")`

There is no distinction between rate limits, context overflow, provider outages, timeouts, or parse failures. Users see the same generic message regardless of cause and don't know what action (if any) to take.

---

## Goal

- Emit a typed `errorCode` alongside every SSE error event
- Map each code to a user-facing icon, title, description, and (where applicable) an action button
- Add one action button only for `context_overflow`, where the required user action is unambiguous

---

## Approach

**Option chosen: Extend SSEEvent with optional `errorCode` field (fully backward-compatible)**

Rejected alternatives:
- New `error_typed` event type: adds client-side dual-path complexity
- HTTP-layer error distinction: incompatible with Edge streaming (can't change status after stream starts)

---

## Design

### 1. Error Code Taxonomy

Six codes covering all current failure paths:

| Code | Trigger |
|------|---------|
| `rate_limited` | 429 from provider |
| `context_overflow` | prompt exceeds model context limit |
| `provider_unavailable` | missing API key, network error, 5xx |
| `generation_timeout` | request timed out |
| `parse_failed` | JSON/code extraction failed after retries |
| `unknown` | fallback for unrecognized errors |

### 2. Type Changes (`lib/types.ts`)

```typescript
export type ErrorCode =
  | "rate_limited"
  | "context_overflow"
  | "provider_unavailable"
  | "generation_timeout"
  | "parse_failed"
  | "unknown";

// SSEEvent — add optional field
export interface SSEEvent {
  // ... existing fields ...
  errorCode?: ErrorCode; // present only when type === "error"
}
```

### 3. New File: `lib/error-codes.ts`

Mapping table from `ErrorCode` to display config:

```typescript
interface ErrorDisplay {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly action?: { label: string; type: "new_project" };
}

export const ERROR_DISPLAY: Record<ErrorCode, ErrorDisplay> = {
  rate_limited:         { icon: "⏳", title: "请求太频繁",        description: "AI 服务达到频率限制，请等待约 30 秒后再试" },
  context_overflow:     { icon: "📦", title: "对话内容过长",      description: "当前对话上下文已超出模型限制，建议新建项目重新开始", action: { label: "新建项目", type: "new_project" } },
  provider_unavailable: { icon: "🔌", title: "AI 服务暂时不可用", description: "无法连接到 AI 提供商，请检查网络或稍后重试" },
  generation_timeout:   { icon: "⌛", title: "生成超时",          description: "本次生成耗时过长，请重新发送请求" },
  parse_failed:         { icon: "⚠️", title: "结果解析失败",      description: "AI 输出格式异常，已自动重试仍失败，请重新描述需求" },
  unknown:              { icon: "❌", title: "生成失败",           description: "发生未知错误，请重试" },
};
```

### 4. Server Side: `app/api/generate/route.ts`

Add `inferErrorCode` function and call it in the catch block:

```typescript
function inferErrorCode(err: unknown): ErrorCode {
  // Check for explicitly tagged errors first (e.g., from extract-json)
  if (err && typeof err === "object" && "errorCode" in err) {
    return (err as { errorCode: ErrorCode }).errorCode;
  }
  if (!(err instanceof Error)) return "unknown";
  const msg = err.message.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit"))          return "rate_limited";
  if (msg.includes("context length") || msg.includes("too long")) return "context_overflow";
  if (msg.includes("timeout") || msg.includes("timed out"))       return "generation_timeout";
  if (msg.includes("api key") || msg.includes("unauthorized") || /5\d\d/.test(msg)) return "provider_unavailable";
  return "unknown";
}

// In catch block:
const errorCode = inferErrorCode(err);
controller.enqueue(encoder.encode(
  `data: ${JSON.stringify({ type: "error", error: message, errorCode })}\n\n`
));
```

### 5. Parse Failure Tagging: `lib/extract-json.ts`

At final fallback throw sites, attach `errorCode` property:

```typescript
throw Object.assign(
  new Error("[parse_failed] Failed to extract output"),
  { errorCode: "parse_failed" as const }
);
```

### 6. Client Side: `components/workspace/chat-area.tsx`

**State type change:**
```typescript
// Before
const [generationError, setGenerationError] = useState<string | null>(null);

// After
const [generationError, setGenerationError] = useState<{
  code: ErrorCode;
  raw: string;
} | null>(null);
```

**Catch block:**
```typescript
const errorCode = (err && typeof err === "object" && "errorCode" in err)
  ? (err as { errorCode: ErrorCode }).errorCode
  : "unknown";
setGenerationError({ code: errorCode, raw: message });
```

**Error UI (replaces current error text):**
```tsx
{generationError && (() => {
  const display = ERROR_DISPLAY[generationError.code];
  return (
    <div className="mx-4 mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm">
      <div className="flex items-center gap-2 font-medium text-red-700">
        <span>{display.icon}</span>
        <span>{display.title}</span>
      </div>
      <p className="mt-1 text-red-600">{display.description}</p>
      {display.action?.type === "new_project" && (
        <button onClick={onNewProject} className="mt-2 text-xs underline text-red-700">
          {display.action.label}
        </button>
      )}
    </div>
  );
})()}
```

**New prop on ChatArea:**
```typescript
interface ChatAreaProps {
  // ... existing ...
  onNewProject?: () => void;
}
```

`onNewProject` triggers the existing `CreateProjectDialog` from the parent (`workspace.tsx`).

---

## File Change Summary

| File | Change | Size |
|------|--------|------|
| `lib/types.ts` | Add `ErrorCode` type + `SSEEvent.errorCode` | +8 lines |
| `lib/error-codes.ts` | New file — display mapping table | ~40 lines |
| `app/api/generate/route.ts` | Add `inferErrorCode` + update catch block | +20 lines |
| `lib/extract-json.ts` | Tag parse failures with `errorCode` | +3 lines per throw site |
| `components/workspace/chat-area.tsx` | Structured error state + UI + new prop | +30 lines |

**Not changed:** SSE protocol structure, `fetchSSE`, `api-client.ts`, other components.

---

## Out of Scope

- Automatic retry UI (retries already happen in `engineer-circuit.ts`)
- Rate limit countdown timer (backoff time unknown client-side)
- Error telemetry / logging to external service
