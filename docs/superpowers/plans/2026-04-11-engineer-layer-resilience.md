# Engineer Layer Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix engineer layer `parse_failed` silent retries by salvaging partially-parsed files, showing retry state to users, and using adaptive retry prompts that only re-request failed files.

**Architecture:** Three coordinated changes: (A) new `extractMultiFileCodePartial` returns `{ok, failed, truncatedTail}` instead of null-on-any-failure → server emits new `partial_files_complete` event; (B) rewritten `runLayerWithFallback` retries only failed subset with 2+2 retry budget and calls `onAttempt` callback → UI surfaces `retryInfo` in status bar; (C) `getMultiFileEngineerPrompt` accepts `retryHint` that prepends a retry-specific instruction block. Eager partial render: each layer's successful files are pushed to Sandpack immediately.

**Tech Stack:** TypeScript, Next.js 14 App Router (Edge), Jest (jsdom + node projects), React 18. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-11-engineer-layer-resilience-design.md`

---

## File Structure

### New files
- None. All changes extend existing modules.

### Modified files

| File | Responsibility | Why this file |
|------|---------------|---------------|
| `lib/extract-code.ts` | Add `extractMultiFileCodePartial` | Parser lives here; keep `extractMultiFileCode` unchanged for other callers |
| `lib/types.ts` | Add `PartialExtractResult`, `AttemptInfo`, `RequestMeta`, `RequestResult`, `retryInfo` on `EngineerProgress`, new SSE event variant | Shared types module |
| `lib/engineer-circuit.ts` | Replace `runLayerWithFallback` retry loop with subset-aware 2+2 flow + `onAttempt` callback | Retry orchestration belongs here |
| `lib/generate-prompts.ts` | Extend `MultiFileEngineerPromptInput` with `retryHint` | Prompt assembly lives here |
| `app/api/generate/handler.ts` | Emit `partial_files_complete` / enriched `parse_failed` | Only place server inspects engineer output |
| `components/workspace/chat-area.tsx` | Wire new request contract, `onAttempt`, eager Sandpack push, retryHint propagation | Core orchestrator |
| `components/agent/agent-status-bar.tsx` | Render `retryInfo` banner | Engineer progress display |
| `__tests__/extract-code.test.ts` | Tests for `extractMultiFileCodePartial` | Existing parser test file |
| `__tests__/engineer-circuit.test.ts` | Rewrite EC-10…EC-13 + add EC-20…EC-24 for new contract | Existing circuit test file |
| `__tests__/generate-route-handler.test.ts` | Add partial-success handler case | Existing handler test file |

### Untouched (explicit non-goals)
- `lib/ai-providers.ts`, `lib/topo-sort.ts`, `lib/version-files.ts`, `lib/sandpack-config.ts`
- PM / Architect code paths
- `lib/extract-code.ts`'s `extractMultiFileCode`, `extractAnyMultiFileCode`, `extractReactCode`, `findMissingLocalImports*`

---

## Task Sequence Overview

1. **Task 1** — Types additions (no logic yet)
2. **Task 2** — `extractMultiFileCodePartial` (parser)
3. **Task 3** — Handler emits `partial_files_complete` (server)
4. **Task 4** — Rewrite `runLayerWithFallback` (retry loop + `onAttempt`)
5. **Task 5** — `getMultiFileEngineerPrompt` retryHint
6. **Task 6** — `readEngineerSSE` returns `{files, failedInResponse, truncatedTail}`
7. **Task 7** — Wire `chat-area.tsx` retry/retryHint/eager push
8. **Task 8** — `agent-status-bar` retry banner
9. **Task 9** — Handler test update
10. **Task 10** — Manual verification + cleanup

Each task ends with a commit. TDD: every logic-bearing task starts with a failing test.

---

## Task 1: Add new types

**Files:**
- Modify: `lib/types.ts:90-117` (SSE event types), `lib/types.ts:159-166` (EngineerProgress)
- No tests (pure types)

- [ ] **Step 1: Add `PartialExtractResult` and retry primitives to `lib/types.ts`**

Insert after line 117 (after the existing `SSEEvent` interface):

```ts
// ---------------------------------------------------------------
// Engineer multi-file partial-salvage types (spec 2026-04-11)
// ---------------------------------------------------------------

export interface PartialExtractResult {
  readonly ok: Record<string, string>;
  readonly failed: readonly string[];
  readonly truncatedTail: string | null;
}

export interface RequestMeta {
  readonly attempt: number;        // 1-indexed
  readonly priorFailed: readonly string[];
}

export interface RequestResult {
  readonly files: Record<string, string>;
  readonly failed: readonly string[];
}

export type AttemptReason =
  | "initial"
  | "parse_failed"
  | "http_error"
  | "per_file_fallback";

export interface AttemptInfo {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly reason: AttemptReason;
  readonly failedSubset: readonly string[];
  readonly phase: "layer" | "per_file";
}
```

- [ ] **Step 2: Extend `SSEEventType` union and `SSEEvent` interface**

Replace `SSEEventType` at line 90-98:

```ts
export type SSEEventType =
  | "thinking"
  | "chunk"
  | "code_chunk"
  | "code_complete"
  | "files_complete"
  | "partial_files_complete"
  | "reset"
  | "done"
  | "error";
