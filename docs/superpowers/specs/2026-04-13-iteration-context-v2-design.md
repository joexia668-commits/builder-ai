# Iteration Context V2: Cross-Round Memory

**Date:** 2026-04-13
**Status:** Approved
**Builds on:** `2026-04-10-iterative-context-memory-design.md` (Phase 1, shipped)

## Problem

Phase 1 solved single-round context (V1 code injection, intent routing). But across rounds, key information is still lost:

| Agent | What it knows (round N) | What it loses |
|-------|------------------------|---------------|
| PM | `lastPmOutput` from round N-1 (React state, lost on refresh) | User prompts from earlier rounds, what Arch/Eng decided |
| Architect | Only current PM output | Its own previous file structure, design decisions, component hierarchy |
| Engineer | Current code (`currentFiles`) | Why code was structured this way, prior user requests |

**Root cause:** `lastPmOutput` is a `useState(null)` in `workspace.tsx:53` — not persisted to DB. Architect output is a local variable in `chat-area.tsx` — discarded after each pipeline run.

**User-facing impact:** On consecutive `feature_add` iterations, Architect may redesign the entire file structure instead of incrementally adding files. PM may produce a PRD that conflicts with existing architecture decisions.

---

## Design Goals

1. PM sees the full iteration history (last 5 rounds of user prompts + PM decisions)
2. Architect sees its own previous decisions (file structure, state strategy, key design choices)
3. Context survives page refresh (DB-persisted, not React state)
4. Zero additional LLM calls — all extraction is deterministic code
5. Token cost bounded: ~2000 tokens max injection regardless of round count

---

## Data Model

### New types (`lib/types.ts`)

```typescript
interface ArchDecisions {
  readonly fileCount: number;
  readonly componentTree: string;          // "App -> [Sidebar, MainView -> [TaskList, TaskForm]]"
  readonly stateStrategy: string;          // "useState" | "useReducer" | "context" | "unknown"
  readonly persistenceSetup: string;       // "none" | "localStorage" | "supabase"
  readonly keyDecisions: readonly string[];
}

interface IterationRound {
  readonly userPrompt: string;
  readonly intent: Intent;
  readonly pmSummary: PmOutput | null;          // null for bug_fix/style_change
  readonly archDecisions: ArchDecisions | null; // null for bug_fix/style_change
  readonly timestamp: string;                   // ISO 8601
}

interface IterationContext {
  readonly rounds: readonly IterationRound[];
}
```

### Schema change (`prisma/schema.prisma`)

```prisma
model Project {
  // ... existing fields
  iterationContext Json?    // IterationContext, nullable
}
```

One-field addition. No migration needed (`npx prisma db push`).

### Retention policy

FIFO, max 5 rounds. On round 6, round 1 is discarded. Rationale:
- 5 rounds x ~400 tokens = ~2000 tokens injection — well within budget
- Decisions older than 5 rounds are already reflected in `currentFiles`
- No compression or LLM summarization needed

---

## Extraction: ArchDecisions from ScaffoldData

**New file:** `lib/extract-arch-decisions.ts`

All extraction is deterministic — no LLM calls.

```typescript
function extractArchDecisions(scaffold: ScaffoldData): ArchDecisions
```

| Field | Source | Logic |
|-------|--------|-------|
| `fileCount` | `scaffold.files.length` | Direct |
| `componentTree` | `scaffold.files[].deps` | Find root nodes (files not imported by others), recursively build tree string from deps graph |
| `stateStrategy` | `scaffold.designNotes` | Keyword match: "useReducer" > "context" > "useState" > "unknown" |
| `persistenceSetup` | `scaffold.files[].deps` + `designNotes` | Check if any file deps on `/supabaseClient.js`; else check for localStorage keywords; else "none" |
| `keyDecisions` | `scaffold.designNotes` | Split by sentence/newline, take first 5 non-empty items |

**Why not change Architect's prompt to output ArchDecisions directly?**
Changing the system prompt risks destabilizing scaffold generation quality. Post-processing from existing structured output is zero-risk.

---

## Write Path

**When:** After full pipeline completes successfully (version saved to DB).

**Where:** `chat-area.tsx`, after `POST /api/versions` succeeds.

**Flow:**

```
Pipeline complete → version saved
  ↓
Construct IterationRound:
  - userPrompt: prompt
  - intent: intent
  - pmSummary: parsedPm (already extracted)
  - archDecisions: extractArchDecisions(scaffold) — new call
  - timestamp: new Date().toISOString()
  ↓
Append to existing rounds (FIFO, max 5)
  ↓
PATCH /api/projects/[id] { iterationContext: updated }
  ↓
Update local state: setIterationContext(updated)
```

