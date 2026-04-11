# Engineer Live Progress — Design Spec

**Date:** 2026-04-11
**Status:** Approved for implementation planning — unblocked.
**Builds on:** [`2026-04-11-engineer-hydration-stall-design.md`](./2026-04-11-engineer-hydration-stall-design.md) — specifically its Section 2 (`lib/generation-session.ts` module-level singleton), which **has now landed on main** (commits `8f53cad`, `86d429d`, `3400871`, `abe7f3d`). All preconditions for this spec are met; no gating remains.

**Live-state facts at spec time:**
- `lib/generation-session.ts` exports `GenerationSession`, `getSession`, `updateSession(projectId, patch)`, `subscribe`, `abortSession`, `resetSession`, `EMPTY_SESSION`. `AbortController` is stored in the session; `lastPrompt` is a session field.
- `hooks/use-generation-session.ts` exports `useGenerationSession(projectId)` built on `useSyncExternalStore`.
- `components/workspace/chat-area.tsx` no longer holds generation state in `useState`; it reads via the hook and writes via `updateSession` throughout `handleSubmit`.
- `lib/api-client.ts` exports `readSSEBody<T>(body, onEvent, { tag, onStall, stallMs })` — a shared SSE reader that handles chunk buffering, JSON parsing, structured `[sse:xxxx]` logging, and 30s stall detection. `ChatArea` already uses it in the direct path, the per-agent PM/Architect loops, and the multi-file engineer layer loop.
- A 30s-silence stall warning banner already renders in the chat-area message stream (amber, with "继续等待" / "中断重试" buttons). This is orthogonal to the "未完成草稿" banner proposed in Section 5.1 — different trigger, different location, different message. They coexist without changes.

## Problem

During engineer generation, the preview panel shows a blurred "generating…" overlay and the code tab shows nothing until the entire run finishes. Users perceive this as a frozen screen. The symptom is worst on the **direct path** (`bug_fix` / `style_change`), which is a single 30–90s SSE request with no intermediate file-level events — after initial scaffolding, this path accounts for most follow-up iterations, so fixing it has the highest ROI.

On the **multi-file pipeline** (`new_project` / `feature_add`), the `engineerProgress` state already tracks layers and files, but only the top `AgentStatusBar` shows it. The code tab remains blank until every layer has completed.

We need the code tab to visibly reflect what the engineer is writing, in real time, so users can see progress and intervene if the AI goes off track.

## Goals

1. During engineer generation, the code tab visibly updates as files are produced.
2. **Direct path:** Monaco editor updates character-by-character, per file, as chunks arrive.
3. **Multi-file pipeline:** completed files appear in the file tree layer-by-layer; the current layer's files are marked as "writing".
4. Tab auto-switches to the Code tab when generation starts, so the live feedback is not hidden behind the preview tab.
5. Partial drafts survive abort/error — the user can inspect what was already generated, retry, or explicitly clear.
6. Generation state (including the live draft) survives component remounts, inheriting the guarantees of the hydration-stall Section 2 singleton.

## Non-Goals

