# Engineer Layer Resilience — Design Spec

**Date:** 2026-04-11
**Scope:** Engineer multi-file generation path only (PM / Architect / Sandpack untouched)
**Problem:** Layer-N generation silently retries the full layer on `parse_failed`, wasting ~9 minutes per failure and giving users no signal.

---

## Problem Statement

When `/api/generate` emits `parse_failed` for an engineer layer (server-side detection of unbalanced braces or missing `// === FILE: ===` blocks), the client's `runLayerWithFallback` catches it, retries the **entire layer** up to 3 times, then per-file fallback up to 3 more times. Three issues:

1. **All-or-nothing parse.** A single truncated file in a 6-file layer discards 5 good files. `extractMultiFileCode` returns `null` on any failure.
2. **Silent to the user.** No UI signal that a retry is in progress. Stalls look identical to normal generation.
3. **Blind retry.** Same prompt + same model → same truncation. No adaptive hint, no scope reduction.

**Observed impact:** Student-management-system project, layer-4, 89s of streamed tokens discarded, a fresh 89s retry starts immediately. Users see 3+ minute "stuck" states.

---

## Goals

- **Salvage partial progress** — keep successfully-parsed files when only a subset fails.
- **Visible retry** — UI shows retry count, reason, and which files are being retried.
- **Adaptive prompt** — retries only request failed files, with instructions to emit minimal output.
- **Eager preview** — render partial-success files to Sandpack immediately so users see progress.

## Non-Goals

- Changing PM / Architect prompt or flow.
- Changing Sandpack config shape.
- Retry across layers (if layer-4 succeeds partially but layer-5 depends on a failed file, we still surface it as a `missing_imports` error — existing behavior).
- Changing model selection or provider failover logic.

---

## Architecture Changes

### A. Partial Salvage

#### A.1 `lib/extract-code.ts` — new function

```ts
export interface PartialExtractResult {
  ok: Record<string, string>;
  failed: string[];
  truncatedTail: string | null; // last ~200 chars of raw input for debugging
}

export function extractMultiFileCodePartial(
  raw: string,
  expectedFiles: readonly string[]
): PartialExtractResult;
```

Rules:
- Parse `// === FILE: /path ===` markers as before.
- For each expected path: present + brace-balanced → `ok`; missing OR brace-unbalanced → `failed`.
- `truncatedTail` = last 200 chars of `raw` whenever `failed.length > 0`, else `null`.
- Existing `extractMultiFileCode` is preserved unchanged (still used by other paths if any).

#### A.2 `app/api/generate/handler.ts` — engineer multi-file branch

Replace the existing `extractMultiFileCode` call (around line 133-140) with:

```ts
const { extractMultiFileCodePartial } = await import("@/lib/extract-code");
const result = extractMultiFileCodePartial(fullContent, expectedPaths);
const okCount = Object.keys(result.ok).length;

if (okCount === 0) {
  send(controller, {
    type: "error",
    error: "生成的代码不完整，请重试",
    errorCode: "parse_failed",
    failedFiles: result.failed,
    truncatedTail: result.truncatedTail ?? undefined,
  });
} else if (result.failed.length > 0) {
  send(controller, {
    type: "partial_files_complete",
    files: result.ok,
    failed: result.failed,
    truncatedTail: result.truncatedTail ?? undefined,
  });
} else {
  send(controller, { type: "files_complete", files: result.ok });
}
```

#### A.3 `lib/types.ts` — SSE event additions

```ts
// New event variant
| { type: "partial_files_complete"; files: Record<string, string>; failed: string[]; truncatedTail?: string }
// Existing error event gains optional metadata
| { type: "error"; error: string; errorCode: ErrorCode; failedFiles?: string[]; truncatedTail?: string }
```

#### A.4 `lib/engineer-circuit.ts` — requestFn contract change

```ts
export interface RequestMeta {
  attempt: number;        // 1-indexed
  priorFailed: string[];  // files that failed in the previous attempt (empty on attempt 1)
}

export interface RequestResult {
  files: Record<string, string>;
  failed: string[]; // files returned as failed this attempt
}

export async function runLayerWithFallback(
  layerFiles: readonly ScaffoldFile[],
  requestFn: (files: readonly ScaffoldFile[], meta: RequestMeta) => Promise<RequestResult>,
  signal?: AbortSignal,
  onAttempt?: (info: AttemptInfo) => void
): Promise<LayerResult>;
```

New retry loop:

```
accumulated = {}
remaining = layerFiles
for attempt in 1..2:              // Q1: 2 full-layer attempts
  onAttempt({ attempt, maxAttempts: 2, reason, failedSubset: remaining.paths, phase: "layer" })
  result = requestFn(remaining, { attempt, priorFailed: prior })
  accumulated ∪= result.files
  remaining = layerFiles.filter(f => !accumulated[f.path])
  if remaining empty: return { files: accumulated, failed: [] }
  prior = result.failed

// Q1: 2 per-file attempts per file, circuit-breaker after 3 consecutive failures
for file in remaining:
  if consecutiveFailures >= 3: mark failed, continue
  for attempt in 1..2:
    onAttempt({ attempt, maxAttempts: 2, reason: "per_file_fallback", failedSubset: [file.path], phase: "per_file" })
    try requestFn([file], { attempt, priorFailed: [file.path] }) → success: accumulated ∪=, break
  else: mark failed, consecutiveFailures++
```

`AttemptInfo` shape:

```ts
export interface AttemptInfo {
  attempt: number;
  maxAttempts: number;
  reason: "initial" | "parse_failed" | "http_error" | "per_file_fallback";
  failedSubset: string[];
  phase: "layer" | "per_file";
}
```

`retryWithBackoff` is replaced by this new loop — it was doing exponential backoff between identical requests, which we now consider an anti-pattern for parse-failure retries.

### B. Visible Retry Signal

#### B.1 `lib/types.ts` — `EngineerProgress` addition

```ts
export interface EngineerProgress {
  // ... existing fields
  retryInfo: {
    layerIdx: number;             // 0-indexed, matches currentLayer - 1
    attempt: number;              // 1-indexed
    maxAttempts: number;
    reason: AttemptInfo["reason"];
    failedSubset: string[];       // file paths being retried this attempt
    phase: "layer" | "per_file";
  } | null;
}
```

#### B.2 `components/workspace/chat-area.tsx` — onAttempt wiring

Pass `onAttempt` to `runLayerWithFallback`. On each call:

```ts
updateSession(project.id, {
  engineerProgress: {
    ...prev,
    retryInfo: info.attempt === 1 && info.phase === "layer"
      ? null  // first attempt is not a retry
      : { layerIdx, attempt, maxAttempts, reason, failedSubset, phase },
  },
});
```

When the layer completes, clear `retryInfo`.

#### B.3 UI — engineer progress display

File: wherever `engineerProgress.currentLayer` / `currentFiles` is rendered (likely `agent-card.tsx` or an engineer progress subcomponent). Add:

```tsx
{retryInfo && (
  <div className="text-xs text-amber-600">
    Layer {retryInfo.layerIdx + 1} 重试 {retryInfo.attempt}/{retryInfo.maxAttempts}
    {retryInfo.reason === "parse_failed" && "（上次输出截断）"}
    {retryInfo.reason === "per_file_fallback" && "（逐文件回退）"}
    {retryInfo.failedSubset.length > 0 && `：${retryInfo.failedSubset.map(p => p.split("/").pop()).join(", ")}`}
  </div>
)}
```

### C. Adaptive Retry Prompt

#### C.1 `lib/generate-prompts.ts` — `getMultiFileEngineerPrompt` param

```ts
export interface MultiFileEngineerPromptInput {
  // ... existing fields
  retryHint?: {
    attempt: number;
    reason: string;
    priorTail?: string;
  };
}
```

When `retryHint` is provided, prepend to the prompt:

```
【重试提示 — 上一次尝试 #{attempt} 失败：{reason}】
严格要求：
1. 只输出下列 {targetFiles.length} 个文件，其它已生成完毕，不要重复输出
2. 省略所有注释、示例代码、解释性文本
3. 每个文件必须以完整的 // === FILE: /path === 块开始
4. 最后一个文件的大括号必须平衡
5. 不要输出 markdown 说明文字
{if priorTail}
上一次输出末尾 200 字符（供你判断截断位置）：
---
{priorTail}
---
{/if}
```

#### C.2 `components/workspace/chat-area.tsx` — requestFn closure

The inner `requestFn` now receives `meta: { attempt, priorFailed }`. Capture last-seen `truncatedTail` from the previous SSE stream (propagated via `readEngineerSSE` return value, see D.1) and pass to `getMultiFileEngineerPrompt`:

```ts
let lastTruncatedTail: string | undefined;
const layerResult = await runLayerWithFallback(
  layerFiles,
  async (files, meta) => {
    const engineerPrompt = getMultiFileEngineerPrompt({
      // ... existing fields
      retryHint: meta.attempt > 1
        ? { attempt: meta.attempt, reason: "parse_failed", priorTail: lastTruncatedTail }
        : undefined,
    });
    // ... fetch + SSE
    const sseResult = await readEngineerSSE(response.body, tag);
    lastTruncatedTail = sseResult.truncatedTail;
    return { files: sseResult.files, failed: sseResult.failedInResponse };
  },
  abortController.signal,
  (info) => { /* retryInfo update from B.2 */ }
);
```

### D. Supporting Changes

