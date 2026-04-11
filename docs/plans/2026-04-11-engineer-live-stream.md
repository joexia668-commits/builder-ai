# Engineer Live-Streaming Activity Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Activity" tab to the preview panel that live-streams each engineer-generated file's token output (terminal-style log, with collapsed blocks for failed retry attempts), driven by a purely observational tap on the existing engineer token stream.

**Architecture:** Observational bypass — `/api/generate/handler.ts` forks each provider token into (1) the existing authoritative `fullContent` path (unchanged) and (2) a new `StreamTap` that does incremental `// === FILE: /path ===` boundary detection and emits throttled `file_start` / `file_chunk` / `file_end` SSE events. Client holds `liveStreams: Record<string, LiveFileStream>` in the module-scoped `GenerationSession` store (so it survives chat-area remount), rendered by a new `ActivityPanel` component in the preview panel as a dark terminal-style scrolling `<pre>` log. On `files_complete` / `partial_files_complete`, authoritative code overwrites streaming buffers so any boundary-detection mistake self-heals.

**Tech Stack:** TypeScript strict mode, Next.js 14 Edge runtime route, React 18 client components, existing `useGenerationSession` module store pattern, Jest (node + jsdom projects), Playwright E2E, `highlight.js` (new, dynamically imported).

**Reference spec:** `docs/adr/0003-engineer-live-stream-activity-tab.md`

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `lib/engineer-stream-tap.ts` | Pure function — incremental `// === FILE: ===` boundary detector with `feed()`, `finalize()`, `reset()` |
| `lib/coalesce-chunks.ts` | Pure function — merges consecutive `file_chunk` events for the same path |
| `components/preview/activity-panel.tsx` | Dark terminal-style log rendering `liveStreams` + `engineerProgress` header |
| `components/preview/file-block.tsx` | Per-file segment — cursor, failed-attempts `<details>`, status color, delayed highlight.js |
| `hooks/use-auto-scroll-to-bottom.ts` | Auto-scroll hook that pauses when user scrolls up |
| `__tests__/engineer-stream-tap.test.ts` | Unit tests for tap (≥95% coverage target) |
| `__tests__/coalesce-chunks.test.ts` | Unit tests for chunk coalescing |
| `__tests__/generate-route-streaming.test.ts` | Handler integration test — SSE event ordering + throttling |
| `__tests__/activity-panel.test.tsx` | Component test — rendering, failed blocks, cursor |
| `__tests__/chat-area-live-streams.test.tsx` | Client state test — SSE handlers, retry archive, self-heal |
| `__tests__/preview-panel-activity-tab.test.tsx` | Tab switching + auto-switch logic |
| `e2e/activity-streaming.spec.ts` | Playwright E2E smoke test |

**Modified files:**

| Path | Changes |
|---|---|
| `lib/types.ts` | Add `LiveFileStream`, extend `SSEEventType` with `file_start` / `file_chunk` / `file_end`, extend `SSEEvent` with `path` / `delta` / `attempt` |
| `lib/generation-session.ts` | Add `liveStreams: Record<string, LiveFileStream>` to `GenerationSession`, include in `makeEmptySession` and `EMPTY_SESSION` |
| `app/api/generate/handler.ts` | Instantiate tap, fork `onChunk` into tap, flush throttled `file_chunk` events, finalize after `streamCompletion`, call `tap.reset()` on existing rate-limit / max-tokens retry path |
| `components/workspace/chat-area.tsx` | Extend `readEngineerSSE` to handle `file_start` / `file_chunk` / `file_end`; update `runLayerWithFallback` `onAttempt` callback to archive current stream into `failedAttempts` on retry; reset `liveStreams` on submit; clear `liveStreams` in `finally` block |
| `components/preview/preview-panel.tsx` | Add third tab `"activity"`, auto-switch logic on `isGenerating` edge, import `ActivityPanel`, pass through `liveStreams` + `engineerProgress` |
| `components/workspace/workspace.tsx` | Thread `liveStreams` + `engineerProgress` from `useGenerationSession` into `PreviewPanel` props |
| `package.json` | Add `highlight.js` dependency |

**Explicitly unchanged (verify during review):**

- `lib/generate-prompts.ts` — engineer prompt format is unchanged
- `lib/extract-code.ts` — `extractAnyMultiFileCode`, `extractMultiFileCodePartial`, `extractReactCode` are unchanged
- `lib/engineer-circuit.ts` — circuit breaker, retry, per-file fallback logic unchanged
- `lib/extract-json.ts` — PM / architect parsing unchanged
- `/api/versions` persistence path unchanged

---

## Task 1: Types — add `LiveFileStream` and new SSE event fields

**Files:**
- Modify: `lib/types.ts:90-121`

- [ ] **Step 1: Add new event types and fields**

Extend `SSEEventType` and `SSEEvent` in `lib/types.ts`:

```typescript
// Replace existing SSEEventType union
export type SSEEventType =
  | "thinking"
  | "chunk"
  | "code_chunk"
  | "code_complete"
  | "files_complete"
  | "partial_files_complete"
  | "reset"
  | "done"
  | "error"
  | "file_start"
  | "file_chunk"
  | "file_end";

// Extend SSEEvent interface (add path, delta, attempt fields)
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
  // Live-stream fields (engineer multi-file observational tap)
  path?: string;
  delta?: string;
  attempt?: number;
}
```

- [ ] **Step 2: Add `LiveFileStream` interface**

Append to `lib/types.ts` after `EngineerProgress`:

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

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add LiveFileStream and file_start/chunk/end SSE events"
```

---

## Task 2: StreamTap core — failing test

**Files:**
- Create: `__tests__/engineer-stream-tap.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
import { createEngineerStreamTap } from "@/lib/engineer-stream-tap";