- **Character-level streaming for the multi-file pipeline.** Would require new server-side SSE events (`file_chunk`) and a streaming server-side parser. Out of scope — YAGNI. Layer-level granularity is sufficient given the existing `AgentStatusBar` progress.
- **PM / Architect streaming UI changes.** Both already stream into chat bubbles; no change requested.
- **Persisting partial drafts as versions.** Versions stay atomic — only successful completions write to `/api/versions`.
- **Monaco diff view** of new vs previous version. Separate feature.
- **Semantic changes to `extractMultiFileCode`.** Section 2 is a pure refactor: the function becomes a thin wrapper over a new pure core module, with bit-identical behavior verified by regression fixtures.
- **Backend heartbeat** or file-chunk protocol in `/api/generate`. Zero route changes.
- **Editable Monaco during generation.** `FileTreeCodeViewer` keeps `readOnly: true` whether `displayFiles` is sourced from `liveFiles` or `currentFiles`. Users cannot type into the live draft — it's a read-only view of what the AI is producing. Editing remains a post-completion action.
- **Mobile-specific tab-switch logic.** The mobile tab bar in `Workspace` (`mobileTab: "chat" | "preview"`) has its own state and is not affected by this spec. On mobile, users stay in the chat tab during generation and can swipe to the preview tab manually; the desktop-only "auto-switch to Code" behavior does not apply to the mobile tab bar.
- **Cross-project `liveFiles` visibility.** `liveFiles` and `liveGeneration` are per-`projectId` fields on the `GenerationSession` singleton, which already keys state by project. Navigating to another project naturally shows that project's own live state (or idle defaults if no generation is active there). This is a natural property of the existing singleton — not a feature we're adding, but calling it out so readers don't worry about a global `liveFiles` leaking across projects.

## Design

Five coordinated pieces. All prerequisites have landed on main; none of the sections are gated. Section 1 extends the existing singleton with two fields + a helper; Sections 2–3 add pure modules; Section 4 wires the integration into the existing `chat-area.tsx`; Section 5 covers UI changes to `PreviewPanel` and `FileTreeCodeViewer`.

### 1. State container — extend the GenerationSession singleton

`lib/generation-session.ts` exists and its current shape is:

```ts
export interface GenerationSession {
  projectId: string;
  abortController: AbortController;
  agentStates: Record<AgentRole, AgentState>;
  engineerProgress: EngineerProgress | null;
  isGenerating: boolean;
  generationError: { code: ErrorCode; raw: string } | null;
  transitionText: string | null;
  lastPrompt: string;
  lastEventAt: number | null;
  stallWarning: boolean;
}
```

**Add two new fields** (keeping existing ones intact):

```ts
export interface GenerationSession {
  // ... all existing fields ...
  liveFiles: Record<string, string> | null;
  liveGeneration: LiveGenerationState;
}

export interface LiveGenerationState {
  phase: "idle" | "running" | "aborted" | "error";
  writingPaths: ReadonlySet<string>;    // files currently being written
  completedPaths: ReadonlySet<string>;  // files already fully written this run
  errorMessage: string | null;
}
```

**Why this container, not a new hook or React state:**

- Remount-safe by construction. The hydration-stall refactor exists specifically because `Workspace` and `ChatArea` can remount mid-generation and lose their `useState` contents. Any feature that needs to survive remount must live in the same singleton.
- Two independent readers (`PreviewPanel` for the Code tab, `FileTreeCodeViewer` for the file tree) can both subscribe via the existing `useGenerationSession(projectId)` hook without prop drilling through `Workspace`.
- Zero new plumbing: writes go through the existing `updateSession(projectId, patch)` helper. No parallel store, no context provider.

**Defaults in `makeEmptySession()`** (also propagated to `EMPTY_SESSION`, the SSR snapshot):

```ts
liveFiles: null,
liveGeneration: {
  phase: "idle",
  writingPaths: new Set(),
  completedPaths: new Set(),
  errorMessage: null,
}
```

**Colocated helper** in the same `lib/generation-session.ts` module:

```ts
export type LiveGenPatch =
  | { start: true }
  | { mergeFiles: Record<string, string>; writingPaths?: ReadonlySet<string> }
  | { overwriteFiles: Record<string, string> }
  | { markCompleted: readonly string[]; writingPaths?: ReadonlySet<string> }
  | { writingPaths: ReadonlySet<string> }
  | { finish: true }
  | { abort: true }
  | { fail: string }
  | { reset: true };

/** Computes the { liveFiles, liveGeneration } partial patch for a given op.
 *  Returns null if the op is illegal for the current phase (caller skips). */
export function computeLiveGenerationPatch(
  current: GenerationSession,
  patch: LiveGenPatch
): Pick<GenerationSession, "liveFiles" | "liveGeneration"> | null;

/** Convenience wrapper: computes the patch, dispatches via updateSession. */
export function updateLiveGeneration(
  projectId: string,
  patch: LiveGenPatch
): void;
```

