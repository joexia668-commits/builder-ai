# Engineer Generation Stall + Hydration Errors — Design Spec

**Date:** 2026-04-11
**Status:** Approved for implementation planning
**Related symptom:** 线上访问 builder-ai，输入"做一个学生管理系统"这类提示后，engineer 阶段长时间卡在第一层；DevTools 控制台出现 React minified errors #418 / #423 / #425。

## Problem

Two possibly-linked symptoms in the deployed app:

1. **Hydration errors in production build.** React errors #418 (hydration failure), #423 (Suspense boundary fell back to client rendering), #425 (text content mismatch) show up in the minified production bundle. These are classic SSR ↔ client render mismatches.
2. **Engineer appears stuck on layer 1.** Users see no progress for an extended period; unclear whether the SSE stream is still alive, the UI lost its state, or the engineer API genuinely hung.

The user cannot recall whether the React errors appear before or after the stall, so we design for both possibilities.

## Root Cause Analysis

Code search found four render-time time/locale operations that produce non-deterministic SSR ↔ client output:

| File | Issue |
|---|---|
| `components/sidebar/project-item.tsx:32` | `new Date()` called during render for relative-time text |
| `components/timeline/version-timeline.tsx:17` | `toLocaleTimeString("zh-CN", …)` — Node and browser Intl data can differ |
| `components/home/project-card.tsx:88` | `toLocaleDateString("zh-CN", …)` — same Intl mismatch |
| `components/home/project-list.tsx:45` | `new Date(Date.now() - 7d)` as filter boundary during render |

When hydration fails in production, React switches to client rendering and may remount client component subtrees. If `ChatArea` remounts mid-generation, its local state (`isGenerating`, `agentStates`, `engineerProgress`, `abortControllerRef`, SSE reader closure) is lost. The SSE fetch may or may not continue — in either case, the UI appears frozen, which matches the "stuck on layer 1" report.

## Goals

1. Eliminate all hydration mismatches from the production build.
2. Make in-progress generation state survive any component remount.
3. Provide observability to diagnose future "engineer is slow" reports within seconds.
4. Prevent regression of hydration time bombs in new components.

## Non-Goals

- Backend heartbeat events from `/api/generate` — the stall detection is client-side only (no route changes).
- Optimizing the engineer API latency itself — out of scope; this spec is about UI resilience and observability, not generation speed.
- Replacing the existing AbortController / circuit breaker logic.

## Design

Four coordinated changes, ordered by implementation commit.

### 1. Hydration fix

**Principle:** All render-time code that depends on current time or browser locale must defer to `useEffect`. First SSR render and first client hydration must produce byte-identical output.

**New utility:** `hooks/use-mounted.ts`

```ts
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}
```

**File changes:**

- `components/sidebar/project-item.tsx` — in the component, `const mounted = useMounted()`. Render `&nbsp;` placeholder for the relative-time span until `mounted`, then show `relativeTime(project.updatedAt)`. Keep the pure `relativeTime()` helper unchanged.
- `components/timeline/version-timeline.tsx` — `useMounted()` + `--:--` placeholder for `formatTime` output until mounted.
- `components/home/project-card.tsx` — `useMounted()` + placeholder until mounted for the `toLocaleDateString` call at line 88.
- `components/home/project-list.tsx` — compute `sevenDaysAgo` inside `useEffect` + `useState`. Before mounted, render the full unfiltered project list (chosen over empty list to minimize visual churn on hydration).

**Why not `suppressHydrationWarning`:** It silences the warning but does not guarantee diff consistency; React may still fall back to client rendering for Suspense boundaries. `useMounted` is the only approach that guarantees a matching first render.

**Why not `typeof window` branching:** Next.js runs SSR without `window` and client hydration with `window` → produces different output on the two passes → same mismatch.

### 2. Generation state lift into module-level singleton

Lifting state to `Workspace` is not enough — `Workspace` is also a client component and can remount. The robust fix is to store the active generation session **outside React** in a module-level singleton, keyed by `projectId`, and subscribe React components to it via `useSyncExternalStore`.

**New module:** `lib/generation-session.ts`

```ts
interface GenerationSession {
  projectId: string;
  abortController: AbortController;
  agentStates: Record<AgentRole, AgentState>;
  engineerProgress: EngineerProgress | null;
  isGenerating: boolean;
  generationError: { code: ErrorCode; raw: string } | null;
  transitionText: string | null;
  lastPrompt: string;
  lastEventAt: number | null;   // added for stall detection (Section 3)
  stallWarning: boolean;        // added for stall detection (Section 3)
}

const sessions = new Map<string, GenerationSession>();
const listeners = new Map<string, Set<() => void>>();

export function getSession(projectId: string): GenerationSession;
export function updateSession(projectId: string, patch: Partial<GenerationSession>): void;
export function subscribe(projectId: string, listener: () => void): () => void;
export function abortSession(projectId: string): void;
export function resetSession(projectId: string): void;
```

`updateSession` notifies all subscribers for that `projectId`. Cross-project isolation is automatic — each `projectId` has its own entry.

**New hook:** `hooks/use-generation-session.ts`

```ts
const EMPTY_SESSION: GenerationSession = { /* deterministic defaults */ };

export function useGenerationSession(projectId: string): GenerationSession {
  return useSyncExternalStore(
    (listener) => subscribe(projectId, listener),
    () => getSession(projectId),
    () => EMPTY_SESSION,  // SSR snapshot — deterministic
  );
}
```

**`ChatArea` refactor:**

