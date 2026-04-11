# Engineer Live-Streaming Activity Panel — Design

**Date:** 2026-04-11
**Status:** Draft (pending user review)
**Scope:** New UX feature to give users real-time visibility into the engineer agent's per-file code generation, without touching generation quality.

## Problem

Today, while `/api/generate` is running the engineer agent, users only see a coarse "Layer N/M — X files done" progress indicator derived from `EngineerProgress`. Per-file code is generated (possibly with multiple parallel files and retries) but stays invisible until the final `files_complete` SSE event. This feels like a long, opaque stall — especially on feature_add and new_project flows where a generation can take 60-120 seconds.

## Non-Goals and Hard Constraint

**Code quality must remain strictly higher priority than UX.** This feature is implemented as a **purely observational bypass** on top of existing server-side token streams. It MUST NOT:

- Modify engineer prompts
- Modify parser paths (`extractMultiFileCode` / `extractMultiFileCodePartial`)
- Modify the engineer circuit breaker, retry, or per-file fallback logic
- Modify version persistence or the authoritative file set written to the DB

If any implementation step would risk the above, it is rejected.

Also out of scope:

- Persisting streaming history across sessions (Activity is ephemeral, lifecycle = one generation)
- Per-version streaming replay / "generation archaeology"
- Single-file direct path (`code_complete` / path 1 in CLAUDE.md) — the single-file bug fix flow is fast enough that streaming adds negligible value
- Real-time syntax highlighting during the stream (highlight runs only on file completion)

## Scope

Feature covers two generation paths that share the engineer multi-file branch:

1. **Direct multi-file** (`bug_fix` / `style_change` when targetFiles > 1)
2. **Full pipeline layered engineer** (`new_project` / `feature_add`)

Single-file direct path is explicitly skipped.

## Architecture Overview

The core idea is a **tap** on the engineer token stream inside `/api/generate`. As each delta arrives from the AI provider:

1. It is appended to `fullText` (authoritative path — unchanged).
2. It is also fed into a `StreamTap` that does incremental boundary detection against the engineer multi-file format (`=== FILE: /path ===\n...content...`) and emits best-effort SSE events describing per-file lifecycle.

When the provider stream finishes, `fullText` is parsed by `extractMultiFileCodePartial` exactly as before, and `files_complete` / `partial_files_complete` is emitted. The frontend uses this authoritative event to **overwrite** any streaming buffer content, so any boundary-detection mistake self-heals at completion time.

```
AI provider stream
   │
   ▼
server: fullText += delta  ─────►  extractMultiFileCodePartial(fullText)  (authoritative, unchanged)
   │
   └───►  tap.feed(delta)  ─────►  file_start / file_chunk / file_end  (best-effort, throttled)
```

### New SSE events

Additive, all optional. Old clients ignore unknown event types.

```typescript
type SSEEventType =
  | ...existing
  | "file_start"
  | "file_chunk"
  | "file_end";

interface SSEEvent {
  ...existing
  path?: string;    // file_start / file_chunk / file_end
  delta?: string;   // file_chunk
  attempt?: number; // file_start — carries retry counter
}
```

No `file_reset` event — retries are handled entirely client-side via the existing `onAttempt` callback (see section 3).

## Server-Side Implementation

### New file: `lib/engineer-stream-tap.ts`

Pure function module, ~80 lines, no React/Next dependencies, Edge runtime compatible.

```typescript
export interface StreamTapEvent {
  type: "file_start" | "file_chunk" | "file_end";
  path?: string;
  delta?: string;
}

export function createEngineerStreamTap(attempt: number) {
  let buffer = "";
  let currentPath: string | null = null;
  const FILE_HEADER_RE = /=== FILE: (\/[^\s=]+) ===\n?/;
  const SAFE_TAIL = 256;

  return {
    feed(delta: string): StreamTapEvent[] {
      buffer += delta;
      const events: StreamTapEvent[] = [];
      while (true) {
        const match = FILE_HEADER_RE.exec(buffer);
        if (!match) {
          if (currentPath && buffer.length > SAFE_TAIL) {
            events.push({
              type: "file_chunk",
              path: currentPath,
              delta: buffer.slice(0, buffer.length - SAFE_TAIL),
            });
            buffer = buffer.slice(-SAFE_TAIL);
          }
          break;
        }
        if (currentPath && match.index > 0) {
          events.push({
            type: "file_chunk",
            path: currentPath,
            delta: buffer.slice(0, match.index),
          });
        }
        if (currentPath) {
          events.push({ type: "file_end", path: currentPath });
        }
        currentPath = match[1];
        events.push({ type: "file_start", path: currentPath });
        buffer = buffer.slice(match.index + match[0].length);
      }
      return events;
    },

    finalize(): StreamTapEvent[] {
      const events: StreamTapEvent[] = [];
      if (currentPath && buffer.length > 0) {
        events.push({ type: "file_chunk", path: currentPath, delta: buffer });
      }
      if (currentPath) {
        events.push({ type: "file_end", path: currentPath });
      }
      buffer = "";
      currentPath = null;
      return events;
    },
  };
}
```

