# Two-Phase Bug Fix Flow Design

## Goal

Prevent DeepSeek from regenerating all files during bug_fix/style_change by adding a lightweight triage phase that identifies which files need modification, then only sending those files to the Engineer for actual code changes.

## Problem

`buildDirectMultiFileEngineerContext` passes **all** current files to the LLM with an instruction to "only output modified files." DeepSeek ignores this instruction and regenerates all 15+ files (19KB+), exceeding the 150s stream timeout. The last file gets truncated, `isDelimitersBalanced` fails, and the entire response is discarded as `parse_failed`.

## Architecture

Two-phase call sequence on the bug_fix/style_change direct path:

```
Phase 1: Triage (new)
  → Lightweight LLM call with file paths only (no code content)
  → Returns JSON array of affected file paths
  → Filter against currentFiles keys (discard hallucinated paths)
  → Cap at MAX_PATCH_FILES (3)

Phase 2: Targeted Fix (existing, narrowed)
  → buildDirectMultiFileEngineerContext with only triage'd files
  → LLM sees 2-3 files max → generates only those → completes in <60s
```

Fallback: if triage returns 0 files or >MAX_PATCH_FILES, skip triage and use the current full-file behavior unchanged.

**Tech Stack:** TypeScript, existing SSE infrastructure, no new dependencies.

---

## Data Flow

```
ChatArea (bug_fix | style_change intent, multi-file app)
  │
  ├─ Phase 1: Triage
  │   buildTriageContext(prompt, Object.keys(currentFiles))
  │     → POST /api/generate { agent: "engineer", triageMode: true }
  │     → LLM returns: ["/App.js", "/utils/db.js"]
  │     → readTriageSSE() parses JSON array from streamed text
  │     → intersect with Object.keys(currentFiles) → validPaths
  │     → validPaths.length === 0 || > MAX_PATCH_FILES → fallback to full-file path
  │
  ├─ Phase 2: Targeted Fix
  │   pick(currentFiles, validPaths) → subset of files
  │   buildDirectMultiFileEngineerContext(prompt, subset)
  │     → POST /api/generate { agent: "engineer", partialMultiFile: true }
  │     → extractAnyMultiFileCode → merge with currentFiles
  │
  └─ Fallback (unchanged current behavior)
      buildDirectMultiFileEngineerContext(prompt, currentFiles)
        → POST /api/generate { agent: "engineer", partialMultiFile: true }
```

---

## Triage Phase Details

### Prompt: `getTriagePrompt()` in `lib/generate-prompts.ts`

```
你是一位代码分析助手。根据用户反馈，判断以下 React 应用中哪些文件需要修改。

用户反馈：${userPrompt}

文件列表：
${filePaths.map(p => `- ${p}`).join('\n')}

只输出一个 JSON 数组，包含需要修改的文件路径，不输出其他内容。
示例：["/App.js", "/components/Layout.js"]
```

### Context builder: `buildTriageContext(prompt, filePaths)` in `lib/agent-context.ts`

Combines user prompt with file path list. Does NOT include file contents — this is what keeps the triage call fast and cheap.

### Handler: `triageMode` flag in `app/api/generate/handler.ts`

When `triageMode: true`:
- Use `maxOutputTokens: 512` (path lists are tiny)
- Use `jsonMode: true` for structured output
- Skip all FILE-block extraction logic
- Stream raw text back, client parses JSON array from accumulated content

### Client parsing: `readTriageSSE()` in `chat-area.tsx`

Accumulate streamed chunks into a string, then `JSON.parse()` the result. If parse fails, return empty array (triggers fallback). Intersect with `Object.keys(currentFiles)` to discard hallucinated paths.

---

## Fallback Conditions

Triage is skipped (current full-file behavior used) when:

1. **Triage returns empty array** — LLM couldn't determine affected files
2. **Triage returns >MAX_PATCH_FILES paths** — too many files, not worth narrowing
3. **Triage JSON parse fails** — LLM output was not valid JSON
4. **Triage call errors/times out** — network or API failure

In all cases, the existing behavior is preserved. Triage is purely additive.

---

## Types

No new types needed. `triageMode` is a boolean flag on the request body (same pattern as `partialMultiFile`).

---

## File Impact

| File | Action |
|------|--------|
| `lib/generate-prompts.ts` | Add `getTriagePrompt()` |
| `lib/agent-context.ts` | Add `buildTriageContext(prompt, filePaths)` |
| `components/workspace/chat-area.tsx` | Insert triage phase before direct multi-file path |
| `app/api/generate/handler.ts` | Handle `triageMode` flag: limit tokens, skip FILE extraction |
| `__tests__/generate-prompts.test.ts` | Tests for `getTriagePrompt` |

**Not modified:** `extract-code.ts`, `engineer-circuit.ts`, `sandpack-config.ts`, `types.ts`

---

## Error Handling

- Triage timeout: same `STREAM_TIMEOUT_MS` as other calls (but will complete much faster due to 512 token limit)
- Triage parse error: fallback to full-file path, no user-visible error
- Triage returns paths not in currentFiles: silently filtered out via intersection
- Phase 2 fails after triage: existing retry/error behavior unchanged

---

## Testing Strategy

**`getTriagePrompt`:**
- Returns prompt containing user feedback text
- Returns prompt containing all file paths
- Does not include file contents

**`buildTriageContext`:**
- Combines prompt and file paths correctly
- File paths are listed one per line

**Integration (chat-area.tsx behavior):**
- Triage returns valid paths → only those files sent to Phase 2
- Triage returns empty → fallback to full-file path
- Triage returns >MAX_PATCH_FILES → fallback to full-file path
- Triage returns invalid JSON → fallback to full-file path
- Triage returns hallucinated paths → filtered out, remaining paths used

**E2E:** Covered by existing `e2e/code-completeness.spec.ts` behavioral tests; no new E2E spec needed.

---

## Boundaries

- Triage only runs on the `bug_fix` / `style_change` direct path with multi-file apps
- Single-file apps (V1 with 1 file) skip triage entirely (no benefit)
- Full pipeline path (`new_project` / `feature_add`) is unaffected
- Triage uses the same model as the subsequent Engineer call (user's selected model)
- No caching of triage results — each bug_fix request runs a fresh triage