**Direct path (bug_fix / style_change):** Also writes a round, but with `pmSummary: null` and `archDecisions: null`. This preserves the user's micro-adjustment history for PM context.

**Failure handling:** If PATCH fails, silently ignore. Iteration context is a quality enhancement, not a correctness requirement. `currentFiles` (via version system) remains the authoritative state.

---

## Read Path: What Each Agent Receives

### PM — History-aware PRD

**New function:** `buildPmHistoryContext(rounds: IterationRound[]): string`

**Location:** `lib/agent-context.ts`

**Output format:**

```
当前应用的迭代历史（请在此基础上分析增量需求，不要重新设计已有功能）：

[第1轮] 用户："做一个待办事项应用"
  意图：待办事项管理 / 功能：添加、删除、标记完成 / 持久化：localStorage

[第2轮] 用户："加暗黑模式"
  意图：增加主题切换 / 功能：暗黑模式、主题持久化

[第3轮] 用户："把字体改大一点" (样式调整，跳过PM)
```

**Replaces:** `buildPmIterationContext(lastPmOutput)` — which only showed the previous round's PM summary.

**Token estimate:** ~100 tokens per round, max 5 rounds = ~500 tokens.

### Architect — Structure-aware scaffold

**New function:** `buildArchIterationContext(archDecisions: ArchDecisions): string`

**Location:** `lib/agent-context.ts`

**Output format:**

```
上次架构方案（请在此基础上增量修改，保留已有文件结构）：
文件数：12
组件结构：App -> [ThemeProvider, Sidebar, MainView -> [TodoList -> TodoItem, TodoForm]]
状态管理：useReducer
持久化：localStorage with useEffect
关键决策：Tab切换视图 / 表单用modal / 使用lucide图标
```

**Source:** Most recent round with non-null `archDecisions`.

**Token estimate:** ~80 tokens, fixed overhead.

### Engineer — No change

Engineer already receives `currentFiles` (full code) and current-round scaffold. Historical context would be redundant.

---

## Migration from Phase 1

`lastPmOutput` state in `workspace.tsx` becomes redundant:

| Before (Phase 1) | After (V2) |
|-------------------|------------|
| `useState<PmOutput \| null>(null)` | Read from `project.iterationContext.rounds[-1].pmSummary` |
| Lost on page refresh | Persisted in DB |
| Only previous round | Last 5 rounds |
| `buildPmIterationContext(lastPmOutput)` | `buildPmHistoryContext(rounds)` |

**Backward compatibility:** If `project.iterationContext` is null (old projects), fall back to empty rounds. PM and Arch behave exactly as before — no context injected.

---

## File Change Summary

| File | Change | Lines |
|------|--------|-------|
| `prisma/schema.prisma` | Add `iterationContext Json?` to Project | ~1 |
| `lib/types.ts` | Add `ArchDecisions`, `IterationRound`, `IterationContext` | ~25 |
| `lib/extract-arch-decisions.ts` | **New file**: deterministic extraction from ScaffoldData | ~80 |
| `lib/agent-context.ts` | Add `buildPmHistoryContext()`, `buildArchIterationContext()`; delete `buildPmIterationContext()` (no callers remain after migration) | ~40 |
| `components/workspace/chat-area.tsx` | Write round after pipeline; read rounds for PM/Arch context | ~30 |
| `components/workspace/workspace.tsx` | Initialize iterationContext from project data; remove `lastPmOutput` state | ~10 |
| `app/api/projects/[id]/route.ts` | PATCH supports `iterationContext` field | ~5 |

**Total: ~190 lines changed/added**

---

## What Is Not Changing

- Version system (INSERT-only immutable snapshots) — unchanged
- Multi-file layered generation (topological sort) — unchanged
- SSE streaming protocol — unchanged
- Intent classification logic — unchanged
- Engineer prompt and context — unchanged
- Direct path (bug_fix / style_change) pipeline — unchanged (only writes round record)
- Authentication, model selection, abort logic — unchanged

---

## Token Budget

| Injection | Recipient | Tokens | When |
|-----------|-----------|--------|------|
| PM history (5 rounds) | PM | ~500 | feature_add only |
| Arch decisions (1 round) | Architect | ~80 | feature_add only |
| **Total new overhead** | | **~580** | **Per feature_add iteration** |

Current per-call input: ~7000 tokens. New overhead: +8%. No risk of hitting context limits.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `extractArchDecisions` produces inaccurate componentTree | LOW | Tree is advisory context, not binding. Arch can override. |
| PATCH to save iterationContext fails | LOW | Silent failure. Generation quality degrades gracefully to Phase 1 behavior. |
| designNotes format varies → stateStrategy extraction misses | LOW | Falls back to "unknown". Arch prompt already handles full design. |
| Old projects have null iterationContext | NONE | Graceful fallback: empty rounds = no injection = same as today. |