**Why SAFE_TAIL = 256:** prevents a `=== FILE: /path ===` header from being mis-emitted as content when a token boundary cuts it in half. A realistic maximum header is `=== FILE: ` (10) + path (≤ 200) + ` ===\n` (5) ≈ 215 chars. 256 provides comfortable headroom so that even the longest plausible header can sit unflushed in the buffer until the next delta completes it. The tradeoff — a fixed ≤256 char delay on the last chunk of each file — is invisible given the `FLUSH_INTERVAL_MS` cadence and the authoritative `files_complete` overwrite at completion time.

### `/api/generate/route.ts` changes (engineer multi-file branch only)

```typescript
const tap = createEngineerStreamTap(meta.attempt);
let fullText = "";
let lastFlush = Date.now();
let pendingEvents: StreamTapEvent[] = [];
const FLUSH_INTERVAL_MS = 80;

for await (const delta of stream) {
  fullText += delta;
  pendingEvents.push(...tap.feed(delta));

  if (Date.now() - lastFlush >= FLUSH_INTERVAL_MS) {
    flushCoalesced(controller, pendingEvents);
    pendingEvents = [];
    lastFlush = Date.now();
  }
}
flushCoalesced(controller, [...pendingEvents, ...tap.finalize()]);

// authoritative path unchanged
const parsed = extractMultiFileCodePartial(fullText, targetFiles);
controller.enqueue(sseEncode({
  type: parsed.failed.length > 0 ? "partial_files_complete" : "files_complete",
  files: parsed.ok,
  failed: parsed.failed,
  truncatedTail: parsed.truncatedTail,
}));
```

`flushCoalesced` merges consecutive `file_chunk` events for the same path into one, collapsing 100-200 token chunks into ~12 SSE events per second (see Performance section).

## Frontend Implementation

### New types in `lib/types.ts`

```typescript
export interface LiveFileStream {
  readonly path: string;
  readonly content: string;
  readonly status: "streaming" | "done" | "failed";
  readonly attempt: number;
  readonly failedAttempts: ReadonlyArray<{
    readonly content: string;
    readonly reason: string;
  }>;
}
```

### New component: `components/preview/activity-panel.tsx`

Terminal-style scrolling log rendered as a single styled `<pre>` per file segment. Target size ~180 lines.

Layout:

- Dark background (`bg-zinc-950`), monospace, small text
- Sticky header line showing current `EngineerProgress` (e.g. `Layer 2/3 · 4/7 done`)
- Per-file segments sorted by start time (natural order from the engineer circuit layer schedule)
- Each segment renders:
  - Collapsed `<details>` block listing historical failed attempts (expandable, grey text)
  - Current attempt as `── /path (retry N/3) ──\n<code>` in green while streaming, grey on completion, red on failure
  - Blinking cursor while `status === "streaming"`
- Auto-scroll to bottom unless user has manually scrolled up (tracked via scroll event listener)

### `components/preview/preview-panel.tsx` changes

Add a third tab `Activity` alongside `Preview` and `Code`. Tab switching rules:

- When `isGenerating` transitions false → true and the active agent is engineer: auto-switch to Activity
- When user manually switches tabs during generation: set `userOverride = true`, disable auto-switch
- 2500ms after generation completion: if `!userOverride`, auto-switch back to Preview
- On next generation start: `userOverride` is reset to false

### `components/workspace/chat-area.tsx` changes

New state:

```typescript
const [liveStreams, setLiveStreams] = useState<Record<string, LiveFileStream>>({});
```

New SSE event handling inside `readEngineerSSE`:

```typescript
case "file_start":
  scheduleStreamUpdate(prev => ({
    ...prev,
    [ev.path!]: {
      path: ev.path!,
      content: "",
      status: "streaming",
      attempt: prev[ev.path!]?.attempt ?? 1,
      failedAttempts: prev[ev.path!]?.failedAttempts ?? [],
    },
  }));
  break;

case "file_chunk":
  scheduleStreamUpdate(prev => {
    const cur = prev[ev.path!];
    if (!cur) return prev;
    const content = cur.content.length >= MAX_STREAM_CHARS
      ? cur.content
      : cur.content + ev.delta!;
    return { ...prev, [ev.path!]: { ...cur, content } };
  });
  break;

case "file_end":
  // No-op — wait for files_complete to know final status
  break;

case "files_complete":
case "partial_files_complete":
  scheduleStreamUpdate(prev => {
    const next = { ...prev };
    for (const [path, code] of Object.entries(ev.files ?? {})) {
      if (next[path]) {
        next[path] = { ...next[path], status: "done", content: code };
      }
    }
    for (const path of ev.failed ?? []) {
      if (next[path]) next[path] = { ...next[path], status: "failed" };
    }
    return next;
  });
  break;
```

