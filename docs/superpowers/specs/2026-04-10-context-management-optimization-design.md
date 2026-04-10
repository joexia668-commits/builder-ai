# Context Management Optimization — Design Spec

**Date:** 2026-04-10  
**Scope:** Full-stack (lib/, components/, app/api/, no Prisma schema changes)  
**Reference:** 第7章《上下文管理 — Agent 的工作记忆》

---

## Problem Statement

The builder-ai multi-agent pipeline (PM → Architect → Engineer) has three compounding issues as project complexity grows:

1. **Token cost (A):** `getMultiFileEngineerPrompt` injects the full source code of all previously completed files into every subsequent layer. For a 10-file project, the last layer receives ~7,500 tokens of code that it mostly doesn't need.
2. **Generation quality (B):** The architect system prompt demands bare JSON output with no reasoning space. On complex projects, the model produces malformed JSON; `extractScaffold()` silently returns null and the entire multi-file path degrades to single-file mode with no user feedback.
3. **Reliability (C):** Any engineer layer failure immediately throws, discarding all successfully generated files from prior layers.

---

## Solution: Context Intelligence Layer (Plan B)

Three targeted, orthogonal changes — each independently testable.

---

## 1. Snip Compression for `completedFiles`

**File:** `lib/generate-prompts.ts`

**Problem:** `completedSection` at line 118–121 dumps full source for every completed file regardless of whether the current target file actually imports it.

**Design:**

Add `snipCompletedFiles(completedFiles, targetFiles)` before building the prompt:

```typescript
function snipCompletedFiles(
  completedFiles: Record<string, string>,
  targetFiles: readonly ScaffoldFile[]
): Record<string, string>
```

**Logic:**
- Collect `directDeps`: union of all `deps` arrays from `targetFiles`
- For files in `directDeps`: pass full source (engineer needs implementation details)
- For all other files: extract only export-signature lines via regex (`export function`, `export const`, `export default`, `export type`, `export interface`)
- Snipped file header: `// === FILE: /path (snipped — exports only) ===`

**Token impact:** Non-direct-dep files compress from ~150 lines → ~3–5 lines. A 10-file project's last layer drops from ~7,500 tokens → ~500 tokens for the completed-files section.

**Cost:** Zero LLM calls, pure string processing.

---

## 2. Fallback Retry for Engineer Layers

**File:** `lib/engineer-circuit.ts` (new), `components/workspace/chat-area.tsx`

**Problem:** A single HTTP failure on a layer request throws immediately, losing all prior work. The `failedFiles` field in `EngineerProgress` exists but is never populated.

**Design:**

New utility `lib/engineer-circuit.ts` exposes:

```typescript
interface LayerResult {
  files: Record<string, string>  // successfully generated files
  failed: string[]               // file paths that could not be generated
}

async function runLayerWithFallback(
  layerFiles: ScaffoldFile[],
  requestFn: (files: ScaffoldFile[]) => Promise<Record<string, string>>,
  signal: AbortSignal
): Promise<LayerResult>
```

**Retry state machine:**

```
1. Attempt full-layer request (all files in one call)
   → success: return files
   → fail: retry with exponential backoff (100ms, 200ms, 400ms)

2. After 3 failed layer attempts → fallback mode:
   For each file individually:
     → attempt single-file request (retryWithBackoff × 3)
     → success: add to files
     → fail: add to failed[]

3. Circuit breaker: if 3 consecutive individual-file failures → stop
   remaining files in this layer → failed[]
   (prevents infinite retries when the API itself is down)

4. Continue to next layer regardless (don't abort on partial failure)
```

**Integration:** Replace the existing `fetch("/api/generate", ...)` block in `chat-area.tsx`'s engineer loop with `runLayerWithFallback()`. The `failedFiles` in `engineerProgress` gets populated correctly.

**User experience:** Generation completes with a partial result. The UI shows "N files failed to generate, rest saved" instead of a full crash.

---

## 3. Two-Phase Output for Architect

**Files:** `app/api/generate/route.ts`, `lib/extract-json.ts`

**Problem:** Architect is required to output bare JSON with no reasoning space. Complex dependency graphs cause malformed JSON. `extractScaffold()` silently returns null → silent single-file fallback.

**Design:**

Modify the architect system prompt (in `lib/generate-prompts.ts` `getSystemPrompt("architect")`) to require two-phase output:

```
输出格式（严格遵守两个阶段）：

<thinking>
在此分析文件拆分合理性、依赖关系、模块边界。内容不限，不出现在最终结果中。
</thinking>

<output>
{"files":[...],"sharedTypes":"...","designNotes":"..."}
</output>

<output> 块内只输出 JSON，不含任何其他内容。
```

Add `extractScaffoldFromTwoPhase(raw: string): ScaffoldData | null` to `lib/extract-json.ts`:

```typescript
// 1. Try extracting JSON from <output>...</output> block
// 2. On failure, fall back to existing extractScaffold() logic
// → backward compatible with any cached/stored architect outputs
export function extractScaffoldFromTwoPhase(raw: string): ScaffoldData | null
```

Update `chat-area.tsx` to call `extractScaffoldFromTwoPhase` instead of `extractScaffold` for architect output.

**Effect:** The `<thinking>` block is discarded and never enters the context window (same principle as chapter 7's `<analysis>` block). The model reasons through dependencies before committing to JSON, reducing parse failures.

**PM agent:** Not changed — PM's JSON schema is simpler and failure rate is low.

---

## File Change Summary

| File | Change |
|------|--------|
| `lib/generate-prompts.ts` | Add `snipCompletedFiles()`; update `getMultiFileEngineerPrompt` to call it; update architect system prompt for two-phase output |
| `lib/engineer-circuit.ts` | New file: `runLayerWithFallback()`, `retryWithBackoff()`, circuit breaker state |
| `lib/extract-json.ts` | Add `extractScaffoldFromTwoPhase()` with fallback to existing logic |
| `components/workspace/chat-area.tsx` | Replace raw engineer `fetch` with `runLayerWithFallback()`; call `extractScaffoldFromTwoPhase` |
| `app/api/generate/route.ts` | No changes needed (prompt changes are in generate-prompts.ts) |

---

## Out of Scope

- Prisma schema changes (no token tracking tables)
- PM agent two-phase output
- Token usage UI indicators
- ContextBudgetManager class (deferred to future iteration)
- Message history compression for long projects

---

## Testing Plan

- Unit tests for `snipCompletedFiles()`: verify direct deps get full code, non-deps get exports only
- Unit tests for `extractScaffoldFromTwoPhase()`: valid two-phase input, malformed JSON, legacy bare-JSON fallback
- Unit tests for `retryWithBackoff()`: success on first try, success on retry, exhausted retries
- Integration test for `runLayerWithFallback()`: layer success, layer fail → individual fallback, circuit breaker trigger
- Existing `extractScaffold()` tests must remain green (no regressions)