- Remove `useState` calls for `isGenerating`, `agentStates`, `engineerProgress`, `generationError`, `transitionText`, `lastPrompt`, and the `abortControllerRef`.
- Replace with `const session = useGenerationSession(project.id);`.
- Rewrite every `setX(…)` call as `updateSession(project.id, { X: … })`.
- SSE read loop logic is otherwise unchanged. The closure captures the session object, which is module-level and survives component remount. If `ChatArea` unmounts and remounts, the new instance immediately reads the latest session snapshot via `useSyncExternalStore` and renders accurate progress.
- `onFilesGenerated` callback still bubbles up to `Workspace` unchanged — `currentFiles` persistence stays where it is.

**Cross-project switching semantics:** Navigating to another project does **not** abort the previous session. The session continues in the background; returning to the original project re-subscribes and shows accurate progress. This matches the "long-running generation, user switches away" use case. Explicit stop / error / completion is the only way a session ends. (Memory footprint is bounded by the number of projects a user opens in one tab session — acceptable.)

### 3. SSE observability + silent-stall detection

**`lib/api-client.ts` — structured SSE logging in `fetchSSE`:**

- Generate a 4-char `requestId` per SSE request.
- `console.info` on open, on every milestone event (`code_complete`, `files_complete`, `error`, `done`), and on close. Rate-limit non-milestone events to one summary per 10 events.
- `console.error` on close-with-error, timeout, or stall detection.
- Log format: `[sse:a3f2] <phase> <key=val> …` for easy grep.
- Enabled in production by default (payload is small, value is high when users report issues).

**Silent-stall watchdog:**

- In the SSE read loop, update `session.lastEventAt = Date.now()` on every event.
- `fetchSSE` owns a `setInterval` started when the SSE connection opens and cleared in a `finally` block when the read loop exits (normal, error, or abort). The interval fires every 5s and checks `Date.now() - lastEventAt`.
- If > 30s with no event: log `[sse:xxxx] stall_detected silent=30s`, call back into `session` to set `stallWarning = true`. Do **not** auto-abort. Reset `stallWarning` to `false` whenever the next real event arrives.
- `ChatArea` reads `session.stallWarning` and renders a warning UI under `AgentStatusBar`:
  > ⚠️ 超过 30 秒没有收到生成进度。可能是模型响应较慢或连接卡住。[继续等待] [中断重试]
- "中断重试" calls `abortSession(projectId)` and re-submits the last prompt.
- "继续等待" dismisses the warning until the next 30s window elapses.

**Why client-side and not server heartbeat:** Zero backend changes. Works even if the Edge runtime stops sending events due to a bug. Catches more failure modes.

### 4. Regression prevention

**New test:** `__tests__/no-hydration-timebombs.test.ts`

- Scans `components/**/*.tsx`.
- Fails if any file contains `new Date(`, `Date.now(`, `.toLocaleDateString(`, or `.toLocaleTimeString(` at module or component-function top level.
- Implementation: regex scan with a lightweight allowlist detector — require the match to be inside a known safe context (`useEffect(`, `useMemo(`, `useState(`, `onClick`, `onSubmit`, event handler props, non-component function definitions). Assume false negatives are acceptable; false positives would block development.
- If grep proves too imprecise, escalate to AST parsing with `@typescript-eslint/parser`. YAGNI until then.

## Testing Plan

**Unit tests (new):**

| File | Covers |
|---|---|
| `__tests__/generation-session.test.ts` | Session map CRUD, subscribe/unsubscribe, per-project isolation, abort cleanup |
| `__tests__/use-generation-session.test.tsx` | `useSyncExternalStore` rerender on update; deterministic SSR snapshot |
| `__tests__/fetch-sse-logging.test.ts` | `console.info` prefix format on open/close/milestone events; stall detection fires after 30s of silence |
| `__tests__/use-mounted.test.tsx` | First render returns false; post-effect returns true |

**Integration tests (new):**

| File | Covers |
|---|---|
| `__tests__/chat-area-remount-survives-generation.test.tsx` | Start PM → Architect → Engineer flow; unmount and remount `ChatArea` between layers; assert progress reappears and `onFilesGenerated` still fires |
| `__tests__/chat-area-stall-warning.test.tsx` | Mock SSE source that sends no events for 30s; assert stall warning UI appears with retry button; retry calls `abortSession` |

**Regression guard (new):**

- `__tests__/no-hydration-timebombs.test.ts` — grep scan described in Section 4.

**Existing test updates:**

- `__tests__/chat-area-abort.test.tsx`, `chat-area-transition.test.tsx`, `chat-area-error-retry.test.tsx`: add `beforeEach(() => resetSession(projectId))` for singleton isolation. DOM assertions unchanged.
- `__tests__/version-timeline.test.tsx`: wrap relative-time assertions in `await waitFor(...)` to allow `useEffect` to run.
- `__tests__/workspace-*.test.tsx`: same `waitFor` adjustment where `ProjectItem` relative-time is asserted.

**Manual production smoke test (PR checklist):**

1. `npm run build && npm start`
2. Open `/` → DevTools Console should show zero React #418 / #423 / #425 errors.
3. Open a project → same check.
4. Submit "做一个学生管理系统" → observe `[sse:xxxx]` log flow; engineer completes without hydration errors; no stall warning appears on happy path.

## Implementation Order

Each step is an independent commit with passing tests:

1. **Hydration fix** (Section 1) — smallest blast radius, direct root-cause fix.
2. **SSE structured logging** (Section 3, observability only) — pure addition, no behavior change.
3. **Silent-stall watchdog + warning UI** (Section 3, detection).
4. **Generation state lift into module singleton** (Section 2) — largest refactor, tests gated.
5. **Hydration regression grep test** (Section 4).
6. Final cleanup and PR.

## Open Questions

None. All decisions confirmed during brainstorming:

- `project-list` pre-mount display: full project list (no filtering).
- Cross-project switching: do not auto-abort background generation.
- SSE logging default: enabled in production.
- Stall threshold: 30s.
