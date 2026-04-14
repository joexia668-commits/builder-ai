# Realtime Architecture Derivation for feature_add Pipeline

**Date**: 2026-04-14
**Status**: Draft

---

## Problem

When `feature_add` runs the full PM → Architect → Engineer pipeline, Architect relies on saved `archDecisions` from `iterationContext` to understand existing architecture. This mechanism has two fatal flaws:

1. **FIFO eviction**: `iterationContext` keeps only the latest 5 rounds. If 5+ `bug_fix`/`style_change` rounds accumulate, the round containing `archDecisions` is evicted — Architect gets zero context and redesigns from scratch.

2. **Stale snapshot**: `bug_fix` and `style_change` use the direct path (no Architect), so they write `archDecisions: null`. If a bug fix changes file structure (e.g., splits a component), the saved `archDecisions` from the last `feature_add` becomes outdated — Architect sees a ghost architecture that no longer exists.

Additionally, the full pipeline path has **no merge fallback**: `onFilesGenerated` receives only newly generated files, discarding any existing files not in Architect's scaffold.

**Real-world trigger**: A project with 4 consecutive `bug_fix` rounds followed by a `feature_add` ("新增暗黑模式") resulted in Architect designing a completely new 9-file structure, losing all existing Todo functionality.

---

## Design

Three-layer defense: Perception → Behavior → Fallback.

### Layer 1 — Perception: `deriveArchFromFiles()`

New pure function in `lib/agent-context.ts`. Parses `existingFiles` via regex to produce a structured summary string for Architect.

**Input**: `Record<string, string>` (file path → source code)

**Output**: A formatted string containing:

| Section | Source | Example |
|---------|--------|---------|
| File list + line count | `Object.entries()` + split by `\n` | `/App.js (45 lines)` |
| Exports per file | Regex: `/export\s+(default\s+)?(?:function|const|class)\s+(\w+)/g` | `App.js: [App (default)]` |
| Import graph | Regex: `/import\s+.*from\s+['"]([^'"]+)['"]/g` | `App.js → [TodoList, useTodos]` |
| State management | Grep for `useState`, `useReducer`, `useContext`, `createContext` | `useState, Context API` |
| Persistence | Grep for `supabase`, `localStorage` | `Supabase` |

**Replaces**: `buildArchIterationContext(archDecisions)` — no longer reads from `iterationContext`.

**Example output**:

```
当前应用架构（从代码实时分析，请在此基础上增量修改）：

文件结构（5 个文件）：
  /App.js (52 lines) — exports: App (default)
  /components/TodoList.js (38 lines) — exports: TodoList (default)
  /components/TodoItem.js (25 lines) — exports: TodoItem (default)
  /hooks/useTodos.js (41 lines) — exports: useTodos
  /utils/filters.js (18 lines) — exports: filterByStatus, filterByDate

依赖关系：
  /App.js → [/components/TodoList.js, /hooks/useTodos.js]
  /components/TodoList.js → [/components/TodoItem.js, /utils/filters.js]

状态管理：useState, Context API
持久化：Supabase
```

### Layer 2 — Behavior: Architect incremental constraint

Modify `resolveArchContext()` in `chat-area.tsx`:

```typescript
// Before
function resolveArchContext(rounds, pmOutput): string {
  const lastRoundWithArch = [...rounds].reverse().find(r => r.archDecisions !== null);
  const archCtx = lastRoundWithArch?.archDecisions
    ? buildArchIterationContext(lastRoundWithArch.archDecisions)
    : "";
  return archCtx ? `${archCtx}\n\n${pmOutput}` : pmOutput;
}

// After
function resolveArchContext(
  rounds: readonly IterationRound[],
  pmOutput: string,
  existingFiles: Record<string, string>
): string {
  const archCtx = Object.keys(existingFiles).length > 0
    ? deriveArchFromFiles(existingFiles)
    : "";
  return archCtx ? `${archCtx}\n\n${pmOutput}` : pmOutput;
}
```

Additionally, modify `getSystemPrompt("architect", ...)` in `generate-prompts.ts` to include incremental instructions when existing files are present. Architect prompt should state:

- These files already exist — do NOT redesign them
- Only output NEW files and files that MUST be modified for the new feature
- For files that need modification, include them in the scaffold with updated descriptions
- Use `removeFiles` to explicitly list files that should be deleted

### Layer 3 — Fallback: merge existing + new files

In `chat-area.tsx`, after the full pipeline Engineer loop completes:

```typescript
// Before (line ~1022)
onFilesGenerated(allCompletedFiles, version);

// After
const finalFiles = { ...currentFiles, ...allCompletedFiles };
// Remove files explicitly marked for deletion by Architect
for (const path of scaffold.removeFiles ?? []) {
  delete finalFiles[path];
}
onFilesGenerated(finalFiles, version);
```