**Critical invariant:** when `files_complete` / `partial_files_complete` arrives, the authoritative file content overwrites the streaming buffer. Any boundary-detection error is healed within the tab's next render.

### Retry handling via `onAttempt`

When the engineer circuit retries a layer or per-file fallback, `onAttempt` is called with `phase` and `failedSubset`. The callback archives the current streaming content into `failedAttempts` and resets the stream for the new attempt:

```typescript
onAttempt: (info: AttemptInfo) => {
  if (info.attempt > 1) {
    scheduleStreamUpdate(prev => {
      const next = { ...prev };
      for (const path of info.failedSubset) {
        const cur = next[path];
        if (!cur) continue;
        next[path] = {
          ...cur,
          failedAttempts: [
            ...cur.failedAttempts,
            { content: cur.content, reason: info.reason },
          ],
          content: "",
          attempt: info.attempt,
          status: "streaming",
        };
      }
      return next;
    });
  }
  // ...existing engineerProgress.retryInfo update remains
};
```

### Generation completion cleanup

```typescript
setTimeout(() => {
  setLiveStreams({});
  if (!userSwitchedTab) setActiveTab("preview");
}, 2500);
```

## Performance Strategy

Gemini Flash / DeepSeek emit 100-200 tok/s and 3-5 parallel files means worst-case ~1000 token events/sec. The design uses three layers of throttling:

1. **Server-side coalescing** — `FLUSH_INTERVAL_MS = 80ms` combines per-file deltas into ~12 SSE events/sec with 20-30 char deltas each. Network and CPU friendly.
2. **Client-side rAF batching** — `scheduleStreamUpdate` pushes updaters into a ref and schedules one `requestAnimationFrame` callback that applies all of them as a single `setState`. Locks React render rate at 60 fps maximum.
3. **No streaming highlight** — During streaming the code is rendered as plain text with a single tailwind color class. `highlight.js` runs once per file on `status === "done"` via `useMemo`, and is dynamically imported to keep it out of the first-paint bundle.

Additional safeguards:

- **Auto-scroll debounce** — Tracks whether the user scrolled up. If so, stop auto-scrolling to bottom. Resume when user scrolls back to bottom.
- **Per-file buffer cap** — `MAX_STREAM_CHARS = 50_000` (constant lives in `components/workspace/chat-area.tsx` alongside the `file_chunk` handler). Beyond this, further deltas are dropped client-side (content effectively truncated in the UI). The authoritative `files_complete` event restores the full content on completion.

### Performance budget (verifiable)

| Metric | Target | Verification |
|---|---|---|
| Main thread idle time during generation | > 50% | Chrome DevTools Performance |
| SSE event rate | ≤ 15/s | Network tab |
| React render rate | ≤ 60/s | React DevTools Profiler |
| Activity panel render time | < 8ms | Profiler |
| Memory growth over 5 min session | < 50MB | DevTools Memory snapshot |

## Abort, Errors, and Edge Cases

### User abort

`AbortController` logic unchanged. After `abort()`, streaming files are marked `failed` but their content is retained so the user can see the "half-written" state. Activity panel shows a `⏹ user aborted` banner. `liveStreams` is cleared on next `file_start` (natural upsert).

### Server error / stream broken mid-flight

`provider.streamCompletion` exceptions are already handled by existing `{ type: "error", errorCode }` emission. The tap is flushed via `finalize()` before the error event so any in-progress file gets a closing `file_end`, and subsequent code in the error handler marks all files in `failedFiles` as failed on the client side.

### Boundary-detection failures

| Scenario | Impact | Mitigation |
|---|---|---|
| Model ignores `=== FILE: ===` format entirely | `file_chunk` events never emitted | Activity panel shows header only; `files_complete` later fills `liveStreams` with completed content |
| File content contains a fake `=== FILE: /x ===` string | Mis-detected as new file | Next real header recovers; `files_complete` overwrites with authoritative code |
| Header split across delta boundary | Header bytes could be mis-emitted as content | `SAFE_TAIL = 32` holds trailing bytes until header completes in next delta |

In all cases, the authoritative path in `files_complete` corrects the UI at completion time.

### Retry and layer interactions

| Scenario | Behavior |
|---|---|
| Layer attempt 2 (subset failed) | `phase = "layer"`, only `failedSubset` files archive + reset |
| Per-file fallback | `phase = "per_file"`, single file archives its current buffer and reopens |
| Circuit breaker (3 consecutive failures) | Existing breaker aborts the request; all streaming files marked failed; existing error banner shown |
| Cross-layer progression | Layer 1 files remain `done` and visible as Layer 2 begins — natural progress feel |