```

Replace `SSEEvent` interface at line 109-117:

```ts
export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  failed?: readonly string[];
  truncatedTail?: string;
  failedFiles?: readonly string[];
  messageId?: string;
  error?: string;
  errorCode?: ErrorCode;
}
```

- [ ] **Step 3: Add `retryInfo` to `EngineerProgress`**

Replace lines 159-166:

```ts
export interface EngineerProgress {
  readonly totalLayers: number;
  readonly currentLayer: number;
  readonly totalFiles: number;
  readonly currentFiles: readonly string[];
  readonly completedFiles: readonly string[];
  readonly failedFiles: readonly string[];
  readonly retryInfo: {
    readonly layerIdx: number;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly reason: AttemptReason;
    readonly failedSubset: readonly string[];
    readonly phase: "layer" | "per_file";
  } | null;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: Errors in `chat-area.tsx`, `engineer-circuit.ts`, `agent-status-bar.tsx` referencing `EngineerProgress` without `retryInfo`. These will be fixed in later tasks. **Acceptable — proceed.** If there are errors in other unrelated files, stop and investigate.

- [ ] **Step 5: Temporary shim for `retryInfo: null` in existing EngineerProgress initializations**

Two call sites construct `EngineerProgress` directly — fix them now so the codebase compiles between tasks:

`components/workspace/chat-area.tsx` around line 357-366 — add `retryInfo: null` to the object:

```ts
updateSession(project.id, {
  engineerProgress: {
    totalLayers: layers.length,
    currentLayer: 0,
    totalFiles,
    currentFiles: [],
    completedFiles: [],
    failedFiles: [],
    retryInfo: null,
  },
});
```

Grep to confirm no other construction sites:

Run: `grep -rn "engineerProgress:" --include="*.ts" --include="*.tsx" components lib app hooks`

If another call site builds `EngineerProgress` without `retryInfo`, add `retryInfo: null` to it.

- [ ] **Step 6: Typecheck again**

Run: `npx tsc --noEmit`

Expected: No new errors beyond the ones that were already present (pre-existing errors from later tasks are OK; types should not have regressed).

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts components/workspace/chat-area.tsx
git commit -m "feat(types): add partial extract + retry info types for engineer resilience"
```

---

## Task 2: `extractMultiFileCodePartial`

**Files:**
- Modify: `lib/extract-code.ts` (add function after line 215, leave existing `extractMultiFileCode` untouched)
- Test: `__tests__/extract-code.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/extract-code.test.ts` (at end of file):

```ts
import { extractMultiFileCodePartial } from "@/lib/extract-code";

describe("extractMultiFileCodePartial", () => {
  const expected = ["/A.js", "/B.js", "/C.js"];

  it("returns ok={3}, failed=[], truncatedTail=null when all files are valid", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
      "// === FILE: /B.js ===",
      "export const B = () => { return 2 }",
      "// === FILE: /C.js ===",
      "export const C = () => { return 3 }",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, expected);
    expect(Object.keys(result.ok)).toEqual(["/A.js", "/B.js", "/C.js"]);
    expect(result.failed).toEqual([]);
    expect(result.truncatedTail).toBeNull();
  });