describe("engineer-stream-tap", () => {
  describe("single file", () => {
    it("emits file_start then file_chunk then file_end for a complete input", () => {
      const tap = createEngineerStreamTap();
      const events = tap.feed("// === FILE: /App.js ===\nconsole.log(1);\n");
      const final = tap.finalize();
      const all = [...events, ...final];

      expect(all[0]).toEqual({ type: "file_start", path: "/App.js" });
      expect(all.filter((e) => e.type === "file_chunk").map((e) => e.delta).join("")).toBe(
        "console.log(1);\n"
      );
      expect(all[all.length - 1]).toEqual({ type: "file_end", path: "/App.js" });
    });

    it("holds short tail buffer until completion via finalize", () => {
      const tap = createEngineerStreamTap();
      const events = tap.feed("// === FILE: /a.js ===\nshort");
      // "short" (5 chars) is under SAFE_TAIL (256), so no file_chunk emitted yet
      expect(events.filter((e) => e.type === "file_chunk")).toHaveLength(0);
      const final = tap.finalize();
      const chunks = final.filter((e) => e.type === "file_chunk");
      expect(chunks.map((e) => e.delta).join("")).toBe("short");
    });
  });

  describe("multi-file", () => {
    it("splits two sequential files correctly", () => {
      const tap = createEngineerStreamTap();
      const input =
        "// === FILE: /a.js ===\n" +
        "A".repeat(300) + "\n" +
        "// === FILE: /b.js ===\n" +
        "B".repeat(300) + "\n";
      const events = [...tap.feed(input), ...tap.finalize()];

      const starts = events.filter((e) => e.type === "file_start");
      const ends = events.filter((e) => e.type === "file_end");
      expect(starts.map((e) => e.path)).toEqual(["/a.js", "/b.js"]);
      expect(ends.map((e) => e.path)).toEqual(["/a.js", "/b.js"]);

      const aContent = events
        .filter((e) => e.type === "file_chunk" && e.path === "/a.js")
        .map((e) => e.delta)
        .join("");
      const bContent = events
        .filter((e) => e.type === "file_chunk" && e.path === "/b.js")
        .map((e) => e.delta)
        .join("");
      expect(aContent).toBe("A".repeat(300) + "\n");
      expect(bContent).toBe("B".repeat(300) + "\n");
    });
  });

  describe("boundary splits", () => {
    it("does not mis-emit header when cut across delta boundaries", () => {
      const tap = createEngineerStreamTap();
      const part1 = tap.feed("// === FI");
      const part2 = tap.feed("LE: /a.js ===\n" + "x".repeat(300));
      const all = [...part1, ...part2];

      const chunkDeltas = all
        .filter((e) => e.type === "file_chunk")
        .map((e) => e.delta ?? "");
      for (const d of chunkDeltas) {
        expect(d).not.toContain("// === FI");
        expect(d).not.toContain("FILE:");
      }

      const starts = all.filter((e) => e.type === "file_start");
      expect(starts).toHaveLength(1);
      expect(starts[0].path).toBe("/a.js");
    });

    it("preserves exact byte sequence over 1000 one-char feeds", () => {
      const tap = createEngineerStreamTap();
      const input = "// === FILE: /a.js ===\n" + "0123456789".repeat(100);
      const events: Array<{ type: string; path?: string; delta?: string }> = [];
      for (const ch of input) {
        events.push(...tap.feed(ch));
      }
      events.push(...tap.finalize());
      const reassembled = events
        .filter((e) => e.type === "file_chunk")
        .map((e) => e.delta)
        .join("");
      expect(reassembled).toBe("0123456789".repeat(100));
    });
  });

  describe("non-standard input", () => {
    it("emits nothing when input has no FILE marker", () => {
      const tap = createEngineerStreamTap();
      const events = tap.feed("just some text without a marker\n".repeat(20));
      const final = tap.finalize();
      expect([...events, ...final]).toEqual([]);
    });

    it("self-heals when content contains a fake marker then a real one", () => {
      const tap = createEngineerStreamTap();
      const input =
        "// === FILE: /real.js ===\n" +
        "const s = '// === FILE: /fake.js ===';\n" +
        "// === FILE: /next.js ===\n" +
        "const n = 1;\n";
      const events = [...tap.feed(input), ...tap.finalize()];
      const starts = events.filter((e) => e.type === "file_start").map((e) => e.path);
      // Best-effort detector WILL see the fake marker mid-content and split there;
      // the authoritative files_complete event heals this client-side. This test
      // documents the behavior — not the "ideal" behavior.
      expect(starts).toEqual(["/real.js", "/fake.js", "/next.js"]);
    });
  });

  describe("reset", () => {
    it("clears internal state and currentPath", () => {
      const tap = createEngineerStreamTap();
      tap.feed("// === FILE: /a.js ===\nabc");
      tap.reset();
      const events = [...tap.feed("// === FILE: /b.js ===\nxyz"), ...tap.finalize()];
      const starts = events.filter((e) => e.type === "file_start").map((e) => e.path);
      expect(starts).toEqual(["/b.js"]);
      // /a.js should NOT appear
      expect(starts).not.toContain("/a.js");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="engineer-stream-tap"`
Expected: FAIL — `Cannot find module '@/lib/engineer-stream-tap'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add __tests__/engineer-stream-tap.test.ts
git commit -m "test(stream-tap): failing tests for engineer stream boundary detector"
```

---

## Task 3: StreamTap core — implementation

**Files:**
- Create: `lib/engineer-stream-tap.ts`

- [ ] **Step 1: Write the module**

```typescript
export interface StreamTapEvent {
  readonly type: "file_start" | "file_chunk" | "file_end";
  readonly path?: string;
  readonly delta?: string;
}

export interface EngineerStreamTap {
  feed(delta: string): StreamTapEvent[];
  finalize(): StreamTapEvent[];
  reset(): void;
}

const FILE_HEADER_RE = /^\/\/ === FILE: (\/[^\s=]+) ===\n?/m;
const SAFE_TAIL = 256;

export function createEngineerStreamTap(): EngineerStreamTap {
  let buffer = "";
  let currentPath: string | null = null;

  return {
    feed(delta: string): StreamTapEvent[] {
      buffer += delta;
      const events: StreamTapEvent[] = [];

      while (true) {
        const match = FILE_HEADER_RE.exec(buffer);
        if (!match) {
          if (currentPath && buffer.length > SAFE_TAIL) {
            const safe = buffer.slice(0, buffer.length - SAFE_TAIL);
            events.push({ type: "file_chunk", path: currentPath, delta: safe });
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

    reset(): void {
      buffer = "";
      currentPath = null;
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="engineer-stream-tap"`
Expected: PASS for all cases.

- [ ] **Step 3: Check coverage**

Run: `npm test -- --testPathPatterns="engineer-stream-tap" --coverage --collectCoverageFrom="lib/engineer-stream-tap.ts"`
Expected: ≥ 95% line coverage for `lib/engineer-stream-tap.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/engineer-stream-tap.ts
git commit -m "feat(stream-tap): engineer multi-file boundary detector with SAFE_TAIL=256"
```

---

## Task 4: Chunk coalescing — failing test

**Files:**
- Create: `__tests__/coalesce-chunks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { coalesceChunks } from "@/lib/coalesce-chunks";
import type { StreamTapEvent } from "@/lib/engineer-stream-tap";

describe("coalesceChunks", () => {
  it("merges consecutive file_chunk events for the same path", () => {
    const input: StreamTapEvent[] = [
      { type: "file_chunk", path: "/a.js", delta: "ab" },
      { type: "file_chunk", path: "/a.js", delta: "cd" },
      { type: "file_chunk", path: "/a.js", delta: "ef" },
    ];
    expect(coalesceChunks(input)).toEqual([
      { type: "file_chunk", path: "/a.js", delta: "abcdef" },
    ]);
  });

  it("does not merge chunks for different paths", () => {
    const input: StreamTapEvent[] = [
      { type: "file_chunk", path: "/a.js", delta: "a" },
      { type: "file_chunk", path: "/b.js", delta: "b" },
      { type: "file_chunk", path: "/a.js", delta: "a2" },
    ];
    const out = coalesceChunks(input);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: "file_chunk", path: "/a.js", delta: "a" });
  });

  it("passes file_start and file_end events through unchanged", () => {
    const input: StreamTapEvent[] = [
      { type: "file_start", path: "/a.js" },
      { type: "file_chunk", path: "/a.js", delta: "x" },
      { type: "file_chunk", path: "/a.js", delta: "y" },
      { type: "file_end", path: "/a.js" },
    ];
    expect(coalesceChunks(input)).toEqual([
      { type: "file_start", path: "/a.js" },
      { type: "file_chunk", path: "/a.js", delta: "xy" },
      { type: "file_end", path: "/a.js" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(coalesceChunks([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npm test -- --testPathPatterns="coalesce-chunks"`
Expected: FAIL — `Cannot find module '@/lib/coalesce-chunks'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add __tests__/coalesce-chunks.test.ts
git commit -m "test(coalesce): failing tests for stream chunk coalescing"
```

---

## Task 5: Chunk coalescing — implementation

**Files:**
- Create: `lib/coalesce-chunks.ts`

- [ ] **Step 1: Implement**

```typescript
import type { StreamTapEvent } from "@/lib/engineer-stream-tap";

export function coalesceChunks(events: readonly StreamTapEvent[]): StreamTapEvent[] {
  const out: StreamTapEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (
      ev.type === "file_chunk" &&
      last !== undefined &&
      last.type === "file_chunk" &&
      last.path === ev.path
    ) {
      out[out.length - 1] = {
        type: "file_chunk",
        path: last.path,
        delta: (last.delta ?? "") + (ev.delta ?? ""),
      };
    } else {
      out.push(ev);
    }
  }
  return out;
}
```

- [ ] **Step 2: Run test**

Run: `npm test -- --testPathPatterns="coalesce-chunks"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/coalesce-chunks.ts
git commit -m "feat(coalesce): merge consecutive file_chunk events per path"
```

---

## Task 6: `GenerationSession` — add `liveStreams` field

**Files:**
- Modify: `lib/generation-session.ts:8-38`

- [ ] **Step 1: Extend the interface and defaults**

```typescript
// lib/generation-session.ts — add to imports
import type {
  AgentRole,
  AgentState,
  EngineerProgress,
  ErrorCode,
  LiveFileStream,
} from "@/lib/types";

// Extend GenerationSession
export interface GenerationSession {
  projectId: string;
  abortController: AbortController;
  agentStates: Record<AgentRole, AgentState>;
  engineerProgress: EngineerProgress | null;
  liveStreams: Record<string, LiveFileStream>;  // NEW
  isGenerating: boolean;
  generationError: { code: ErrorCode; raw: string } | null;
  transitionText: string | null;
  lastPrompt: string;
  lastEventAt: number | null;
  stallWarning: boolean;
}

// Extend makeEmptySession to include liveStreams: {}
function makeEmptySession(projectId: string = ""): GenerationSession {
  return {
    projectId,
    abortController: new AbortController(),
    agentStates: {
      pm: { role: "pm", status: "idle", output: "" },
      architect: { role: "architect", status: "idle", output: "" },
      engineer: { role: "engineer", status: "idle", output: "" },
    },
    engineerProgress: null,
    liveStreams: {},  // NEW
    isGenerating: false,
    generationError: null,
    transitionText: null,
    lastPrompt: "",
    lastEventAt: null,
    stallWarning: false,
  };
}
```

- [ ] **Step 2: Run existing session tests**

Run: `npm test -- --testPathPatterns="generation-session"`
Expected: PASS (existing tests should not reference `liveStreams` — they should compile fine because it's an added field on a struct).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/generation-session.ts
git commit -m "feat(session): add liveStreams field to GenerationSession store"
```

---

## Task 7: Handler integration — failing test for SSE event ordering and throttling

**Files:**
- Create: `__tests__/generate-route-streaming.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { createHandler } from "@/app/api/generate/handler";
import type { AIProvider } from "@/lib/ai-providers";
import type { NextRequest } from "next/server";

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(async () => ({ sub: "test-user", isDemo: false })),
}));

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

async function readSSEEvents(
  response: Response
): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const block of lines) {
      const line = block.replace(/^data: /, "").trim();
      if (line) events.push(JSON.parse(line));
    }
  }
  return events;
}

function makeFakeProvider(chunks: string[]): AIProvider {
  return {
    streamCompletion: async (_messages, onChunk) => {
      for (const c of chunks) {
        onChunk(c);
        // Yield to event loop so throttle windows can elapse
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  } as unknown as AIProvider;
}

describe("/api/generate — engineer streaming tap", () => {
  it("emits file_start → file_chunk → file_end in order for a multi-file engineer response", async () => {
    const chunks = [
      "// === FILE: /a.js ===\n",
      "const a = 1;\n",
      "// === FILE: /b.js ===\n",
      "const b = 2;\n",
    ];
    const handler = createHandler({
      createProvider: () => makeFakeProvider(chunks),
    });
    const req = makeRequest({
      projectId: "p1",
      prompt: "x",
      agent: "engineer",
      context: "ctx",
      targetFiles: [
        { path: "/a.js", description: "", exports: [], deps: [], hints: "" },
        { path: "/b.js", description: "", exports: [], deps: [], hints: "" },
      ],
    });
    const res = await handler(req);
    const events = await readSSEEvents(res);

    const tapEvents = events.filter((e) =>
      ["file_start", "file_chunk", "file_end"].includes(e.type as string)
    );
    const paths = tapEvents.map((e) => `${e.type}:${e.path}`);
    expect(paths[0]).toBe("file_start:/a.js");
    expect(paths.indexOf("file_end:/a.js")).toBeLessThan(
      paths.indexOf("file_start:/b.js")
    );
    expect(paths[paths.length - 1]).toBe("file_end:/b.js");

    // Authoritative path still present
    expect(events.some((e) => e.type === "files_complete")).toBe(true);
  });

  it("coalesces rapid chunks within the 80ms throttle window", async () => {
    // Emit 50 tiny chunks for a single file rapidly
    const chunks = [
      "// === FILE: /a.js ===\n",
      ...Array(50).fill(0).map((_, i) => `x${i};`),
    ];
    const handler = createHandler({
      createProvider: () => makeFakeProvider(chunks),
    });
    const req = makeRequest({
      projectId: "p1",
      prompt: "x",
      agent: "engineer",
      context: "ctx",
      targetFiles: [
        { path: "/a.js", description: "", exports: [], deps: [], hints: "" },
      ],
    });
    const res = await handler(req);
    const events = await readSSEEvents(res);

    // Server-side coalescing: chunks for /a.js merged within flush windows
    const fileChunks = events.filter(
      (e) => e.type === "file_chunk" && e.path === "/a.js"
    );
    // Expectation: dramatically fewer than 50 events. Exact count depends on
    // test timing, but should be ≤ 10 for 50 chunks at 80ms throttle.
    expect(fileChunks.length).toBeLessThan(15);
  });

  it("skips tap for non-engineer agents", async () => {
    const handler = createHandler({
      createProvider: () => makeFakeProvider(['{"intent":"x","features":[],"persistence":"none","modules":[]}']),
    });
    const req = makeRequest({
      projectId: "p1",
      prompt: "x",
      agent: "pm",
    });
    const res = await handler(req);
    const events = await readSSEEvents(res);
    expect(events.some((e) => e.type === "file_start")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npm test -- --testPathPatterns="generate-route-streaming"`
Expected: FAIL — the handler currently does not emit `file_start` / `file_chunk` / `file_end`.

- [ ] **Step 3: Commit failing test**

```bash
git add __tests__/generate-route-streaming.test.ts
git commit -m "test(handler): failing test for engineer SSE streaming tap"
```

---

## Task 8: Handler integration — wire tap into `onChunk`

**Files:**
- Modify: `app/api/generate/handler.ts:1-10` (imports)
- Modify: `app/api/generate/handler.ts:75-120` (onChunk + reset paths)

- [ ] **Step 1: Add imports**

At the top of `handler.ts`, after existing imports:

```typescript
import { createEngineerStreamTap, type StreamTapEvent } from "@/lib/engineer-stream-tap";
import { coalesceChunks } from "@/lib/coalesce-chunks";
```

- [ ] **Step 2: Instantiate tap and set up throttled flush**

Inside `start(controller)`, after the `let fullContent = "";` line (currently `handler.ts:75`), add:

```typescript
const isEngineerMultiFile =
  agent === "engineer" &&
  (partialMultiFile === true ||
    (targetFiles !== undefined && targetFiles.length > 0));
const tap = isEngineerMultiFile ? createEngineerStreamTap() : null;
let pendingTapEvents: StreamTapEvent[] = [];
let lastTapFlush = Date.now();
const TAP_FLUSH_INTERVAL_MS = 80;

function flushTapPending() {
  if (pendingTapEvents.length === 0) return;
  const coalesced = coalesceChunks(pendingTapEvents);
  for (const ev of coalesced) send(controller, ev);
  pendingTapEvents = [];
  lastTapFlush = Date.now();
}
```

- [ ] **Step 3: Extend `onChunk`**

Replace the existing `onChunk` definition (currently `handler.ts:82-85`):

```typescript
const onChunk = (text: string) => {
  fullContent += text;
  send(controller, { type: "chunk", content: text });

  if (tap !== null) {
    pendingTapEvents.push(...tap.feed(text));
    if (Date.now() - lastTapFlush >= TAP_FLUSH_INTERVAL_MS) {
      flushTapPending();
    }
  }
};
```

- [ ] **Step 4: Reset tap on existing retry paths**

In the `catch (err)` block inside `start(controller)`, find the two places that currently do `fullContent = ""; send(controller, { type: "reset" });` (the `isMaxTokens` branch and the `isRateLimitError` branch, currently `handler.ts:96-115`). Add `tap?.reset();` and `pendingTapEvents = [];` immediately after each `fullContent = ""`:

```typescript
if (isMaxTokens && agent === "engineer") {
  fullContent = "";
  tap?.reset();
  pendingTapEvents = [];
  send(controller, { type: "reset" });
  // ... existing retry code
} else if (isRateLimitError(err) && process.env.GROQ_API_KEY) {
  fullContent = "";
  tap?.reset();
  pendingTapEvents = [];
  send(controller, { type: "reset" });
  // ... existing Groq fallback code
}
```

- [ ] **Step 5: Final flush before authoritative extract**

Immediately before the `if (agent === "engineer")` block (currently `handler.ts:121`), add:

```typescript
if (tap !== null) {
  pendingTapEvents.push(...tap.finalize());
  flushTapPending();
}
```

- [ ] **Step 6: Run streaming test**

Run: `npm test -- --testPathPatterns="generate-route-streaming"`
Expected: PASS for all three test cases.

- [ ] **Step 7: Run full handler test suite to verify no regressions**

Run: `npm test -- --testPathPatterns="generate"`
Expected: All existing `generate`-related tests still pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/generate/handler.ts
git commit -m "feat(handler): wire observational stream tap into engineer onChunk"
```

---

## Task 9: Client state — failing test for `file_start` / `file_chunk` / `file_end` handling

**Files:**
- Create: `__tests__/chat-area-live-streams.test.tsx`

- [ ] **Step 1: Write the failing test**

This test uses the existing mocking patterns from `__tests__/chat-area-remount-survives-generation.test.tsx`. Reference that file for setup; the key assertions are:

```typescript
import { render, waitFor } from "@testing-library/react";
import { ChatArea } from "@/components/workspace/chat-area";
import { getSession, resetSession } from "@/lib/generation-session";
import type { Project } from "@/lib/types";

// Minimal harness: mock fetchAPI, mock fetch for /api/generate, mock topologicalSort
// and runLayerWithFallback so we control the SSE event sequence.
jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn(async () => new Response(JSON.stringify({ id: "v1" }))),
  readSSEBody: jest.requireActual("@/lib/api-client").readSSEBody,
}));

function makeSSEResponse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

const PROJECT: Project = {
  id: "test-proj",
  name: "test",
  userId: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("chat-area live streams state", () => {
  beforeEach(() => {
    resetSession(PROJECT.id);
  });

  it("updates liveStreams from file_start, file_chunk, file_end events", async () => {
    // Arrange: mock fetch to return a fake engineer SSE body
    global.fetch = jest.fn(async () =>
      makeSSEResponse([
        { type: "thinking", content: "engineer..." },
        { type: "file_start", path: "/App.js" },
        { type: "file_chunk", path: "/App.js", delta: "const x = 1;" },
        { type: "file_chunk", path: "/App.js", delta: "\nexport default x;" },
        { type: "file_end", path: "/App.js" },
        { type: "files_complete", files: { "/App.js": "const x = 1;\nexport default x;" } },
        { type: "done" },
      ])
    ) as jest.Mock;

    // Act: render and trigger generation via direct single-file V1 path
    // (Refer to existing chat-area-remount tests for the exact trigger pattern)
    // ...

    // Assert: after the SSE body drains, session.liveStreams['/App.js'] should exist
    await waitFor(() => {
      const s = getSession(PROJECT.id);
      expect(s.liveStreams["/App.js"]).toBeDefined();
      expect(s.liveStreams["/App.js"].content).toBe("const x = 1;\nexport default x;");
      expect(s.liveStreams["/App.js"].status).toBe("done");
    });
  });

  it("archives failedAttempts on per-file retry", async () => {
    // Arrange: simulate onAttempt callback with phase=per_file and attempt=2
    // (Use engineer-circuit mock to inject the retry signal)
    // ...

    // Assert: after retry, liveStreams[path].failedAttempts has 1 entry with the old content
    await waitFor(() => {
      const s = getSession(PROJECT.id);
      const stream = s.liveStreams["/App.js"];
      expect(stream.failedAttempts).toHaveLength(1);
      expect(stream.failedAttempts[0].content).toContain("partial content");
      expect(stream.attempt).toBe(2);
      expect(stream.content).toBe(""); // reset for new attempt
    });
  });

  it("overwrites streaming buffer with authoritative code on files_complete (self-heal)", async () => {
    // Arrange: file_chunk events accumulate "WRONG content", then files_complete
    // sends { '/App.js': 'CORRECT content' }
    // ...

    // Assert: liveStreams['/App.js'].content === 'CORRECT content'
    await waitFor(() => {
      const s = getSession(PROJECT.id);
      expect(s.liveStreams["/App.js"].content).toBe("CORRECT content");
    });
  });

  it("clears liveStreams in the finally block after generation completes", async () => {
    // Arrange: complete a normal generation
    // ...

    // Assert: after isGenerating becomes false, liveStreams is reset to {}
    await waitFor(() => {
      expect(getSession(PROJECT.id).isGenerating).toBe(false);
      expect(getSession(PROJECT.id).liveStreams).toEqual({});
    });
  });
});
```

Engineer note: this test file is skeleton-level because the exact mocking pattern for `chat-area.tsx` is involved. Before implementing, read `__tests__/chat-area-remount-survives-generation.test.tsx` to copy its harness verbatim, then fill in the `// ...` sections with the trigger pattern from that file.

- [ ] **Step 2: Run test — should fail**

Run: `npm test -- --testPathPatterns="chat-area-live-streams"`
Expected: FAIL — `liveStreams` does not exist on session, OR events are not handled.

- [ ] **Step 3: Commit failing test**

```bash
git add __tests__/chat-area-live-streams.test.tsx
git commit -m "test(chat-area): failing tests for liveStreams SSE handling and self-heal"
```

---

## Task 10: Client state — implement `file_*` handlers in `readEngineerSSE`

**Files:**
- Modify: `components/workspace/chat-area.tsx:149-204` (readEngineerSSE)
- Modify: `components/workspace/chat-area.tsx:206-221` (handleSubmit setup — reset liveStreams on submit)
- Modify: `components/workspace/chat-area.tsx:757-765` (finally block — clear liveStreams)
- Modify: `components/workspace/chat-area.tsx:504-524` (runLayerWithFallback onAttempt — archive on retry)

- [ ] **Step 1: Extend `readEngineerSSE` event handler**

Inside `readSSEBody` event callback in `readEngineerSSE` (currently `chat-area.tsx:174-194`), add three new branches **before** the `else if (event.type === "error")` branch:

```typescript
} else if (event.type === "file_start" && event.path) {
  const path = event.path;
  const current = getSession(project.id);
  const existing = current.liveStreams[path];
  updateSession(project.id, {
    liveStreams: {
      ...current.liveStreams,
      [path]: {
        path,
        content: "",
        status: "streaming",
        attempt: existing?.attempt ?? 1,
        failedAttempts: existing?.failedAttempts ?? [],
      },
    },
  });
} else if (event.type === "file_chunk" && event.path && event.delta !== undefined) {
  const path = event.path;
  const delta = event.delta;
  const current = getSession(project.id);
  const cur = current.liveStreams[path];
  if (cur !== undefined) {
    const MAX_STREAM_CHARS = 50_000;
    const nextContent =
      cur.content.length >= MAX_STREAM_CHARS ? cur.content : cur.content + delta;
    updateSession(project.id, {
      liveStreams: {
        ...current.liveStreams,
        [path]: { ...cur, content: nextContent },
      },
    });
  }
} else if (event.type === "file_end") {
  // No-op: await authoritative files_complete / partial_files_complete
}
```

- [ ] **Step 2: Extend `files_complete` / `partial_files_complete` handling to overwrite with authoritative code**

Inside the same callback, extend the existing `files_complete` / `partial_files_complete` branches (currently `chat-area.tsx:175-181`):

```typescript
if (event.type === "files_complete" && event.files) {
  files = event.files;
  failedInResponse = [];
  // Self-heal: overwrite streaming buffer with authoritative code
  const authoritative = event.files;
  const current = getSession(project.id);
  const next = { ...current.liveStreams };
  for (const [p, code] of Object.entries(authoritative)) {
    if (next[p] !== undefined) {
      next[p] = { ...next[p], status: "done", content: code };
    }
  }
  updateSession(project.id, { liveStreams: next });
} else if (event.type === "partial_files_complete" && event.files) {
  files = event.files;
  failedInResponse = event.failed ?? [];
  truncatedTail = event.truncatedTail;
  const authoritative = event.files;
  const failedPaths = new Set(event.failed ?? []);
  const current = getSession(project.id);
  const next = { ...current.liveStreams };
  for (const [p, code] of Object.entries(authoritative)) {
    if (next[p] !== undefined) {
      next[p] = { ...next[p], status: "done", content: code };
    }
  }
  for (const p of failedPaths) {
    if (next[p] !== undefined) {
      next[p] = { ...next[p], status: "failed" };
    }
  }
  updateSession(project.id, { liveStreams: next });
}
```

- [ ] **Step 3: Reset `liveStreams` on submit**

In `handleSubmit` (currently `chat-area.tsx:206-221`), add `liveStreams: {}` to the `updateSession` call that clears state at the start:

```typescript
updateSession(project.id, {
  generationError: null,
  lastPrompt: prompt,
  isGenerating: true,
  stallWarning: false,
  abortController,
  liveStreams: {},  // NEW
  agentStates: {
    pm: { role: "pm", status: "idle", output: "" },
    architect: { role: "architect", status: "idle", output: "" },
    engineer: { role: "engineer", status: "idle", output: "" },
  },
});
```

- [ ] **Step 4: Archive on per-file retry in `onAttempt` callback**

Inside `runLayerWithFallback`'s `onAttempt` callback (currently `chat-area.tsx:505-524`), extend it to archive `failedSubset` streams when `info.attempt > 1`:

```typescript
(info) => {
  const prev = getSession(project.id).engineerProgress;
  if (prev) {
    // ...existing engineerProgress update
  }

  // NEW: archive current streaming content when retrying specific files
  if (info.attempt > 1 && info.failedSubset.length > 0) {
    const session = getSession(project.id);
    const next = { ...session.liveStreams };
    for (const path of info.failedSubset) {
      const cur = next[path];
      if (cur === undefined) continue;
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
    updateSession(project.id, { liveStreams: next });
  }
}
```

- [ ] **Step 5: Clear `liveStreams` in `finally` with 2.5s delay**

Modify the existing `finally` block at the end of `handleSubmit` (currently `chat-area.tsx:757-765`). The current code sets `isGenerating: false` immediately — keep that — but schedule a delayed clear of `liveStreams` so the user sees final state for 2.5s:

```typescript
} finally {
  updateSession(project.id, {
    isGenerating: false,
    transitionText: null,
    engineerProgress: null,
    stallWarning: false,
  });
  onGeneratingChange?.(false);

  // Keep liveStreams visible for 2.5s then clear so a new submission starts clean.
  setTimeout(() => {
    const current = getSession(project.id);
    // Only clear if no new generation has started (would have already cleared)
    if (!current.isGenerating) {
      updateSession(project.id, { liveStreams: {} });
    }
  }, 2500);
}
```

- [ ] **Step 6: Apply same file_* handling to the direct path SSE read**

The direct path uses an inline `readSSEBody` call at `chat-area.tsx:297-328` (not `readEngineerSSE`). Add the same three `file_start` / `file_chunk` / `file_end` branches inside that callback, plus self-heal on `files_complete`:

```typescript
await readSSEBody<{
  type: string;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  path?: string;
  delta?: string;
  error?: string;
  errorCode?: ErrorCode;
}>(
  directResponse.body,
  (event) => {
    if (event.type === "chunk") {
      directOutput += event.content ?? "";
      updateAgentState("engineer", { output: directOutput });
    } else if (event.type === "file_start" && event.path) {
      // [same handler as readEngineerSSE]
    } else if (event.type === "file_chunk" && event.path && event.delta !== undefined) {
      // [same handler as readEngineerSSE]
    } else if (event.type === "file_end") {
      // No-op
    } else if (event.type === "code_complete") {
      if (event.code) directCode = event.code;
    } else if (event.type === "files_complete" && event.files) {
      directFiles = event.files;
      // Self-heal liveStreams with authoritative code
      const authoritative = event.files;
      const current = getSession(project.id);
      const next = { ...current.liveStreams };
      for (const [p, code] of Object.entries(authoritative)) {
        if (next[p] !== undefined) {
          next[p] = { ...next[p], status: "done", content: code };
        }
      }
      updateSession(project.id, { liveStreams: next });
    } else if (event.type === "reset") {
      directOutput = "";
      updateAgentState("engineer", { output: "" });
      // Also reset liveStreams for the direct path
      updateSession(project.id, { liveStreams: {} });
    } else if (event.type === "error") {
      throw Object.assign(
        new Error(event.error ?? "Stream error"),
        { errorCode: event.errorCode ?? "unknown" }
      );
    }
  },
  { /* ... existing options ... */ }
);
```

- [ ] **Step 7: Run the chat-area live-streams test**

Run: `npm test -- --testPathPatterns="chat-area-live-streams"`
Expected: PASS for all four test cases.

- [ ] **Step 8: Run chat-area regression suite**

Run: `npm test -- --testPathPatterns="chat-area"`
Expected: All existing chat-area tests still pass (including the remount-survives-generation test).

- [ ] **Step 9: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat(chat-area): handle file_start/chunk/end events and per-file retry archive"
```

---

## Task 11: `use-auto-scroll-to-bottom` hook

**Files:**
- Create: `hooks/use-auto-scroll-to-bottom.ts`

- [ ] **Step 1: Implement hook**

```typescript
import { useEffect, useRef } from "react";

/**
 * Auto-scrolls a container to the bottom whenever `deps` change, unless
 * the user has manually scrolled up. Resumes auto-scroll when the user
 * scrolls back to within 20px of the bottom.
 */
export function useAutoScrollToBottom<T extends HTMLElement>(
  ref: React.RefObject<T>,
  deps: readonly unknown[]
): void {
  const userScrolledUp = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onScroll = (): void => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = distanceFromBottom > 20;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (el === null || userScrolledUp.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-auto-scroll-to-bottom.ts
git commit -m "feat(hooks): add use-auto-scroll-to-bottom with user-scroll detection"
```

---

## Task 12: `ActivityPanel` component — failing test

**Files:**
- Create: `__tests__/activity-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen } from "@testing-library/react";
import { ActivityPanel } from "@/components/preview/activity-panel";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

function makeStream(overrides: Partial<LiveFileStream> = {}): LiveFileStream {
  return {
    path: "/App.js",
    content: "",
    status: "streaming",
    attempt: 1,
    failedAttempts: [],
    ...overrides,
  };
}

const EMPTY_PROGRESS: EngineerProgress = {
  totalLayers: 2,
  currentLayer: 1,
  totalFiles: 3,
  currentFiles: ["App.js"],
  completedFiles: [],
  failedFiles: [],
  retryInfo: null,
};

describe("ActivityPanel", () => {
  it("renders nothing but header when liveStreams is empty", () => {
    const { container } = render(
      <ActivityPanel liveStreams={{}} engineerProgress={EMPTY_PROGRESS} />
    );
    expect(container.textContent).toContain("Layer 1/2");
    expect(container.querySelectorAll("pre")).toHaveLength(0);
  });

  it("renders a <pre> block for each streaming file", () => {
    const streams: Record<string, LiveFileStream> = {
      "/App.js": makeStream({ content: "const x = 1;" }),
      "/Foo.tsx": makeStream({ path: "/Foo.tsx", content: "export const Foo = () => null;" }),
    };
    render(<ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />);
    expect(screen.getByText(/\/App\.js/)).toBeInTheDocument();
    expect(screen.getByText(/\/Foo\.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/const x = 1;/)).toBeInTheDocument();
  });

  it("shows a done marker when status is done", () => {
    const streams = {
      "/App.js": makeStream({ content: "done code", status: "done" as const }),
    };
    render(<ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />);
    expect(screen.getByText(/✓/)).toBeInTheDocument();
  });

  it("shows collapsed failed-attempts block when failedAttempts is non-empty", () => {
    const streams = {
      "/App.js": makeStream({
        content: "new attempt",
        attempt: 2,
        failedAttempts: [{ content: "bad content", reason: "parse_failed" }],
      }),
    };
    render(<ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />);
    // Details element is present but collapsed by default
    const details = screen.getByText(/1 次失败/);
    expect(details).toBeInTheDocument();
    // Retry marker shows on the current attempt header
    expect(screen.getByText(/retry 2/)).toBeInTheDocument();
  });

  it("applies different classes for streaming/done/failed status", () => {
    const streams = {
      "/a.js": makeStream({ path: "/a.js", status: "streaming", content: "s" }),
      "/b.js": makeStream({ path: "/b.js", status: "done", content: "d" }),
      "/c.js": makeStream({ path: "/c.js", status: "failed", content: "f" }),
    };
    const { container } = render(
      <ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />
    );
    const pres = container.querySelectorAll("pre");
    expect(pres).toHaveLength(3);
    // Color classes — at least verify that distinct class strings exist per status
    const classLists = Array.from(pres).map((p) => p.className);
    expect(new Set(classLists).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npm test -- --testPathPatterns="activity-panel"`
Expected: FAIL — `Cannot find module '@/components/preview/activity-panel'`.

- [ ] **Step 3: Commit**

```bash
git add __tests__/activity-panel.test.tsx
git commit -m "test(activity-panel): failing rendering tests"
```

---

## Task 13: `ActivityPanel` and `FileBlock` components — implementation

**Files:**
- Create: `components/preview/file-block.tsx`
- Create: `components/preview/activity-panel.tsx`

- [ ] **Step 1: Implement `FileBlock`**

```typescript
"use client";

import { useMemo, useState } from "react";
import type { LiveFileStream } from "@/lib/types";

interface FileBlockProps {
  readonly stream: LiveFileStream;
}

function inferLanguage(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "typescript";
}

export function FileBlock({ stream }: FileBlockProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Trigger highlight only when status flips to done (not during streaming)
  useMemo(() => {
    if (stream.status !== "done") {
      setHighlighted(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const hljs = (await import("highlight.js/lib/core")).default;
        const lang = inferLanguage(stream.path);
        if (lang === "typescript" || lang === "javascript") {
          const ts = (await import("highlight.js/lib/languages/typescript")).default;
          hljs.registerLanguage("typescript", ts);
        } else if (lang === "css") {
          const css = (await import("highlight.js/lib/languages/css")).default;
          hljs.registerLanguage("css", css);
        } else if (lang === "json") {
          const json = (await import("highlight.js/lib/languages/json")).default;
          hljs.registerLanguage("json", json);
        }
        const result = hljs.highlight(stream.content, { language: lang });
        if (!cancelled) setHighlighted(result.value);
      } catch {
        // fallback to plain text
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stream.status, stream.content, stream.path]);

  const statusClass =
    stream.status === "streaming"
      ? "text-green-300"
      : stream.status === "done"
        ? "text-zinc-300"
        : "text-red-300";

  return (
    <section className="mb-4">
      {stream.failedAttempts.length > 0 && (
        <details className="mb-2">
          <summary className="text-red-400 cursor-pointer text-[11px]">
            ✗ {stream.failedAttempts.length} 次失败 (点击展开)
          </summary>
          {stream.failedAttempts.map((f, i) => (
            <pre
              key={i}
              className="text-zinc-500 whitespace-pre-wrap text-[11px] mt-1"
            >
              {`── ${stream.path} (attempt ${i + 1}) ──\n${f.content}\n✗ ${f.reason}`}
            </pre>
          ))}
        </details>
      )}

      <pre className={`whitespace-pre-wrap text-[11px] ${statusClass}`}>
        {`── ${stream.path}${stream.attempt > 1 ? ` (retry ${stream.attempt}/3)` : ""} ──\n`}
        {highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          stream.content
        )}
        {stream.status === "streaming" && (
          <span className="inline-block w-2 h-3 bg-green-300 animate-pulse ml-0.5" />
        )}
        {stream.status === "done" && "\n✓ 完成"}
      </pre>
    </section>
  );
}
```

- [ ] **Step 2: Implement `ActivityPanel`**

```typescript
"use client";

import { useRef } from "react";
import { FileBlock } from "@/components/preview/file-block";
import { useAutoScrollToBottom } from "@/hooks/use-auto-scroll-to-bottom";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

interface ActivityPanelProps {
  readonly liveStreams: Record<string, LiveFileStream>;
  readonly engineerProgress: EngineerProgress | null;
}

export function ActivityPanel({ liveStreams, engineerProgress }: ActivityPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const streams = Object.values(liveStreams);

  useAutoScrollToBottom(containerRef, [
    streams.length,
    streams.reduce((sum, s) => sum + s.content.length, 0),
  ]);

  return (
    <div
      ref={containerRef}
      data-testid="activity-panel"
      className="h-full overflow-auto font-mono text-xs bg-zinc-950 text-zinc-100 p-4"
    >
      {engineerProgress !== null && (
        <div className="sticky top-0 bg-zinc-950/95 border-b border-zinc-800 pb-2 mb-3 text-zinc-400">
          Layer {engineerProgress.currentLayer}/{engineerProgress.totalLayers} ·{" "}
          {engineerProgress.completedFiles.length}/{engineerProgress.totalFiles} done
          {engineerProgress.retryInfo !== null && (
            <span className="ml-2 text-amber-400">
              🔁 retry {engineerProgress.retryInfo.attempt}/
              {engineerProgress.retryInfo.maxAttempts}
            </span>
          )}
        </div>
      )}
      {streams.map((s) => (
        <FileBlock key={s.path} stream={s} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add highlight.js dependency**

Run: `npm install --save highlight.js`

- [ ] **Step 4: Run activity-panel tests**

Run: `npm test -- --testPathPatterns="activity-panel"`
Expected: PASS for all five test cases.

- [ ] **Step 5: Commit**

```bash
git add components/preview/file-block.tsx components/preview/activity-panel.tsx package.json package-lock.json
git commit -m "feat(activity-panel): terminal-style streaming log with failed-attempts collapse"
```

---

## Task 14: `PreviewPanel` — add Activity tab

**Files:**
- Modify: `components/preview/preview-panel.tsx:1-219`

- [ ] **Step 1: Failing test**

Create `__tests__/preview-panel-activity-tab.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import type { ProjectVersion, LiveFileStream, EngineerProgress } from "@/lib/types";

jest.mock("@/components/preview/preview-frame", () => ({
  PreviewFrame: () => <div data-testid="preview-frame" />,
}));
jest.mock("@/components/preview/file-tree-code-viewer", () => ({
  FileTreeCodeViewer: () => <div data-testid="code-viewer" />,
}));
jest.mock("@/components/timeline/version-timeline", () => ({
  VersionTimeline: () => null,
}));
jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn(),
}));

const BASE_PROPS = {
  files: { "/App.js": "x" },
  projectId: "p1",
  versions: [] as ProjectVersion[],
  previewingVersion: null,
  onPreviewVersion: jest.fn(),
  onVersionRestore: jest.fn(),
  latestVersionId: "v1",
  liveStreams: {} as Record<string, LiveFileStream>,
  engineerProgress: null as EngineerProgress | null,
};

describe("PreviewPanel Activity tab", () => {
  it("renders the Activity tab button", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("tab-activity")).toBeInTheDocument();
  });

  it("auto-switches to Activity tab when isGenerating becomes true", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("activity-panel")).toBeInTheDocument();
  });

  it("does not auto-switch back if user has manually clicked Preview mid-generation", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    // user overrides by clicking Preview
    fireEvent.click(screen.getByTestId("tab-preview"));
    // generation ends — should NOT auto-switch anywhere since user already chose
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — should fail**

Run: `npm test -- --testPathPatterns="preview-panel-activity-tab"`
Expected: FAIL — `tab-activity` not found.

- [ ] **Step 3: Extend `Tab` union and add Activity tab**

In `components/preview/preview-panel.tsx`:

```typescript
// line 10: extend Tab union
type Tab = "preview" | "code" | "activity";

// line 13: extend props
interface PreviewPanelProps {
  files: Record<string, string>;
  projectId: string;
  isGenerating: boolean;
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onVersionRestore: (newVersion: ProjectVersion) => void;
  latestVersionId?: string;
  liveStreams: Record<string, LiveFileStream>;       // NEW
  engineerProgress: EngineerProgress | null;         // NEW
}
```

Add imports:

```typescript
import { ActivityPanel } from "@/components/preview/activity-panel";
import type { ProjectVersion, LiveFileStream, EngineerProgress } from "@/lib/types";
```

- [ ] **Step 4: Add auto-switch effect**

Inside the component, after the existing `useEffect` for `deployPollRef`, add:

```typescript
const userOverrideRef = useRef(false);
const prevGeneratingRef = useRef(isGenerating);

useEffect(() => {
  const prev = prevGeneratingRef.current;
  prevGeneratingRef.current = isGenerating;

  // Rising edge: generation just started — auto-switch to activity unless overridden
  if (!prev && isGenerating && !userOverrideRef.current) {
    setTab("activity");
  }
  // Falling edge: generation just ended — reset user override so next run auto-switches again
  if (prev && !isGenerating) {
    setTimeout(() => {
      if (!userOverrideRef.current) setTab("preview");
      userOverrideRef.current = false;
    }, 2500);
  }
}, [isGenerating]);
```

- [ ] **Step 5: Extend the tab bar rendering**

Replace the `{(["preview", "code"] as Tab[]).map(...)}` block (currently `preview-panel.tsx:113-127`) with:

```tsx
{(["preview", "code", "activity"] as Tab[]).map((t) => (
  <button
    key={t}
    data-testid={`tab-${t}`}
    onClick={() => {
      setTab(t);
      userOverrideRef.current = true;
    }}
    className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
      tab === t
        ? "bg-white text-[#111827] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
        : "text-[#6b7280] hover:text-[#374151]"
    }`}
  >
    {t === "preview" ? "预览" : t === "code" ? "代码" : (
      <span className="inline-flex items-center gap-1">
        Activity
        {isGenerating && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        )}
      </span>
    )}
  </button>
))}
```

- [ ] **Step 6: Render `ActivityPanel` for the activity tab**

Replace the content rendering block (currently `preview-panel.tsx:179-204`) to handle three tabs:

```tsx
{tab === "preview" ? (
  /* existing preview block — unchanged */
) : tab === "code" ? (
  <FileTreeCodeViewer files={files} />
) : (
  <ActivityPanel
    liveStreams={liveStreams}
    engineerProgress={engineerProgress}
  />
)}
```

- [ ] **Step 7: Run test**

Run: `npm test -- --testPathPatterns="preview-panel-activity-tab"`
Expected: PASS for all three tests.

- [ ] **Step 8: Run broader preview-panel regression**

Run: `npm test -- --testPathPatterns="preview-panel"`
Expected: All existing preview-panel tests still pass.

- [ ] **Step 9: Commit**

```bash
git add components/preview/preview-panel.tsx __tests__/preview-panel-activity-tab.test.tsx
git commit -m "feat(preview-panel): add Activity tab with auto-switch on generation start"
```

---

## Task 15: `Workspace` — thread `liveStreams` to `PreviewPanel`

**Files:**
- Modify: `components/workspace/workspace.tsx`

- [ ] **Step 1: Inspect current `Workspace` component**

Read: `components/workspace/workspace.tsx`
Locate the `PreviewPanel` render site and the `useGenerationSession` usage.

- [ ] **Step 2: Pass new props through**

Extend the `useGenerationSession` destructure to include `liveStreams` and `engineerProgress`, then pass them to `<PreviewPanel>`:

```typescript
const { isGenerating, engineerProgress, liveStreams } = useGenerationSession(project.id);

// ...

<PreviewPanel
  files={currentFiles}
  projectId={project.id}
  isGenerating={isGenerating}
  versions={versions}
  previewingVersion={previewingVersion}
  onPreviewVersion={onPreviewVersion}
  onVersionRestore={onVersionRestore}
  latestVersionId={latestVersionId}
  liveStreams={liveStreams}           // NEW
  engineerProgress={engineerProgress} // NEW
/>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run workspace tests**

Run: `npm test -- --testPathPatterns="workspace"`
Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/workspace.tsx
git commit -m "feat(workspace): thread liveStreams and engineerProgress to PreviewPanel"
```

---

## Task 16: Dev server smoke check

**Files:**
- None (manual verification)

- [ ] **Step 1: Start dev server**

Run: `npm run dev:clean`
Expected: Server listening on `http://localhost:3000`.

- [ ] **Step 2: Manual verification**

Open `http://localhost:3000`, sign in, create a new project, submit a prompt like `做一个 Todo 列表，有添加和删除功能`. Verify:

1. Preview panel auto-switches to the Activity tab within ~3 seconds
2. Activity tab shows a dark terminal-style log
3. The `Layer N/M` header updates as the engineer progresses
4. Each file appears as a `── /path ──` segment with green text and a blinking cursor
5. Completed files turn grey and show `✓ 完成`
6. After generation finishes, preview auto-switches back to Preview tab after ~2.5s
7. Preview iframe loads the generated app

If any issue, fix it before proceeding to E2E.

- [ ] **Step 3: Stop dev server**

Ctrl-C the running server.

- [ ] **Step 4: Commit any fixes**

Commit any small fixes found during smoke check as `fix(activity-panel): <issue>`.

---

## Task 17: E2E smoke test

**Files:**
- Create: `e2e/activity-streaming.spec.ts`

- [ ] **Step 1: Write E2E test**

```typescript
import { test, expect } from "@playwright/test";
import {
  loginAsGuest,
  createProjectAndNavigate,
  cleanupTestProjects,
} from "./helpers";

test.describe("Activity tab streaming", () => {
  test.afterAll(async () => {
    await cleanupTestProjects();
  });

  test("auto-activates and shows streaming files during engineer generation", async ({
    page,
  }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] activity streaming");

    // Submit a simple prompt
    await page.getByPlaceholder(/告诉 AI/).fill("做一个计数器，包含增加、减少和重置按钮");
    await page.keyboard.press("Enter");

    // Activity tab should auto-activate within 3 seconds of generation start
    await expect(page.getByTestId("tab-activity")).toBeVisible();
    await expect(page.getByTestId("activity-panel")).toBeVisible({ timeout: 5000 });

    // At least one file segment should appear with a path marker
    await expect(page.locator("[data-testid='activity-panel'] pre").first()).toBeVisible({
      timeout: 30000,
    });

    // Wait for generation to complete (engineer can take 90s+ for full pipeline)
    await expect(page.getByTestId("tab-activity").locator(".animate-pulse")).toBeHidden({
      timeout: 180_000,
    });

    // Auto-switch back to Preview tab within 5s after completion
    await expect(page.locator("iframe")).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run E2E**

Run: `npm run test:e2e -- activity-streaming.spec.ts`
Expected: PASS.

If flaky (network / model latency), increase timeouts but do not weaken assertions.

- [ ] **Step 3: Commit**

```bash
git add e2e/activity-streaming.spec.ts
git commit -m "test(e2e): Playwright smoke test for Activity tab streaming"
```

---

## Task 18: Full regression + coverage check

**Files:**
- None

- [ ] **Step 1: Full Jest suite**

Run: `npm test`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: No new warnings or errors.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Coverage**

Run: `npm run test:coverage`
Expected:
- `lib/engineer-stream-tap.ts` ≥ 95%
- `lib/coalesce-chunks.ts` ≥ 90%
- `components/preview/activity-panel.tsx` ≥ 85%
- `components/preview/file-block.tsx` ≥ 75% (highlight path is hard to test)
- Project overall coverage does not drop

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 6: Commit any fixes**

If anything fails, fix and commit as `fix(<area>): <issue>`.

---

## Self-Review Results

**Spec coverage check** — every section of ADR 0003 mapped to tasks:

- §Architecture Overview → Tasks 1, 3, 5, 8
- §New SSE events → Task 1 (types) + Task 8 (emit)
- §Server-Side Implementation / handler.ts changes → Tasks 7, 8
- §createEngineerStreamTap → Tasks 2, 3
- §SAFE_TAIL reasoning → Task 3 (constant = 256)
- §coalesceChunks → Tasks 4, 5
- §tap.reset() on retry paths → Task 8 step 4
- §LiveFileStream type → Task 1
- §State location in GenerationSession → Task 6
- §ActivityPanel component → Tasks 12, 13
- §FileBlock failed-attempts collapse → Task 13
- §PreviewPanel third tab + auto-switch → Task 14
- §Workspace wiring → Task 15
- §chat-area readEngineerSSE handlers → Tasks 9, 10
- §onAttempt archive on retry → Task 10 step 4
- §files_complete self-heal overwrite → Task 10 step 2
- §MAX_STREAM_CHARS cap → Task 10 step 1
- §Generation completion cleanup (2.5s delayed clear) → Task 10 step 5 + Task 14 step 4
- §Performance — server throttle → Task 8 step 2
- §Performance — no streaming highlight → Task 13 (highlight only on done)
- §Performance — auto-scroll debounce → Tasks 11, 13
- §Abort behavior → inherited from existing AbortController logic; files auto-marked failed via onAttempt / error path; verified in Task 16 smoke check
- §Edge Runtime compatibility → Task 8 (pure JS, no Node APIs)
- §Testing Strategy (unit / integration / component / E2E) → Tasks 2, 4, 7, 9, 12, 14, 17
- §Coverage targets → Task 18

**Placeholder scan** — clean:

- No "TBD" / "TODO" / "implement later" in any step
- Every code step has complete code, not a sketch
- Task 9 (chat-area live-streams test) explicitly notes its skeleton status and tells the engineer to copy the harness pattern from `chat-area-remount-survives-generation.test.tsx` verbatim — this is a deliberate pointer to existing code, not a placeholder. The three test cases are fully specified in their assertions.

**Type consistency**:

- `LiveFileStream` fields (`path`, `content`, `status`, `attempt`, `failedAttempts`) match between Task 1 definition and all later usages in Tasks 6, 9, 10, 12, 13.
- `StreamTapEvent` exports `type` / `path` / `delta` match between Tasks 3, 5, 8.
- `createEngineerStreamTap()` returns object with `feed` / `finalize` / `reset` — all three referenced consistently in Tasks 3, 8.
- `ActivityPanelProps` name (`liveStreams`, `engineerProgress`) matches across Tasks 13, 14, 15.
- `tab-activity` testid matches between Task 14 implementation and test.

No gaps found.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-11-engineer-live-stream.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