This matches what the direct path already does (`{ ...currentFiles, ...directFiles }`).

### Layer 4 — Scaffold `removeFiles` field

Extend `ScaffoldData` in `lib/types.ts`:

```typescript
export interface ScaffoldData {
  readonly files: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly designNotes: string;
  readonly removeFiles?: readonly string[];  // NEW: files to delete from existing set
}
```

Update `validateScaffold()` in `lib/validate-scaffold.ts`:
- Pass through `removeFiles` if present
- Validate that `removeFiles` entries are not also in `files` (can't create and delete the same file)

Update Architect prompt to document this field:
- `removeFiles`: optional array of file paths that should be removed (e.g., when renaming or deleting functionality)

---

## Cleanup: Remove `archDecisions` chain

With real-time derivation, the saved `archDecisions` becomes redundant. Remove:

| Item | Location | Action |
|------|----------|--------|
| `ArchDecisions` interface | `lib/types.ts` | Delete |
| `archDecisions` field | `IterationRound` in `lib/types.ts` | Delete |
| `extractArchDecisions()` | `lib/extract-arch-decisions.ts` | Delete entire file |
| `buildArchIterationContext()` | `lib/agent-context.ts` | Delete |
| Writing archDecisions | `chat-area.tsx` line ~1083 | Remove `archDecisions: capturedScaffold ? extractArchDecisions(capturedScaffold) : null` |
| Reading archDecisions in PM history | `buildPmHistoryContext()` in `agent-context.ts` | Remove `r.archDecisions` lines |

**Keep**: `iterationContext` itself (still needed for PM history: `userPrompt`, `intent`, `pmSummary`, `timestamp`).

**Migration**: Existing `iterationContext` data in the database may contain `archDecisions` fields. Since `IterationRound` no longer references it, these fields are harmlessly ignored by TypeScript (JSON parse won't break). No DB migration needed.

---

## Affected Files

| File | Change |
|------|--------|
| `lib/types.ts` | Remove `ArchDecisions`; remove `archDecisions` from `IterationRound`; add `removeFiles` to `ScaffoldData` |
| `lib/agent-context.ts` | Add `deriveArchFromFiles()`; delete `buildArchIterationContext()`; update `buildPmHistoryContext()` |
| `lib/extract-arch-decisions.ts` | Delete entire file |
| `lib/generate-prompts.ts` | Update Architect system prompt with incremental constraint; document `removeFiles` |
| `lib/validate-scaffold.ts` | Pass through and validate `removeFiles` |
| `components/workspace/chat-area.tsx` | Update `resolveArchContext()` to use `deriveArchFromFiles()`; add merge + removeFiles logic before `onFilesGenerated()`; remove `archDecisions` from round persistence |
| `__tests__/extract-arch-decisions.test.ts` | Delete or repurpose |
| `__tests__/agent-context.test.ts` | Add tests for `deriveArchFromFiles()`; remove `buildArchIterationContext` tests |

---

## Known Limitations

1. **Regex parsing edge cases**: `deriveArchFromFiles` uses regex to extract import/export statements. Dynamic imports (`await import()`), re-exports (`export * from`), and aliased exports (`export { x as y }`) may be missed. This is acceptable because Sandpack-generated React apps use standard import/export patterns exclusively.

2. **Merge can't detect orphaned logic**: If Engineer rewrites `App.js` and removes an import to `SearchBar.js`, the merge preserves `SearchBar.js` (not deleted since it's not in `removeFiles`). The file becomes orphaned but doesn't break anything. Architect should list it in `removeFiles`, but if it forgets, the file just wastes space.

3. **Architect compliance**: The incremental constraint is a prompt instruction, not a hard enforcement. A model could still ignore it and design from scratch. The merge fallback mitigates this — existing files are preserved even if Architect over-designs.

---

## Test Plan

- [ ] `deriveArchFromFiles` correctly extracts file list, exports, imports, state strategy, persistence from sample files
- [ ] `deriveArchFromFiles` returns empty/minimal output for empty file set
- [ ] `resolveArchContext` uses `deriveArchFromFiles` instead of `buildArchIterationContext`
- [ ] Full pipeline merge: existing files not in scaffold are preserved in final output
- [ ] `removeFiles`: listed files are deleted from final output
- [ ] `removeFiles` validation: entries also in `files` array trigger warning
- [ ] `IterationRound` no longer contains `archDecisions` field
- [ ] Existing `iterationContext` with `archDecisions` in DB loads without error (backward compat)
- [ ] E2E: `feature_add` after multiple `bug_fix` rounds preserves existing app structure