  it("returns partial ok + failed when one file has unbalanced braces", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
      "// === FILE: /B.js ===",
      "export const B = () => { return 2 }",
      "// === FILE: /C.js ===",
      "export const C = () => { if (true) { return 3 ", // missing closing braces
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, expected);
    expect(result.ok["/A.js"]).toContain("return 1");
    expect(result.ok["/B.js"]).toContain("return 2");
    expect(result.ok["/C.js"]).toBeUndefined();
    expect(result.failed).toEqual(["/C.js"]);
    expect(result.truncatedTail).not.toBeNull();
    expect(result.truncatedTail!.length).toBeLessThanOrEqual(200);
    expect(result.truncatedTail).toContain("return 3");
  });

  it("reports missing files in failed[] without affecting present ones", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, expected);
    expect(Object.keys(result.ok)).toEqual(["/A.js"]);
    expect(result.failed.sort()).toEqual(["/B.js", "/C.js"]);
    expect(result.truncatedTail).not.toBeNull();
  });

  it("returns ok={}, failed=all, truncatedTail set when no markers present", () => {
    const raw = "just some nonsense output from the model";
    const result = extractMultiFileCodePartial(raw, expected);
    expect(result.ok).toEqual({});
    expect(result.failed.sort()).toEqual(["/A.js", "/B.js", "/C.js"]);
    expect(result.truncatedTail).toBe("just some nonsense output from the model");
  });

  it("returns ok={}, failed=[], truncatedTail=null when expectedFiles is empty", () => {
    const result = extractMultiFileCodePartial("anything", []);
    expect(result.ok).toEqual({});
    expect(result.failed).toEqual([]);
    expect(result.truncatedTail).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-code"`

Expected: 5 new tests fail with `extractMultiFileCodePartial is not a function` or import error.

- [ ] **Step 3: Implement `extractMultiFileCodePartial`**

Append to `lib/extract-code.ts` (after the existing `extractMultiFileCode` at line 215):

```ts
/**
 * Parse multi-file engineer output and return a partial-salvage result:
 *   - ok:   files that are present AND have balanced braces
 *   - failed: expected files that are missing OR brace-unbalanced
 *   - truncatedTail: last ~200 chars of raw input when any file failed, else null
 *
 * Unlike extractMultiFileCode (which returns null on any failure), this keeps
 * successfully-parsed files so the caller can retry only the failed subset.
 */
import type { PartialExtractResult } from "@/lib/types";

export function extractMultiFileCodePartial(
  raw: string,
  expectedFiles: readonly string[]
): PartialExtractResult {
  if (expectedFiles.length === 0) {
    return { ok: {}, failed: [], truncatedTail: null };
  }

  const marker = /^\/\/ === FILE: (.+?) ===/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1];
      fileMap[currentPath] = [];
    } else if (currentPath !== null) {
      fileMap[currentPath].push(line);
    }
  }

  const ok: Record<string, string> = {};
  const failed: string[] = [];

  for (const path of expectedFiles) {
    const codeLines = fileMap[path];
    if (!codeLines) {
      failed.push(path);
      continue;
    }
    const code = codeLines.join("\n").trim();
    if (!isBracesBalanced(code)) {
      failed.push(path);
      continue;
    }
    ok[path] = code;
  }

  const truncatedTail =
    failed.length > 0
      ? raw.slice(Math.max(0, raw.length - 200))
      : null;

  return { ok, failed, truncatedTail };
}
```

Note: `isBracesBalanced` is already defined as a private function at line 49 in this same file — reuse it directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-code"`

Expected: All 5 new tests pass. Existing `extractMultiFileCode` / `extractReactCode` tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat(extract-code): add extractMultiFileCodePartial for partial file salvage"
```

---

## Task 3: Server emits `partial_files_complete`

**Files:**
- Modify: `app/api/generate/handler.ts:132-140` (engineer multi-file branch)
- Test: deferred to Task 9 (handler test updates)

- [ ] **Step 1: Update engineer multi-file branch**

Replace lines 132-140 of `app/api/generate/handler.ts`:

```ts
            } else if (targetFiles && targetFiles.length > 0) {
              const { extractMultiFileCodePartial } = await import("@/lib/extract-code");
              const expectedPaths = targetFiles.map((f) => f.path);
              const result = extractMultiFileCodePartial(fullContent, expectedPaths);
              const okCount = Object.keys(result.ok).length;

              if (okCount === 0) {
                send(controller, {
                  type: "error",
                  error: "生成的代码不完整，请重试",
                  errorCode: "parse_failed" satisfies ErrorCode,
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
            } else {
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: The `partial_files_complete` and `failedFiles` fields resolve against the `SSEEvent` additions from Task 1. No new errors from this file. Pre-existing errors from other unfinished tasks are OK.

- [ ] **Step 3: Commit**

```bash
git add app/api/generate/handler.ts
git commit -m "feat(api/generate): emit partial_files_complete + enriched parse_failed metadata"
```

---

## Task 4: Rewrite `runLayerWithFallback` with subset-aware retry + onAttempt

**Files:**
- Modify: `lib/engineer-circuit.ts` (full rewrite of `runLayerWithFallback`; preserve `retryWithBackoff` export for any external callers)
- Test: `__tests__/engineer-circuit.test.ts` (rewrite EC-10…EC-13 for new contract, add EC-20…EC-24)

### 4a. Write failing tests first

- [ ] **Step 1: Replace the `runLayerWithFallback` describe block**

Replace lines 85-159 of `__tests__/engineer-circuit.test.ts` (the entire `describe("runLayerWithFallback", ...)` block) with:

```ts
describe("runLayerWithFallback (subset-aware)", () => {
  beforeEach(() => jest.clearAllTimers());

  // EC-10: all files succeed in attempt 1
  it("EC-10: 首次全部成功，一次调用完成", async () => {
    const requestFn = jest.fn().mockResolvedValue({
      files: { "/A.js": "code-a", "/B.js": "code-b" },
      failed: [],
    });
    const result = await runLayerWithFallback([FILE_A, FILE_B], requestFn);
    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn.mock.calls[0][0]).toHaveLength(2);
    expect(requestFn.mock.calls[0][1]).toEqual({ attempt: 1, priorFailed: [] });
  });

  // EC-11: attempt 1 partial, attempt 2 only re-requests failed subset
  it("EC-11: 首次部分失败，第二次仅重试失败子集", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: { "/B.js": "code-b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B], fn);

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2);
    // Attempt 2: only /B.js requested, priorFailed reflects /B.js
    expect(fn.mock.calls[1][0]).toHaveLength(1);
    expect(fn.mock.calls[1][0][0].path).toBe("/B.js");
    expect(fn.mock.calls[1][1]).toEqual({ attempt: 2, priorFailed: ["/B.js"] });
  });

  // EC-12: both layer attempts fail → per-file fallback (2 tries per file)
  it("EC-12: 两轮整层失败后降级为逐文件，每文件最多 2 次", async () => {
    const fn = jest.fn();
    // Layer attempt 1 + 2: both fail entirely
    fn.mockResolvedValueOnce({ files: {}, failed: ["/A.js", "/B.js"] });
    fn.mockResolvedValueOnce({ files: {}, failed: ["/A.js", "/B.js"] });
    // Per-file /A.js attempt 1: success
    fn.mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: [] });
    // Per-file /B.js attempt 1: fail, attempt 2: success
    fn.mockResolvedValueOnce({ files: {}, failed: ["/B.js"] });
    fn.mockResolvedValueOnce({ files: { "/B.js": "code-b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B], fn);

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  // EC-13: circuit breaker — 3 consecutive per-file failures abort remaining
  it("EC-13: 断路器触发后剩余文件直接标记失败", async () => {
    const FILE_D: ScaffoldFile = { path: "/D.js", description: "D", exports: ["D"], deps: [], hints: "" };
    // All layer + per-file attempts fail
    const fn = jest.fn().mockImplementation(async (files: readonly ScaffoldFile[]) => ({
      files: {},
      failed: files.map((f) => f.path),
    }));

    const result = await runLayerWithFallback([FILE_A, FILE_B, FILE_C, FILE_D], fn);

    expect(result.failed.sort()).toEqual(["/A.js", "/B.js", "/C.js", "/D.js"].sort());
    // D should never have been requested singly (circuit opened after A, B, C failed)
    const dSingleCalls = fn.mock.calls.filter(
      ([files]) => files.length === 1 && files[0].path === "/D.js"
    );
    expect(dSingleCalls).toHaveLength(0);
  });

  // EC-20: onAttempt callback fires with correct metadata
  it("EC-20: onAttempt 在每次尝试前被调用", async () => {
    const events: Array<{ attempt: number; reason: string; phase: string; failedSubset: string[] }> = [];
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: { "/B.js": "code-b" }, failed: [] });

    await runLayerWithFallback(
      [FILE_A, FILE_B],
      fn,
      undefined,
      (info) => {
        events.push({
          attempt: info.attempt,
          reason: info.reason,
          phase: info.phase,
          failedSubset: [...info.failedSubset],
        });
      }
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      attempt: 1,
      reason: "initial",
      phase: "layer",
      failedSubset: ["/A.js", "/B.js"],
    });
    expect(events[1]).toEqual({
      attempt: 2,
      reason: "parse_failed",
      phase: "layer",
      failedSubset: ["/B.js"],
    });
  });

  // EC-21: onAttempt reports per_file_fallback phase
  it("EC-21: onAttempt 在降级阶段 phase=per_file", async () => {
    const events: Array<{ phase: string; reason: string }> = [];
    const fn = jest
      .fn()
      // 2 layer failures
      .mockResolvedValueOnce({ files: {}, failed: ["/A.js"] })
      .mockResolvedValueOnce({ files: {}, failed: ["/A.js"] })
      // per-file /A.js success
      .mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: [] });

    await runLayerWithFallback(
      [FILE_A],
      fn,
      undefined,
      (info) => { events.push({ phase: info.phase, reason: info.reason }); }
    );

    expect(events.map((e) => e.phase)).toEqual(["layer", "layer", "per_file"]);
    expect(events[2].reason).toBe("per_file_fallback");
  });

  // EC-22: requestFn throwing is treated as "all files failed this attempt"
  it("EC-22: requestFn 抛异常等价于全部文件失败", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce({ files: { "/A.js": "code-a", "/B.js": "code-b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B], fn);

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][1]).toEqual({ attempt: 2, priorFailed: ["/A.js", "/B.js"] });
  });

  // EC-23: abort signal mid-retry halts further attempts
  it("EC-23: abort 信号触发后停止重试", async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockImplementation(async () => {
      controller.abort();
      return { files: {}, failed: ["/A.js"] };
    });

    await expect(
      runLayerWithFallback([FILE_A], fn, controller.signal)
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // EC-24: accumulated files persist across attempts
  it("EC-24: 跨 attempt 累积已成功文件", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: { "/A.js": "a", "/C.js": "c" }, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: {}, failed: ["/B.js"] })
      // per-file /B.js success
      .mockResolvedValueOnce({ files: { "/B.js": "b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B, FILE_C], fn);

    expect(result.files).toEqual({ "/A.js": "a", "/B.js": "b", "/C.js": "c" });
    expect(result.failed).toEqual([]);
  });
});
```

Also remove or update the top-level import at line 1 — `retryWithBackoff` is still exported but no longer exercised by `runLayerWithFallback`. Keep the existing `retryWithBackoff` describe block (EC-01…EC-05) as-is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="engineer-circuit"`

Expected: EC-10…EC-13 and EC-20…EC-24 all fail (type errors or "requestFn expected to return {files, failed}"). EC-01…EC-05 still pass.

### 4b. Implement new `runLayerWithFallback`

- [ ] **Step 3: Rewrite `runLayerWithFallback` in `lib/engineer-circuit.ts`**

Replace the entire content of `lib/engineer-circuit.ts` from line 31 onward (keep `retryWithBackoff` at lines 3-29 for backward compatibility):

```ts
import type {
  ScaffoldFile,
  RequestMeta,
  RequestResult,
  AttemptInfo,
  AttemptReason,
} from "@/lib/types";

// retryWithBackoff (existing, lines 3-29) stays as-is.

export interface LayerResult {
  files: Record<string, string>;
  failed: string[];
}

const MAX_LAYER_ATTEMPTS = 2;
const MAX_PER_FILE_ATTEMPTS = 2;
const CIRCUIT_BREAKER_THRESHOLD = 3;

export async function runLayerWithFallback(
  layerFiles: readonly ScaffoldFile[],
  requestFn: (
    files: readonly ScaffoldFile[],
    meta: RequestMeta
  ) => Promise<RequestResult>,
  signal?: AbortSignal,
  onAttempt?: (info: AttemptInfo) => void
): Promise<LayerResult> {
  const accumulated: Record<string, string> = {};
  const pathsInLayer = layerFiles.map((f) => f.path);
  let remaining: readonly ScaffoldFile[] = layerFiles;
  let priorFailed: readonly string[] = [];

  // Phase 1: full-layer (subset) attempts
  for (let attempt = 1; attempt <= MAX_LAYER_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("Aborted");
    if (remaining.length === 0) break;

    const reason: AttemptReason = attempt === 1 ? "initial" : "parse_failed";
    onAttempt?.({
      attempt,
      maxAttempts: MAX_LAYER_ATTEMPTS,
      reason,
      failedSubset: remaining.map((f) => f.path),
      phase: "layer",
    });

    let result: RequestResult;
    try {
      result = await requestFn(remaining, { attempt, priorFailed });
    } catch (err) {
      if (signal?.aborted) throw err;
      // Treat thrown errors as "all requested files failed this attempt"
      result = { files: {}, failed: remaining.map((f) => f.path) };
    }

    Object.assign(accumulated, result.files);
    const stillMissing = pathsInLayer.filter((p) => !(p in accumulated));
    remaining = layerFiles.filter((f) => stillMissing.includes(f.path));
    priorFailed = result.failed;
  }

  if (remaining.length === 0) {
    return { files: accumulated, failed: [] };
  }

  // Phase 2: per-file fallback with circuit breaker
  const failedFinal: string[] = [];
  let consecutiveFailures = 0;

  for (const file of remaining) {
    if (signal?.aborted) throw new Error("Aborted");
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      failedFinal.push(file.path);
      continue;
    }

    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_PER_FILE_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new Error("Aborted");
      onAttempt?.({
        attempt,
        maxAttempts: MAX_PER_FILE_ATTEMPTS,
        reason: "per_file_fallback",
        failedSubset: [file.path],
        phase: "per_file",
      });

      let result: RequestResult;
      try {
        result = await requestFn([file], {
          attempt,
          priorFailed: [file.path],
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        result = { files: {}, failed: [file.path] };
      }

      if (file.path in result.files) {
        accumulated[file.path] = result.files[file.path];
        succeeded = true;
        consecutiveFailures = 0;
        break;
      }
    }

    if (!succeeded) {
      failedFinal.push(file.path);
      consecutiveFailures++;
    }
  }

  return { files: accumulated, failed: failedFinal };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="engineer-circuit"`

Expected: All EC-01…EC-05 (retryWithBackoff, unchanged) + EC-10…EC-13 + EC-20…EC-24 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/engineer-circuit.ts __tests__/engineer-circuit.test.ts
git commit -m "refactor(engineer-circuit): subset-aware retry with onAttempt callback"
```

---

## Task 5: `getMultiFileEngineerPrompt` `retryHint` parameter

**Files:**
- Modify: `lib/generate-prompts.ts:151-158` (interface), `lib/generate-prompts.ts:160-193` (function body)
- Test: add to `__tests__/generate-prompts.test.ts` if it exists, else create it

- [ ] **Step 1: Check test file existence**

Run: `ls __tests__/generate-prompts.test.ts 2>/dev/null || echo MISSING`

If MISSING, proceed to Step 2 which creates it.

- [ ] **Step 2: Write failing test**

Create or append to `__tests__/generate-prompts.test.ts`:

```ts
import { getMultiFileEngineerPrompt } from "@/lib/generate-prompts";
import type { ScaffoldFile } from "@/lib/types";

const FILE: ScaffoldFile = {
  path: "/App.js",
  description: "root",
  exports: ["App"],
  deps: [],
  hints: "",
};

describe("getMultiFileEngineerPrompt retryHint", () => {
  const baseInput = {
    projectId: "test-proj",
    targetFiles: [FILE],
    sharedTypes: "",
    completedFiles: {},
    designNotes: "",
  };

  it("omits retry block when retryHint is undefined", () => {
    const prompt = getMultiFileEngineerPrompt(baseInput);
    expect(prompt).not.toContain("【重试提示");
  });

  it("prepends retry block when retryHint is provided", () => {
    const prompt = getMultiFileEngineerPrompt({
      ...baseInput,
      retryHint: { attempt: 2, reason: "parse_failed" },
    });
    expect(prompt).toContain("【重试提示");
    expect(prompt).toContain("尝试 #2");
    expect(prompt).toContain("parse_failed");
  });

  it("includes priorTail when provided", () => {
    const prompt = getMultiFileEngineerPrompt({
      ...baseInput,
      retryHint: {
        attempt: 2,
        reason: "parse_failed",
        priorTail: "const unclosed = { field:",
      },
    });
    expect(prompt).toContain("const unclosed = { field:");
  });

  it("retry block appears before 【严禁包限制", () => {
    const prompt = getMultiFileEngineerPrompt({
      ...baseInput,
      retryHint: { attempt: 2, reason: "parse_failed" },
    });
    const retryIdx = prompt.indexOf("【重试提示");
    const banIdx = prompt.indexOf("【严禁包限制");
    expect(retryIdx).toBeGreaterThanOrEqual(0);
    expect(banIdx).toBeGreaterThan(retryIdx);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="generate-prompts"`

Expected: 4 tests fail (retryHint not a known property, or no retry block in prompt).

- [ ] **Step 4: Extend `MultiFileEngineerPromptInput` interface**

Replace lines 151-158 of `lib/generate-prompts.ts`:

```ts
interface MultiFileEngineerPromptInput {
  readonly projectId: string;
  readonly targetFiles: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly completedFiles: Record<string, string>;
  readonly designNotes: string;
  readonly existingFiles?: Record<string, string>;
  readonly retryHint?: {
    readonly attempt: number;
    readonly reason: string;
    readonly priorTail?: string;
  };
}
```

- [ ] **Step 5: Build retry block and prepend it**

In `lib/generate-prompts.ts`, update the `getMultiFileEngineerPrompt` function body. After line 161 (the destructuring), add:

```ts
  const retryBlock = input.retryHint
    ? `【重试提示 — 上一次尝试 #${input.retryHint.attempt} 失败：${input.retryHint.reason}】
严格要求：
1. 只输出下列 ${targetFiles.length} 个文件，其它已生成完毕，不要重复输出
2. 省略所有注释、示例代码、解释性文本
3. 每个文件必须以完整的 // === FILE: /path === 块开始
4. 最后一个文件的大括号必须平衡
5. 不要输出 markdown 说明文字${input.retryHint.priorTail ? `

上一次输出末尾片段（供判断截断位置）：
---
${input.retryHint.priorTail}
---` : ""}

`
    : "";
```

Then in the `return` template literal (around line 193), prepend `${retryBlock}`:

```ts
  return `${retryBlock}你是一位全栈工程师。根据架构师的文件脚手架，实现以下目标文件。

【严禁包限制 - 违反将导致代码无法运行】
...
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="generate-prompts"`

Expected: All 4 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
git commit -m "feat(generate-prompts): add retryHint param for adaptive retry prompts"
```

---

## Task 6: `readEngineerSSE` returns richer result

**Files:**
- Modify: `components/workspace/chat-area.tsx:149-183`
- Test: covered via integration in Task 7 + existing handler test in Task 9

- [ ] **Step 1: Update `readEngineerSSE` signature and body**

Replace lines 149-183 of `components/workspace/chat-area.tsx`:

```tsx
  interface EngineerSSEResult {
    files: Record<string, string>;
    failedInResponse: string[];
    truncatedTail?: string;
  }

  async function readEngineerSSE(
    body: ReadableStream<Uint8Array>,
    tag: string
  ): Promise<EngineerSSEResult> {
    let files: Record<string, string> | null = null;
    let failedInResponse: string[] = [];
    let truncatedTail: string | undefined;

    await readSSEBody<{
      type: string;
      code?: string;
      files?: Record<string, string>;
      failed?: string[];
      truncatedTail?: string;
      error?: string;
      errorCode?: ErrorCode;
      failedFiles?: string[];
    }>(
      body,
      (event) => {
        if (event.type === "files_complete" && event.files) {
          files = event.files;
          failedInResponse = [];
        } else if (event.type === "partial_files_complete" && event.files) {
          files = event.files;
          failedInResponse = event.failed ?? [];
          truncatedTail = event.truncatedTail;
        } else if (event.type === "code_complete" && event.code) {
          files = { "/App.js": event.code };
          failedInResponse = [];
        } else if (event.type === "error") {
          throw Object.assign(
            new Error(event.error ?? "Stream error"),
            {
              errorCode: event.errorCode ?? "unknown",
              failedFiles: event.failedFiles ?? [],
              truncatedTail: event.truncatedTail,
            }
          );
        }
      },
      {
        tag,
        onStall: () => updateSession(project.id, { stallWarning: true }),
      }
    );

    if (!files) throw new Error("No files received from engineer");
    return { files, failedInResponse, truncatedTail };
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: New errors appear at call site (line 426) where the old return type was `Record<string, string>` — Task 7 fixes this.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "refactor(chat-area): readEngineerSSE returns {files, failedInResponse, truncatedTail}"
```

---

## Task 7: Wire retry + retryHint + eager Sandpack push in `chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx:392-446` (the `runLayerWithFallback` call + post-layer block)
- Test: manual verification in Task 10

- [ ] **Step 1: Hoist `lastTruncatedTail` above the layer loop**

In `components/workspace/chat-area.tsx`, find the start of the `for (let layerIdx ...)` loop (around line 368). Immediately before this loop add:

```tsx
            let lastTruncatedTail: string | undefined;
```

- [ ] **Step 2: Rewrite the `runLayerWithFallback` call with new requestFn contract**

Replace lines 392-429 (`const layerResult = await runLayerWithFallback(...)` through the closing paren):

```tsx
              const layerResult = await runLayerWithFallback(
                layerFiles,
                async (files, meta) => {
                  const engineerPrompt = getMultiFileEngineerPrompt({
                    projectId: project.id,
                    targetFiles: files,
                    sharedTypes: scaffold.sharedTypes,
                    completedFiles: allCompletedFiles,
                    designNotes: scaffold.designNotes,
                    existingFiles: hasExistingCode ? currentFiles : undefined,
                    retryHint:
                      meta.attempt > 1
                        ? {
                            attempt: meta.attempt,
                            reason: "parse_failed",
                            priorTail: lastTruncatedTail,
                          }
                        : undefined,
                  });

                  const response = await fetch("/api/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      projectId: project.id,
                      prompt,
                      agent: "engineer",
                      context: engineerPrompt,
                      modelId: selectedModel,
                      targetFiles: files,
                      completedFiles: allCompletedFiles,
                      scaffold: { sharedTypes: scaffold.sharedTypes, designNotes: scaffold.designNotes },
                    }),
                    signal: abortController.signal,
                  });

                  if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
                  }
                  if (!response.body) throw new Error("No response body");
                  updateSession(project.id, { transitionText: null });
                  const sseResult = await readEngineerSSE(
                    response.body,
                    `engineer:layer-${layerIdx + 1}`
                  );
                  lastTruncatedTail = sseResult.truncatedTail;
                  return {
                    files: sseResult.files,
                    failed: sseResult.failedInResponse,
                  };
                },
                abortController.signal,
                (info) => {
                  const prev = getSession(project.id).engineerProgress;
                  if (!prev) return;
                  const isFirstLayerAttempt =
                    info.attempt === 1 && info.phase === "layer";
                  updateSession(project.id, {
                    engineerProgress: {
                      ...prev,
                      retryInfo: isFirstLayerAttempt
                        ? null
                        : {
                            layerIdx,
                            attempt: info.attempt,
                            maxAttempts: info.maxAttempts,
                            reason: info.reason,
                            failedSubset: [...info.failedSubset],
                            phase: info.phase,
                          },
                    },
                  });
                }
              );
```

- [ ] **Step 3: Clear `retryInfo` after layer completes + eagerly push files to Sandpack**

After the `layerResult.failed.length > 0` block (around line 434, right after updating `engineerProgress.completedFiles`), add:

```tsx
              // Clear retryInfo once the layer settles
              {
                const prev = getSession(project.id).engineerProgress;
                if (prev) {
                  updateSession(project.id, {
                    engineerProgress: { ...prev, retryInfo: null },
                  });
                }
              }

              // Eager Sandpack push: let users see partial progress after each layer
              if (Object.keys(allCompletedFiles).length > 0) {
                try {
                  const eagerRes = await fetchAPI("/api/versions", {
                    method: "POST",
                    body: JSON.stringify({
                      projectId: project.id,
                      files: allCompletedFiles,
                      description: `layer-${layerIdx + 1} partial`,
                      transient: true,
                    }),
                  });
                  if (eagerRes.ok) {
                    const eagerVersion = await eagerRes.json();
                    onFilesGenerated({ ...allCompletedFiles }, eagerVersion);
                  }
                } catch {
                  // Non-fatal: final push after all layers still runs
                }
              }
```

**Important:** The eager push creates a version row. If `transient: true` is not supported by `/api/versions`, simplify: just call `onFilesGenerated({ ...allCompletedFiles }, ...)` **without** hitting `/api/versions` — use the last finalized version object from state, or skip the second argument if the handler can accept a synthetic one. **Before proceeding, grep `/api/versions` to confirm its schema**:

Run: `grep -n "transient" app/api/versions/route.ts` — if no match, the transient flag is not supported. In that case, use this simpler variant:

```tsx
              // Eager Sandpack push: surface partial progress without persisting a version
              if (Object.keys(allCompletedFiles).length > 0) {
                // Use a synthetic non-persistent version object so Sandpack re-renders
                const syntheticVersion: ProjectVersion = {
                  id: `layer-${layerIdx + 1}-preview-${Date.now()}`,
                  projectId: project.id,
                  versionNumber: -1,
                  code: "",
                  description: `layer-${layerIdx + 1} partial preview`,
                  createdAt: new Date(),
                };
                onFilesGenerated({ ...allCompletedFiles }, syntheticVersion);
              }
```

**Decision:** use the synthetic-version variant — it's simpler and the real final version is written after all layers. Delete the `fetchAPI("/api/versions", ...)` variant above before committing.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: No errors. `ProjectVersion` is already imported at line 33.

- [ ] **Step 5: Run all Jest tests**

Run: `npm test`

Expected: All existing tests continue to pass (we haven't broken any server-side contracts; handler test is updated in Task 9).

- [ ] **Step 6: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat(chat-area): wire retry state, retryHint propagation, eager Sandpack push"
```

---

## Task 8: Show retry banner in `agent-status-bar.tsx`

**Files:**
- Modify: `components/agent/agent-status-bar.tsx:51-69`

- [ ] **Step 1: Add retry banner below the layer counter**

In `components/agent/agent-status-bar.tsx`, replace the engineer sub-progress block at lines 52-69:

```tsx
            {/* Engineer sub-progress */}
            {role === "engineer" && isActive && engineerProgress && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>
                    第 {engineerProgress.currentLayer}/{engineerProgress.totalLayers} 层
                  </span>
                  <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{
                        width: `${(engineerProgress.completedFiles.length / engineerProgress.totalFiles) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-gray-400">
                    {engineerProgress.completedFiles.length}/{engineerProgress.totalFiles}
                  </span>
                </div>
                {engineerProgress.retryInfo && (
                  <div className="text-[11px] text-amber-600 leading-tight">
                    Layer {engineerProgress.retryInfo.layerIdx + 1} 重试{" "}
                    {engineerProgress.retryInfo.attempt}/
                    {engineerProgress.retryInfo.maxAttempts}
                    {engineerProgress.retryInfo.reason === "parse_failed" && "（上次输出截断）"}
                    {engineerProgress.retryInfo.reason === "per_file_fallback" && "（逐文件回退）"}
                    {engineerProgress.retryInfo.failedSubset.length > 0 && (
                      <>
                        ：
                        {engineerProgress.retryInfo.failedSubset
                          .map((p) => p.split("/").pop())
                          .join(", ")}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: Clean, all errors resolved.

- [ ] **Step 3: Run all tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/agent/agent-status-bar.tsx
git commit -m "feat(agent-status-bar): show retry banner with reason + file subset"
```

---

## Task 9: Update handler test for partial-success case

**Files:**
- Modify: `__tests__/generate-route-handler.test.ts`

- [ ] **Step 1: Read existing handler test to find the engineer multi-file test case**

Run: `grep -n "extractMultiFileCode\|parse_failed\|files_complete\|targetFiles" __tests__/generate-route-handler.test.ts`

- [ ] **Step 2: Add (or update) a partial-success case**

Append to `__tests__/generate-route-handler.test.ts` inside the existing `describe` block for engineer multi-file path:

```ts
it("emits partial_files_complete when some files parse and some don't", async () => {
    const mockProvider: AIProvider = {
      streamCompletion: async (_msgs, onChunk) => {
        onChunk(
          [
            "// === FILE: /A.js ===",
            "export const A = () => { return 1 }",
            "// === FILE: /B.js ===",
            "export const B = () => { if (x) { return 2 ",
          ].join("\n")
        );
      },
    } as AIProvider;

    const POST = createHandler({ createProvider: () => mockProvider });
    const req = makeRequest({
      projectId: "p1",
      prompt: "test",
      agent: "engineer",
      context: "",
      targetFiles: [
        { path: "/A.js", description: "", exports: ["A"], deps: [], hints: "" },
        { path: "/B.js", description: "", exports: ["B"], deps: [], hints: "" },
      ],
    });

    const res = await POST(req);
    const events = await readAllSSEEvents(res);

    const partial = events.find((e) => e.type === "partial_files_complete");
    expect(partial).toBeDefined();
    expect(partial!.files["/A.js"]).toContain("return 1");
    expect(partial!.failed).toEqual(["/B.js"]);
    expect(partial!.truncatedTail).toBeDefined();
});

it("emits parse_failed with failedFiles metadata when all files fail", async () => {
    const mockProvider: AIProvider = {
      streamCompletion: async (_msgs, onChunk) => {
        onChunk("totally unparseable garbage");
      },
    } as AIProvider;

    const POST = createHandler({ createProvider: () => mockProvider });
    const req = makeRequest({
      projectId: "p1",
      prompt: "test",
      agent: "engineer",
      context: "",
      targetFiles: [
        { path: "/A.js", description: "", exports: ["A"], deps: [], hints: "" },
      ],
    });

    const res = await POST(req);
    const events = await readAllSSEEvents(res);

    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    expect(error!.errorCode).toBe("parse_failed");
    expect(error!.failedFiles).toEqual(["/A.js"]);
    expect(error!.truncatedTail).toBe("totally unparseable garbage");
});
```

**Important:** `makeRequest` and `readAllSSEEvents` are helpers already used in this test file. If their signatures differ from the above, adapt the calls to match existing usage — don't change the helpers. Read the top of the file first:

Run: `head -60 __tests__/generate-route-handler.test.ts`

Use the same `makeRequest` / SSE reading pattern as existing tests.

- [ ] **Step 3: Run handler tests to verify they pass**

Run: `npm test -- --testPathPatterns="generate-route-handler"`

Expected: Both new cases pass. All existing handler tests continue to pass.

- [ ] **Step 4: Commit**

```bash
git add __tests__/generate-route-handler.test.ts
git commit -m "test(generate-route-handler): cover partial_files_complete + parse_failed metadata"
```

---

## Task 10: Full verification + manual repro

**Files:** None modified — verification only.

- [ ] **Step 1: Full test suite**

Run: `npm test`

Expected: 100% passing. No regressions.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`

Expected: Clean.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: Successful build, no type errors.

- [ ] **Step 4: Manual reproduction**

Run: `npm run dev:clean`

Then in a browser:
1. Create a new project titled `[E2E] Student Management System`.
2. Prompt: `做一个学生管理系统，要有学生列表、添加/编辑学生、成绩录入、成绩统计图表、按班级筛选、数据持久化到 localStorage`
3. Watch the DevTools console for `[sse:` logs.
4. Open the engineer status bar — during generation, observe:
   - Layer counter advances through each layer.
   - If a layer produces a partial, the retry banner should appear showing `Layer N 重试 2/2`.
   - Sandpack preview should update eagerly as each layer finishes.
5. Success criteria:
   - Total engineer time < 2× the first attempt time (proving the subset retry works).
   - No silent restart of a full layer.
   - Either all files render, or a `missing_imports` error is shown with the missing paths.

- [ ] **Step 5: Delete the manual test project**

Run: `npm run test:e2e -- --grep cleanupTestProjects` (or manually delete via UI).

- [ ] **Step 6: Final self-review**

Before declaring done:
- Any new `console.log` left in production code? Run: `grep -rn "console.log" lib/ components/ app/ --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "console.error"`
- Any `TODO` / `TBD` / `FIXME` added? Run: `git diff main..HEAD | grep -E "^\+.*(TODO|TBD|FIXME)"`
- `retryWithBackoff` still exported but unused by `runLayerWithFallback` — that's fine; EC-01…EC-05 still exercise it. Leave it in place.

- [ ] **Step 7: Open PR**

```bash
git push -u origin <branch>
gh pr create --title "feat: engineer layer resilience (partial salvage + visible retry + adaptive prompt)" --body "$(cat <<'EOF'
## Summary
- Partial salvage: `extractMultiFileCodePartial` returns ok/failed/truncatedTail
- Subset-aware retry: `runLayerWithFallback` 2+2 retry budget, only re-requests failed files
- Visible retry: `EngineerProgress.retryInfo` + agent-status-bar banner
- Adaptive prompt: `retryHint` prepends retry-specific instructions
- Eager Sandpack push: partial progress rendered after each layer

Spec: docs/superpowers/specs/2026-04-11-engineer-layer-resilience-design.md
Plan: docs/superpowers/plans/2026-04-11-engineer-layer-resilience.md

## Test plan
- [x] Unit: extract-code (5 new cases)
- [x] Unit: engineer-circuit (EC-10..13 rewritten + EC-20..24 new)
- [x] Unit: generate-prompts retryHint (4 cases)
- [x] Integration: generate-route-handler partial + parse_failed metadata
- [x] Manual: student management system repro — no silent restart, retry banner visible, eager preview
EOF
)"
```

---

## Self-Review (completed during plan writing)

**Spec coverage check:**

| Spec section | Task |
|---|---|
| A.1 `extractMultiFileCodePartial` | Task 2 |
| A.2 handler branch rewrite | Task 3 |
| A.3 SSE event additions | Task 1 |
| A.4 `runLayerWithFallback` new contract | Task 4 |
| B.1 `EngineerProgress.retryInfo` | Task 1 |
| B.2 `chat-area` onAttempt wiring | Task 7 |
| B.3 UI retry banner | Task 8 |
| C.1 `getMultiFileEngineerPrompt` retryHint | Task 5 |
| C.2 `chat-area` retryHint propagation | Task 7 |
| D.1 `readEngineerSSE` shape | Task 6 |
| D.2 Eager partial render | Task 7 |
| D.3 error-codes display | no change needed (`parse_failed` display text unchanged per spec) |
| Testing: unit extract-code | Task 2 |
| Testing: unit engineer-circuit | Task 4 |
| Testing: unit generate-prompts | Task 5 |
| Testing: integration handler | Task 9 |
| Testing: manual | Task 10 |

All spec requirements are covered.

**Type consistency check:**
- `PartialExtractResult` defined in Task 1 and used in Task 2 — shapes match.
- `RequestResult` defined in Task 1 (`{files, failed}`) and returned by `requestFn` in Tasks 4 + 7 — consistent.
- `AttemptInfo.failedSubset` is `readonly string[]` — matches `retryInfo.failedSubset` copy in Task 7.
- `retryInfo.reason` uses `AttemptReason` — matches AttemptInfo.reason from Task 1.

**Placeholder scan:** No TBD / TODO / "similar to" / "add error handling" phrases. All code blocks are complete.