**Why two entry points:** `ChatArea.handleSubmit` already batches many fields into single `updateSession` calls at key moments (e.g., `handleSubmit` entry at line 188, the `finally` block at line 649). At those sites, the caller should use `computeLiveGenerationPatch(current, { start: true })` and spread the result into the existing `updateSession` call — one re-render, not two. At standalone sites (e.g., inside a `readSSEBody` onEvent callback firing per chunk), use `updateLiveGeneration(projectId, { mergeFiles, writingPaths })` directly. Both paths enforce the same state-machine validation.

**State machine** (enforced inside `computeLiveGenerationPatch`; any illegal transition returns `null` and `console.warn`s in dev):

```
idle     -- start()  --> running
running  -- finish() --> idle     (liveFiles cleared)
running  -- abort()  --> aborted  (liveFiles preserved)
running  -- fail()   --> error    (liveFiles preserved)
aborted  -- reset()  --> idle
error    -- reset()  --> idle
aborted  -- start()  --> running  (retry)
error    -- start()  --> running  (retry)
```

**`finish` is strict.** It only accepts `running → idle`. Calling `finish` while the phase is already `aborted` or `error` is treated as a real bug (not a no-op) — it returns `null` and logs a dev warning. This enforces the invariant that `finish` means **"happy-path completion"** and must never be called from `finally` unconditionally. Error paths go through `fail`, abort paths through `abort`; neither ever passes through `finish`. See Section 4 for the consequence: `finish` is dispatched at the **end of the `try` block** on happy-path exits, not in `finally`.

Any `mergeFiles` / `setWritingPaths` / `markCompleted` / `overwrite` call while `phase !== "running"` is silently dropped (with a dev warning). This guards against late SSE events arriving after abort.

### 2. Shared multi-file parser core — pure refactor

Extract the line-based FILE-separator parsing logic from `lib/extract-code.ts` into a new pure module `lib/multi-file-parser-core.ts`:

```ts
export function parseFileLines(
  lines: readonly string[],
  initialPath: string | null = null,
): {
  files: Record<string, string[]>;
  lastPath: string | null;
};
```

Rules (unchanged from the current `extractMultiFileCode` body):

1. Match `/^\/\/ === FILE: (.+?) ===/` → switch `currentPath`, initialize empty array.
2. Lines before the first FILE header are silently discarded (matching current behavior).
3. All other lines append to `files[currentPath]`.
4. No END marker — the previous file's content ends when the next FILE header arrives or input ends.
5. No code-fence handling (fences, if any, are appended to the current file as-is — same as today; prompt already forbids them).

Refactor `extractMultiFileCode` and `extractAnyMultiFileCode` to be thin wrappers:

```ts
export function extractMultiFileCode(
  raw: string,
  expectedFiles: readonly string[],
): Record<string, string> | null {
  if (expectedFiles.length === 0) return {};
  const { files: rawFiles } = parseFileLines(raw.split("\n"));

  const result: Record<string, string> = {};
  for (const path of expectedFiles) {
    const codeLines = rawFiles[path];
    if (!codeLines) return null;
    const code = codeLines.join("\n").trim();
    if (!isBracesBalanced(code)) return null;
    result[path] = code;
  }
  return result;
}
```

**Zero behavior change** verified by a regression fixture: feed the existing test inputs for `extractMultiFileCode` and `extractAnyMultiFileCode` through the new wrappers and assert bit-identical output.

### 3. Streaming file parser (direct path)

New module `lib/streaming-file-parser.ts`:

```ts
export interface StreamingFileParserState {
  readonly writingPath: string | null;
  readonly files: Readonly<Record<string, string>>;
}

export interface StreamingFileParser {
  feed(chunk: string): StreamingFileParserState;
  finalize(): StreamingFileParserState;
  reset(): void;
}

export function createStreamingFileParser(): StreamingFileParser;
```

Implementation:

- Maintains internal `buffer: string` for the incomplete trailing line.
- `feed(chunk)`: concatenates `buffer + chunk`, splits on `\n`. The last segment (possibly empty, possibly partial) becomes the new `buffer`. All complete lines pass through `parseFileLines` (from Section 2), and the result merges into the internal `files` state. Returns the new snapshot.
- `finalize()`: flushes the buffer as one last line and returns the final snapshot.
- `reset()`: clears everything.

**Correctness by construction:** because both `extractMultiFileCode` and the streaming parser share `parseFileLines`, any future prompt-format change (new marker, END separator, multi-line headers) propagates to both with a single edit. No server/client divergence is possible.

**Integration point in `ChatArea`** — no changes to `readSSEBody` or `fetchSSE` are required. The streaming parser is instantiated inside `handleSubmit` and fed from the existing `onEvent` callback passed to `readSSEBody`:

```ts
// Inside the direct path branch of handleSubmit (chat-area.tsx ~line 262)
const parser = createStreamingFileParser();

await readSSEBody<{ type: string; content?: string; files?: Record<string, string>; ... }>(
  directResponse.body,
  (event) => {
    if (event.type === "chunk") {
      directOutput += event.content ?? "";
      updateAgentState("engineer", { output: directOutput });

      // NEW: feed parser, dispatch live-generation patch
      const parsed = parser.feed(event.content ?? "");
      updateLiveGeneration(project.id, {
        mergeFiles: parsed.files,
        writingPaths: parsed.writingPath ? new Set([parsed.writingPath]) : new Set(),
      });
    } else if (event.type === "files_complete" && event.files) {
      directFiles = event.files;
      updateLiveGeneration(project.id, { overwriteFiles: event.files }); // NEW
    }
    // ... existing branches unchanged
  },
  { tag: `direct:${intent}`, onStall: () => updateSession(project.id, { stallWarning: true }) }
);
```

The parser lives in the closure of the direct path branch, gets created fresh per `handleSubmit` call, and is garbage-collected when `handleSubmit` returns.

**Safety net:** the server's final `files_complete` event triggers `updateLiveGeneration(projectId, { overwriteFiles: event.files })`. This is a no-op in steady state (both sides share `parseFileLines`), but protects against future server-side post-processing divergence.

### 4. ChatArea integration

Unblocked. `components/workspace/chat-area.tsx` already uses `updateSession` throughout `handleSubmit`; the new live-generation calls either piggyback on existing `updateSession` batches (via `computeLiveGenerationPatch`) or dispatch standalone via `updateLiveGeneration`. No new state in the component — all writes flow through the singleton.

Table entries reference current line numbers in `chat-area.tsx` (post-hydration-stall merge). "Fold into" means spread `computeLiveGenerationPatch(getSession(project.id), { ... })` into the existing `updateSession({ ... })` object at that site. "Dispatch" means call `updateLiveGeneration(project.id, { ... })` as a standalone line.