### Edge Runtime compatibility

`/api/generate` is an Edge runtime route. All new code uses pure JS, `Date.now()`, and existing `TextEncoder`. No Node-only APIs. No new polyfills required. `highlight.js` is loaded on the client only.

### Demo mode

If demo viewer accounts are read-only (cannot trigger `isGenerating`), Activity tab is never activated for them. No special handling needed.

## Testing Strategy

Follows existing Jest project split and 80% coverage requirement.

### Unit tests — `__tests__/engineer-stream-tap.test.ts` (new, node env)

- Single complete file input → correct `file_start`, `file_chunk`, `file_end` sequence
- Two sequential files → correct boundary splitting
- Header split across delta boundary → not mis-emitted as content
- 1000 one-char feeds → no character loss or reordering
- Input without any `=== FILE: ===` → no events from `feed`, empty array from `finalize`
- Content containing fake header → detected but self-heals on real header
- `finalize` flushes residual buffer for last file

Target coverage ≥ 95%.

### Integration test — `__tests__/generate-route-streaming.test.ts` (new, node env)

- Mock `AIProvider.streamCompletion` with a preset token sequence
- Read SSE output from `/api/generate`, assert event ordering
- Assert throttling: 1000 tokens in 100ms → ≤ 15 `file_chunk` events
- Error branch: provider throws mid-stream → `file_end` for current file, then `error`, then `done`

### Component tests — `__tests__/activity-panel.test.tsx`, `__tests__/chat-area-live-streams.test.tsx`, `__tests__/preview-panel-tabs.test.tsx` (new/extended, jsdom env)

- Empty state renders header only
- Streaming state shows green text + cursor; done state shows grey + checkmark
- `failedAttempts` collapsed `<details>` block, expand on click
- `files_complete` overwrites streaming buffer with authoritative code
- `onAttempt` with `phase = per_file` archives current content
- Auto-switch tab on generation start; `userOverride` disables auto-switch back

### E2E test — `e2e/activity-streaming.spec.ts` (new)

1. Login as demo account → create `[E2E] streaming test` project
2. Submit prompt `做一个计数器组件`
3. Assert Activity tab auto-activates within 3s
4. Assert at least one `── /path ──` segment appears in the tab
5. Wait for generation to complete (up to 120s)
6. Assert auto-switch back to Preview tab
7. Assert Preview iframe loads successfully
8. `afterAll` calls `cleanupTestProjects`

Retry flows are tested at the component layer (error injection) rather than E2E to avoid flakiness.

### Manual QA checklist (for PR self-review)

- [ ] New project — Activity tab auto-activates, multi-file streams visible
- [ ] Three parallel files — UI remains smooth (verify 4.6 budget in DevTools)
- [ ] Abort mid-stream — partial content retained, banner shown
- [ ] Network kill (devtools offline) — error banner shown, failed files marked red
- [ ] Mobile Safari — SSE rate and scroll smoothness acceptable
- [ ] Dark mode — terminal colors readable

### Coverage targets

- `lib/engineer-stream-tap.ts`: ≥ 95%
- `components/preview/activity-panel.tsx`: ≥ 85%
- `chat-area.tsx` new branches: ≥ 80%
- Project overall coverage does not regress

## Files Touched (Summary)

**New:**

- `lib/engineer-stream-tap.ts`
- `components/preview/activity-panel.tsx`
- `__tests__/engineer-stream-tap.test.ts`
- `__tests__/generate-route-streaming.test.ts`
- `__tests__/activity-panel.test.tsx`
- `__tests__/chat-area-live-streams.test.tsx`
- `e2e/activity-streaming.spec.ts`

**Modified:**

- `lib/types.ts` — new SSE event types, `LiveFileStream` interface
- `app/api/generate/route.ts` — wire the tap into the engineer multi-file branch
- `components/preview/preview-panel.tsx` — add Activity tab + auto-switch logic
- `components/workspace/chat-area.tsx` — `liveStreams` state, new SSE handlers, `onAttempt` archive
- `__tests__/preview-panel-tabs.test.tsx` — extend for new tab
- `package.json` — add `highlight.js` dependency (dynamic import only)

**Unchanged (critical — verify during review):**

- `lib/generate-prompts.ts`
- `lib/extract-code.ts` / `extractMultiFileCodePartial`
- `lib/engineer-circuit.ts`
- `lib/extract-json.ts`
- Any version persistence path (`/api/versions`)

## Open Questions for Plan Stage

None. All UX and architecture decisions are resolved. The writing-plans skill should produce an implementation plan grouping work into the 7 new files + 6 modified files above, with tests written first per TDD workflow.