#### D.1 `readEngineerSSE` return shape

```ts
async function readEngineerSSE(
  body: ReadableStream<Uint8Array>,
  tag: string
): Promise<{
  files: Record<string, string>;
  failedInResponse: string[];
  truncatedTail?: string;
}>;
```

Handle three event types:
- `files_complete` → `{ files, failedInResponse: [] }`
- `partial_files_complete` → `{ files, failedInResponse: failed, truncatedTail }`
- `code_complete` → `{ files: { "/App.js": code }, failedInResponse: [] }` (legacy single-file fallback)
- `error` with `errorCode: "parse_failed"` → throw `Error` with `.failedFiles` and `.truncatedTail` attached; per-layer runner interprets this as "all files failed this attempt"

#### D.2 Eager partial render (Q2)

On `partial_files_complete` — even before `runLayerWithFallback` returns — surface good files to Sandpack:

In `chat-area.tsx`, the current code accumulates `allCompletedFiles` then calls `buildSandpackConfig` once after all layers finish. Change: after each layer (or each partial event), call `onFilesGenerated(allCompletedFiles)` with the current accumulator. The Sandpack preview already has stub injection for missing imports, so a transient half-rendered state is acceptable.

Trigger points for `onFilesGenerated`:
1. After each layer completes (success or partial).
2. Explicitly NOT during mid-layer streaming (would thrash Sandpack).

#### D.3 `lib/error-codes.ts`

`parse_failed` display text stays the same. Add note in the `ErrorDisplay` comment that `failedFiles` / `truncatedTail` metadata may be attached.

---

## Data Flow Summary

```
Engineer Layer N
  │
  ├─ Attempt 1 (all files in layer)
  │    ├─ server: extractMultiFileCodePartial
  │    ├─ success → files_complete → done
  │    ├─ partial → partial_files_complete {ok, failed, tail}
  │    │            → client accumulates ok, surfaces to Sandpack
  │    │            → requests attempt 2 with only failed subset
  │    └─ zero ok → error parse_failed → client treats as all failed
  │
  ├─ Attempt 2 (only prior failed, prompt has retryHint)
  │    └─ same branches; accumulated files carry over
  │
  └─ Per-file fallback (each remaining file, up to 2 attempts each)
       ├─ circuit breaker: 3 consecutive file failures → abort layer
       └─ remaining failures surface as failedFiles list, layer completes
```

---

## Testing Plan

### Unit tests

1. **`__tests__/extract-code.test.ts`** — add cases for `extractMultiFileCodePartial`:
   - 6 files all valid → `ok: 6, failed: 0, truncatedTail: null`
   - 6 files, 1 brace-unbalanced → `ok: 5, failed: 1, truncatedTail: <200 chars>`
   - 6 files, 2 missing → `ok: 4, failed: 2`
   - 0 files present → `ok: 0, failed: 6`

2. **`__tests__/engineer-circuit.test.ts`** — rewrite for new contract:
   - Attempt 1 returns `{ ok: 5, failed: 1 }` → attempt 2 called with `files.length === 1, meta.attempt === 2, meta.priorFailed === [failedPath]` → attempt 2 returns full → final `{ files: 6, failed: [] }`
   - Both attempts fail → per-file fallback invoked for each remaining file
   - `onAttempt` callback: assert sequence of `{attempt, reason, failedSubset, phase}` calls
   - Abort signal mid-retry → throws Aborted, no further attempts

3. **`__tests__/generate-prompts.test.ts`** (new or existing) — `retryHint` prepends 【重试提示】 block; without it, prompt unchanged.

### Integration tests

4. **`__tests__/generate-route-handler.test.ts`** — existing test for `parse_failed` updated to assert `partial_files_complete` event is emitted when 5/6 files parse successfully.

### Manual verification

5. Reproduce with student-management-system prompt; verify layer-4 shows retry banner, only failed files re-request, total time < 2× original layer time.

---

## Backward Compatibility

- `files_complete` event unchanged (emitted when all files parse).
- Old `extractMultiFileCode` function retained (non-breaking).
- `EngineerProgress.retryInfo` is optional/nullable — existing sessions without it render as before.
- SSE consumers that don't know `partial_files_complete` will ignore it; however the only consumer is `readEngineerSSE`, which is updated.

---

## Open Questions (resolved)

- **Q1**: Max attempts → 2 full-layer + 2 per-file (down from 3+3). **Accepted.**
- **Q2**: Partial-success files → eagerly rendered to Sandpack preview after each layer's `partial_files_complete`. **Accepted.**

---

## Out of Scope (explicitly not doing)

- Streaming individual files to Sandpack mid-generation (too much thrash).
- Switching model on retry (separate concern).
- Server-side circuit-breaker / provider failover.
- Changing layer topology dynamically when layers are too big (future work).