| Site (chat-area.tsx line) | How | Change |
|---|---|---|
| **L188–199** — `handleSubmit` entry `updateSession({ generationError: null, lastPrompt, isGenerating: true, stallWarning: false, abortController, agentStates: {...} })` | Fold into existing call | Spread `...computeLiveGenerationPatch(getSession(project.id), { start: true })` into the object. Transitions `idle`/`aborted`/`error` → `running`, seeds `liveFiles: {}`, resets writing/completed sets and `errorMessage`. |
| **L269–293** — direct path `readSSEBody` onEvent, `type === "chunk"` branch | Dispatch | Branch on `isMultiFileV1` (already in scope at L229). **Multi-file V1**: instantiate `const parser = createStreamingFileParser()` once, outside `readSSEBody` but inside the direct path branch. Inside the chunk handler, call `const parsed = parser.feed(event.content ?? ""); updateLiveGeneration(project.id, { mergeFiles: parsed.files, writingPaths: parsed.writingPath ? new Set([parsed.writingPath]) : new Set() })`. **Single-file V1**: no streaming parser (no FILE separators in the output). Instead dispatch `updateLiveGeneration(project.id, { mergeFiles: { "/App.js": directOutput }, writingPaths: new Set(["/App.js"]) })` — piggybacking on the existing `directOutput` accumulator in the same branch. |
| **L277–278** — direct path onEvent, `type === "files_complete"` branch | Dispatch | Add `updateLiveGeneration(project.id, { overwriteFiles: event.files })` right after `directFiles = event.files`. Only fires on the multi-file V1 path. |
| **After L324 / L335** — direct path happy-path completion, just after `onFilesGenerated(...)` and before the `return` at L340 | Dispatch | `updateLiveGeneration(project.id, { finish: true })`. This is the **only** site that transitions the direct path from `running` → `idle`. Placed after `onFilesGenerated` so `currentFiles` has already been seeded with the new version — the `liveFiles → null` transition causes zero UI flash because `displayFiles = liveFiles ?? currentFiles` now points at identical content. |
| **L357–366** — multi-file `engineerProgress` init `updateSession({ engineerProgress: { totalLayers, ... } })` | Fold into existing call | Spread `...computeLiveGenerationPatch(getSession(project.id), { writingPaths: new Set() })` to ensure `liveGeneration.writingPaths` is empty before the first layer runs. (The `start: true` from `handleSubmit` entry already set `liveFiles: {}`, so this is just a layer-init reset.) |
| **L374–385** — before each layer SSE call, `updateSession({ engineerProgress: { ...prev, currentLayer, currentFiles } })` | Fold into existing call | Spread `...computeLiveGenerationPatch(current, { writingPaths: new Set(layerPaths) })`. Now the file tree highlights the layer's paths in sync with `AgentStatusBar`. |
| **L435–446** — after `layerResult` received, `updateSession({ engineerProgress: { ...prev, completedFiles, failedFiles } })` | Fold into existing call | Spread `...computeLiveGenerationPatch(current, { mergeFiles: layerResult.files, markCompleted: Object.keys(layerResult.files), writingPaths: <current writingPaths minus layerPaths> })`. **This is the key multi-file visibility point** — completed files land in `liveFiles` and users see them appear in the file tree as each layer finishes. |
| **Between L626 and L628** — main pipeline happy-path completion, after the `if (parsedPm) { onPmOutputGenerated?.(parsedPm); }` block and before the `catch` | Dispatch | `updateLiveGeneration(project.id, { finish: true })`. This is the **only** site that transitions the multi-file pipeline and the legacy single-file fallback from `running` → `idle`. Same zero-flash reasoning as the direct path row. |
| **L631–638** — catch block, non-abort branch, `updateSession({ generationError: { code, raw } })` | Fold into existing call | Spread `...computeLiveGenerationPatch(current, { fail: message })`. `running` → `error`, **liveFiles preserved**. |
| **L640–648** — catch block, `isAbort === true` branch, `updateSession({ agentStates: {...} })` | Fold into existing call | Spread `...computeLiveGenerationPatch(current, { abort: true })`. `running` → `aborted`, **liveFiles preserved**. |
| **L649–656** — `finally` block `updateSession({ isGenerating: false, transitionText: null, engineerProgress: null, stallWarning: false })` | **Leave unchanged** | Per Option C (see Section 1 state-machine note): `finally` does not touch `liveFiles` or `liveGeneration`. Those are driven exclusively by the `try` end (`finish`), the `catch` branches (`abort` / `fail`), and explicit user actions (`reset` via the banner's `[清空]` button). `finally` only owns UI transient cleanup — the four existing fields stay, no new fields added. This keeps the live-generation state machine and the transient-UI cleanup orthogonal. |

The `computeLiveGenerationPatch` helper is pure: it reads the current session's phase and computes the next `{ liveFiles, liveGeneration }` patch. Illegal transitions return `null`, which the caller handles by skipping the spread (or the `updateLiveGeneration` wrapper skips the dispatch). In dev, illegal transitions `console.warn` with the current phase and attempted op.

**Granularity note — multi-file path:** `writingPaths` is the whole current layer (typically 2–3 files), not a single file, because the server doesn't stream per-file within a layer. The file tree will highlight 2–3 rows simultaneously during each layer, which is acceptable — the fine-grained case is handled by the direct path, and users already see layer-level progress in `AgentStatusBar`.

**Workspace wiring.** `Workspace` calls `useGenerationSession(projectId)` and reads `liveFiles` + `liveGeneration`. It computes `displayFiles = liveFiles ?? currentFiles` and passes both `displayFiles` and `liveGeneration` as props to `PreviewPanel`. This keeps the prop-drilling pattern consistent with today's code (where `Workspace` already composes `displayFiles` for version-preview fallback) and lets the UI components accept the new data as pure props, testable with static fixtures without any store knowledge.

### 5. UI changes

#### 5.1 `PreviewPanel`

- New optional prop: `liveGeneration?: LiveGenerationState`. The existing `files` prop now receives `displayFiles` from `Workspace` (which is `liveFiles ?? currentFiles`) — zero change to the prop name or shape, the upstream just points at a different source during generation.
- `useEffect` on `liveGeneration?.phase`: when it transitions to `"running"`, call `setTab("code")`. Does **not** auto-switch back on transition to `"idle"` — the user may want to inspect the finished code.
- **Error/abort banner.** When `liveGeneration?.phase === "aborted" || "error"`, render a banner at the top of the Code tab content area:

  ```
  ⚠ 这是一份未完成的草稿 · [重试] [清空]      (aborted)
  ✗ 生成中途出错：{errorMessage} · [重试] [清空]  (error)
  ```

  - `[重试]` calls the existing retry mechanism (`handleSubmit(lastPrompt)`, where `lastPrompt` is read from the session).
  - `[清空]` calls `updateLiveGeneration(projectId, { reset: true })` which transitions `aborted`/`error` → `idle` and clears `liveFiles` to `null`. The Code tab immediately falls back to `currentFiles` (because `Workspace` recomputes `displayFiles = liveFiles ?? currentFiles`). Dispatched via a callback prop (`onClearDraft`) so `PreviewPanel` stays decoupled from the session hook in step 3.

- **Preview-tab overlay** (`preview-panel.tsx:192–200` today): keep the overlay, but change its text to "代码生成中 — 切到代码 Tab 看实时进度 →" with a button that calls `setTab("code")`. This gives users who manually switched back to preview a visible exit to the live feedback.

- **Coexistence with the existing stall warning.** `chat-area.tsx:741–771` already renders a 30s-silence stall warning banner inside the message stream (amber, "继续等待" / "中断重试"). That banner is triggered by `session.stallWarning`, which `readSSEBody`'s onStall callback sets when no SSE events arrive for 30s. The "未完成草稿" banner in this section is triggered by `liveGeneration.phase ∈ {"aborted", "error"}`, lives in the PreviewPanel's Code tab, and has different actions. The two banners fire in different conditions (silence-during-running vs aborted-or-errored) and render in different panels — no conflict, no duplication, no deduplication logic needed.

#### 5.2 `FileTreeCodeViewer`

New optional prop:

```ts
interface FileTreeCodeViewerProps {
  files: Record<string, string>;
  liveGeneration?: LiveGenerationState;
}
```

File-row visual states:

| State | Judgement | Style |
|---|---|---|
| `completed` | `liveGeneration?.completedPaths.has(path)` or `phase === "idle"` | Normal (unchanged from today) |
| `writing` | `liveGeneration?.writingPaths.has(path)` | `data-state="writing"`, row has `bg-emerald-500/10`, `animate-pulse`, a leading `▸` indicator |
| `pending` | File exists in `files` but matches neither of the above | `text-gray-600`, hover tooltip "等待生成" |

**Monaco auto-follow.** When `writingPaths` changes and the user has not manually clicked a file since the current generation started:

- Set `activePath` to `[...writingPaths][0]` (or the first in source order if `writingPaths` is a Set derived from an ordered array — we keep the order deterministic by building Sets from arrays).
- Track "user manually clicked" with a ref `userOverrodeActiveRef`. Set it on every `onFileClick`. Reset to `false` whenever `liveGeneration.phase` transitions to `"running"` (new generation starts → auto-follow resumes).

**Monaco auto-scroll to latest line.** On mount, capture the editor instance via `onMount`. When the `value` of the currently-writing file grows, call `editor.revealLine(model.getLineCount())`. Pause auto-scroll if the user manually scrolls (detected via `editor.onDidScrollChange` with a "user-initiated" heuristic — the event's `scrollTopChanged` fires for both programmatic and user scrolls, so use a ref flag set just before programmatic calls). Resume auto-scroll when `activePath` changes.

## Testing Plan

### Unit tests (new)

| File | Covers |
|---|---|
| `__tests__/multi-file-parser-core.test.ts` | `parseFileLines`: multi-file input, leading garbage before first FILE header, empty file blocks, trailing line without newline, `initialPath` carryover. **Regression fixture**: all existing `extractMultiFileCode` / `extractAnyMultiFileCode` test inputs produce bit-identical output through the new wrappers. |
| `__tests__/streaming-file-parser.test.ts` | **Property test**: for each of 10 canonical inputs, feed via N random chunk splittings; final state must equal the one-shot `parseFileLines` result. Half-separator split (e.g., `// === FIL` then `E: /a.js ===\n`) recovers correctly. `finalize()` flushes trailing buffer. |
| `__tests__/live-generation-state.test.ts` | State machine: valid transitions succeed; illegal transitions (e.g., `mergeFiles` while `idle`, `start` while already `running`) are ignored with `console.warn`. `reset()` from any phase returns to `idle` and clears `liveFiles`. |

### Component tests (new)

| File | Covers |
|---|---|
| `__tests__/file-tree-code-viewer-live.test.tsx` | File rows render `data-state="writing"` / `"completed"` / `"pending"` correctly given a mock `liveGeneration`. Monaco `activePath` auto-follows when `writingPaths` changes. After `onFileClick`, auto-follow is disabled until next `phase === "running"`. |
| `__tests__/preview-panel-live.test.tsx` | Tab auto-switches to `"code"` when `liveGeneration.phase` becomes `"running"`. Banner renders on `"aborted"` and `"error"` with the correct text and buttons. `[清空]` button dispatches an `updateSession` patch that nulls `liveFiles`. |

### Integration tests (new)

| File | Covers |
|---|---|
| `__tests__/chat-area-live-files-direct.test.tsx` | Mock SSE chunk sequence for the direct multi-file path. Assert `session.liveFiles` accumulates file-by-file as chunks arrive. Assert the final `files_complete` overwrite matches the server's authoritative output. |
| `__tests__/chat-area-live-files-layers.test.tsx` | Mock the full PM → Architect → Engineer flow with 2 layers. Assert `completedPaths` grows layer by layer. Assert `writingPaths` matches the current layer set during each layer, and is empty after the last layer. |
| `__tests__/chat-area-live-files-abort.test.tsx` | Start a generation, abort mid-stream, assert `liveGeneration.phase === "aborted"` and `liveFiles` still contains the partial result. Assert the banner's `[清空]` dispatch nulls `liveFiles`. |

### E2E (new)

`e2e/engineer-live-progress.spec.ts`:

1. **New project multi-file path**: create a project, submit "做一个 todo 应用", assert the Code tab is active within 2s of submit, assert `[data-state="writing"]` rows appear in the file tree during generation, assert they all transition to `completed` state on finish.
2. **Direct path style change**: on an existing project, submit "把主色调改成紫色", assert Monaco editor shows non-empty content **before** the SSE stream finishes (polling Monaco's value text).
3. **Abort mid-generation**: submit a new-project prompt, wait until file tree shows at least one completed file, click the stop button, assert the "未完成草稿" banner appears, assert the Code tab still shows the partial files, click `[清空]`, assert the Code tab falls back to the previous state.

### Not tested (intentional)

- Monaco auto-reveal exact scroll position — fragile in E2E, low value.
- Visual regression on the preview-tab overlay text change.
- Multi-file character-level streaming — out of scope.

## Implementation Order

All prerequisites are in place. The work ships in a single linear progression. To keep the review surface manageable, it can be split into two PRs on the seam between "plumbing" (commits 1–4) and "consumer + integration" (commits 5–7), but there is no technical gate — one PR is also fine if the diff stays readable.

1. **Parser core refactor** (Section 2). Extract `parseFileLines` to `lib/multi-file-parser-core.ts`. Refactor `extractMultiFileCode` and `extractAnyMultiFileCode` into thin wrappers. Regression fixture: run the existing extract-code test suite against the refactored wrappers and assert bit-identical output. Zero runtime change.
2. **Streaming file parser** (Section 3). New module `lib/streaming-file-parser.ts` with unit tests + chunk-splitting property test. No consumer yet.
3. **GenerationSession extension + helper** (Section 1). Add `liveFiles` and `liveGeneration` fields to `GenerationSession`. Add `computeLiveGenerationPatch` and `updateLiveGeneration` to `lib/generation-session.ts`. Update `makeEmptySession` and `EMPTY_SESSION` to seed the defaults. Unit tests for the state machine (valid transitions succeed, illegal transitions return `null` with a dev warn).
4. **UI-only changes** to `FileTreeCodeViewer` and `PreviewPanel` (Section 5). Accept `liveGeneration` as an optional prop and an `onClearDraft` callback prop. Tests pass in static fixtures. No Workspace wiring yet — the props simply have no producers and the feature is invisible to users at this commit. **PR-1 boundary (optional split): commits 1–4.**
5. **Workspace wiring** (Section 5.1 + 4). `Workspace` calls `useGenerationSession(projectId)`, reads `liveFiles` + `liveGeneration`, computes `displayFiles = liveFiles ?? currentFiles`, and passes both to `PreviewPanel`. The `onClearDraft` prop dispatches `updateLiveGeneration(projectId, { reset: true })`. No behavior visible to users yet because no producer calls have been added.
6. **ChatArea integration** (Section 4). Inject the changes from the Section 4 table into `components/workspace/chat-area.tsx`. Use `computeLiveGenerationPatch` for fold-into sites and `updateLiveGeneration` for standalone dispatch sites. Add integration tests for the direct path and multi-file path.
7. **E2E test** for the end-to-end flow (Testing Plan § E2E). **PR-2 boundary: commits 5–7.**

## Open Questions

None. All decisions confirmed during brainstorming:

- Live state lives in the `GenerationSession` singleton (not `Workspace` state, not a separate hook), sharing the remount-safe container with the hydration-stall refactor.
- Abort/error preserves `liveFiles` behind a "未完成草稿" banner with `[重试]` and `[清空]` actions.
- Tab auto-switches to Code on generation start; does not switch back on finish.
- Multi-file path uses layer-level granularity for `writingPaths`; direct path uses character-level streaming via the shared parser core.
- Parser-core refactor is strictly behavior-preserving, verified by regression fixtures against the existing `extractMultiFileCode` test suite.
