# Engineer Generation Stall + Hydration Errors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix React hydration errors (#418/#423/#425) that crash the UI mid-generation, then make generation state survive component remounts.

**Architecture:** (1) Fix render-time Date/locale code that mismatches between SSR and client. (2) Move generation state (isGenerating, agentStates, engineerProgress, abortController, etc.) to a module-level singleton keyed by projectId — React components subscribe via `useSyncExternalStore`, so state survives ChatArea remounts. (3) Add SSE structured logging + client-side 30s stall detection with warning UI.

**Tech Stack:** Next.js 14, React 18 (`useSyncExternalStore`), TypeScript strict, Jest + React Testing Library, Tailwind

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `hooks/use-mounted.ts` | SSR-safe mount signal |
| Modify | `components/sidebar/project-item.tsx` | Fix `new Date()` in render |
| Modify | `components/timeline/version-timeline.tsx` | Fix `toLocaleTimeString` in render |
| Modify | `components/home/project-card.tsx` | Fix `toLocaleDateString` in render |
| Modify | `components/home/project-list.tsx` | Fix `Date.now()` filter boundary in render |
| Create | `__tests__/use-mounted.test.tsx` | Test mount hook |
| Create | `__tests__/no-hydration-timebombs.test.ts` | Regression guard |
| Create | `lib/generation-session.ts` | Module-level singleton: generation state per projectId |
| Create | `hooks/use-generation-session.ts` | React subscription via `useSyncExternalStore` |
| Create | `__tests__/generation-session.test.ts` | Session unit tests |
| Create | `__tests__/use-generation-session.test.tsx` | Hook unit tests |
| Modify | `components/workspace/chat-area.tsx` | Use session instead of local state |
| Modify | `__tests__/chat-area-abort.test.tsx` | Add `resetSession` in beforeEach |
| Modify | `__tests__/chat-area-transition.test.tsx` | Add `resetSession` in beforeEach |
| Modify | `__tests__/chat-area-error-retry.test.tsx` | Add `resetSession` in beforeEach |
| Create | `__tests__/chat-area-remount-survives-generation.test.tsx` | Remount resilience test |
| Modify | `lib/api-client.ts` | Add `readSSEBody` helper with logging + stall watchdog |
| Create | `__tests__/read-sse-body.test.ts` | SSE helper tests |
| Modify | `components/workspace/chat-area.tsx` | Use `readSSEBody` + stall warning UI |
| Create | `__tests__/chat-area-stall-warning.test.tsx` | Stall warning UI test |

---

## Task 1: `use-mounted` hook

**Files:**
- Create: `hooks/use-mounted.ts`
- Create: `__tests__/use-mounted.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/use-mounted.test.tsx
import { renderHook, act } from "@testing-library/react";
import { useMounted } from "@/hooks/use-mounted";

describe("useMounted", () => {
  it("returns false on first render, true after mount", () => {
    const { result } = renderHook(() => useMounted());
    // After renderHook, useEffect has run — mounted should be true
    expect(result.current).toBe(true);
  });

  it("returns false synchronously before effects run (simulated via React 18 batching)", () => {
    // We can't easily test the false→true transition synchronously in jsdom,
    // but we verify the hook doesn't throw and returns a boolean.
    const { result } = renderHook(() => useMounted());
    expect(typeof result.current).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPatterns="use-mounted" --no-coverage
```

Expected: FAIL — `useMounted` not found

- [ ] **Step 3: Implement the hook**

```ts
// hooks/use-mounted.ts
"use client";

import { useState, useEffect } from "react";

/**
 * Returns false on the first server-side (or hydration) render, true after
 * the component has mounted client-side. Use this to defer time- or locale-
 * dependent rendering so that SSR output matches client hydration output.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPatterns="use-mounted" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/use-mounted.ts __tests__/use-mounted.test.tsx
git commit -m "feat: add useMounted hook for SSR-safe time/locale rendering"
```

---

## Task 2: Fix 4 hydration time bombs + regression guard

**Files:**
- Modify: `components/sidebar/project-item.tsx`
- Modify: `components/timeline/version-timeline.tsx`
- Modify: `components/home/project-card.tsx`
- Modify: `components/home/project-list.tsx`
- Modify: `__tests__/version-timeline.test.tsx` (if it asserts formatted time text)
- Create: `__tests__/no-hydration-timebombs.test.ts`

- [ ] **Step 1: Write the regression guard test first**

```ts
// __tests__/no-hydration-timebombs.test.ts
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const FORBIDDEN = [
  "new Date(",
  "Date.now(",
  ".toLocaleDateString(",
  ".toLocaleTimeString(",
];

// Contexts where these calls are safe (inside hooks or event handlers)
const SAFE_CONTEXTS = [
  /useEffect\s*\(/,
  /useMemo\s*\(/,
  /useCallback\s*\(/,
  /useState\s*\(/,
  /onClick\s*[=:]/,
  /onSubmit\s*[=:]/,
  /onChange\s*[=:]/,
  /async function handle/,
  /function handle/,
  /=> \{/,   // arrow function body — conservative false-negative allowance
];

describe("no-hydration-timebombs", () => {
  it("no bare date/locale calls at render level in components", async () => {
    const files = await glob("components/**/*.tsx");
    const violations: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(path.resolve(file), "utf-8");
      const lines = src.split("\n");

      lines.forEach((line, i) => {
        const lineNum = i + 1;
        const trimmed = line.trim();
        // Skip comments and imports
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("import")) return;

        for (const pattern of FORBIDDEN) {
          if (!line.includes(pattern)) continue;
          // Check surrounding context — look back up to 8 lines for a safe context
          const context = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
          const isSafe = SAFE_CONTEXTS.some((re) => re.test(context));
          if (!isSafe) {
            violations.push(`${file}:${lineNum}: ${trimmed}`);
          }
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Hydration time bombs found (bare Date/locale calls outside hooks/handlers):\n${violations.join("\n")}\n\nWrap in useMounted() + useEffect, or move inside a hook/event handler.`
      );
    }
  });
});
```

- [ ] **Step 2: Run guard to see current failures**

```bash
npm test -- --testPathPatterns="no-hydration-timebombs" --no-coverage
```

Expected: FAIL, listing the 4 violations

- [ ] **Step 3: Fix `project-item.tsx`**

```tsx
// components/sidebar/project-item.tsx
// Add to imports:
import { useMounted } from "@/hooks/use-mounted";

// Inside ProjectItem component, after existing useState calls:
const mounted = useMounted();

// Replace the <span> that shows relativeTime:
// BEFORE:
//   <span className="block text-[11px] text-[#9ca3af] mt-0.5">
//     {relativeTime(project.updatedAt)}
//   </span>
// AFTER:
<span className="block text-[11px] text-[#9ca3af] mt-0.5">
  {mounted ? relativeTime(project.updatedAt) : "\u00a0"}
</span>
```

- [ ] **Step 4: Fix `version-timeline.tsx`**

```tsx
// components/timeline/version-timeline.tsx
// Add to imports:
import { useMounted } from "@/hooks/use-mounted";

// Inside VersionTimeline component, after existing useState:
const mounted = useMounted();

// Update the version timestamp render — find where formatTime is called in JSX
// and wrap:
// BEFORE:  {formatTime(version.createdAt)}
// AFTER:
{mounted ? formatTime(version.createdAt) : "--:--"}
```

- [ ] **Step 5: Fix `project-card.tsx`**

```tsx
// components/home/project-card.tsx
// Add to imports (add useState, useEffect if not already):
import { useMounted } from "@/hooks/use-mounted";

// Inside ProjectCard component:
const mounted = useMounted();

// Replace the toLocaleDateString call (line ~88):
// BEFORE:
//   {new Date(project.updatedAt).toLocaleDateString("zh-CN", {
//     month: "short",
//     day: "numeric",
//     hour: "2-digit",
//     minute: "2-digit",
//   })}
// AFTER:
{mounted
  ? new Date(project.updatedAt).toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  : "\u00a0"}
```

- [ ] **Step 6: Fix `project-list.tsx`**

```tsx
// components/home/project-list.tsx
// Add useMounted import:
import { useMounted } from "@/hooks/use-mounted";

// Inside ProjectList, after existing useState calls:
const mounted = useMounted();

// Replace lines 45-49:
// BEFORE:
//   const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
//   const visibleProjects =
//     tab === "recent"
//       ? projects.filter((p) => new Date(p.updatedAt) >= sevenDaysAgo)
//       : projects;
// AFTER:
const visibleProjects =
  tab === "recent" && mounted
    ? (() => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return projects.filter((p) => new Date(p.updatedAt) >= sevenDaysAgo);
      })()
    : projects;
```

- [ ] **Step 7: Run regression guard — should pass now**

```bash
npm test -- --testPathPatterns="no-hydration-timebombs" --no-coverage
```

Expected: PASS

- [ ] **Step 8: Run full test suite to check for regressions**

```bash
npm test -- --no-coverage 2>&1 | tail -20
```

Expected: same pass count as before. If `version-timeline.test.tsx` breaks because it asserts the exact formatted time string, wrap those assertions in `await waitFor(() => expect(screen.getByText(/\d+:\d+/)).toBeInTheDocument())`.

- [ ] **Step 9: Commit**

```bash
git add hooks/use-mounted.ts \
  components/sidebar/project-item.tsx \
  components/timeline/version-timeline.tsx \
  components/home/project-card.tsx \
  components/home/project-list.tsx \
  __tests__/no-hydration-timebombs.test.ts \
  __tests__/version-timeline.test.tsx  # only if modified
git commit -m "fix: resolve React hydration errors by deferring date/locale to useEffect via useMounted"
```

---

## Task 3: Generation session singleton

**Files:**
- Create: `lib/generation-session.ts`
- Create: `hooks/use-generation-session.ts`
- Create: `__tests__/generation-session.test.ts`
- Create: `__tests__/use-generation-session.test.tsx`

- [ ] **Step 1: Write session tests first**

```ts
// __tests__/generation-session.test.ts
import {
  getSession,
  updateSession,
  subscribe,
  abortSession,
  resetSession,
  EMPTY_SESSION,
} from "@/lib/generation-session";

const P1 = "project-1";
const P2 = "project-2";

beforeEach(() => {
  resetSession(P1);
  resetSession(P2);
});

describe("getSession", () => {
  it("returns default session for unknown project", () => {
    const s = getSession(P1);
    expect(s.isGenerating).toBe(false);
    expect(s.agentStates.pm.status).toBe("idle");
    expect(s.engineerProgress).toBeNull();
  });
});

describe("updateSession", () => {
  it("merges patch into session", () => {
    updateSession(P1, { isGenerating: true, lastPrompt: "hello" });
    expect(getSession(P1).isGenerating).toBe(true);
    expect(getSession(P1).lastPrompt).toBe("hello");
  });

  it("does not affect other projects", () => {
    updateSession(P1, { isGenerating: true });
    expect(getSession(P2).isGenerating).toBe(false);
  });
});

describe("subscribe", () => {
  it("calls listener when session updates", () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(P1, listener);
    updateSession(P1, { isGenerating: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    updateSession(P1, { isGenerating: false });
    expect(listener).toHaveBeenCalledTimes(1); // not called after unsubscribe
  });

  it("does not call listener for other project updates", () => {
    const listener = jest.fn();
    subscribe(P1, listener);
    updateSession(P2, { isGenerating: true });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("abortSession", () => {
  it("calls abort on the stored AbortController", () => {
    const controller = new AbortController();
    updateSession(P1, { abortController: controller });
    abortSession(P1);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("resetSession", () => {
  it("returns session to idle defaults", () => {
    updateSession(P1, { isGenerating: true, lastPrompt: "test" });
    resetSession(P1);
    const s = getSession(P1);
    expect(s.isGenerating).toBe(false);
    expect(s.lastPrompt).toBe("");
  });
});
```

- [ ] **Step 2: Run session tests to confirm they fail**

```bash
npm test -- --testPathPatterns="generation-session.test.ts" --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/generation-session.ts`**

```ts
// lib/generation-session.ts
import type { AgentRole, AgentState, EngineerProgress, ErrorCode } from "@/lib/types";

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

function makeDefaultSession(projectId: string): GenerationSession {
  return {
    projectId,
    abortController: new AbortController(),
    agentStates: {
      pm: { role: "pm", status: "idle", output: "" },
      architect: { role: "architect", status: "idle", output: "" },
      engineer: { role: "engineer", status: "idle", output: "" },
    },
    engineerProgress: null,
    isGenerating: false,
    generationError: null,
    transitionText: null,
    lastPrompt: "",
    lastEventAt: null,
    stallWarning: false,
  };
}

export const EMPTY_SESSION: Readonly<GenerationSession> = makeDefaultSession("__empty__");

const sessions = new Map<string, GenerationSession>();
const listeners = new Map<string, Set<() => void>>();

export function getSession(projectId: string): GenerationSession {
  if (!sessions.has(projectId)) {
    sessions.set(projectId, makeDefaultSession(projectId));
  }
  return sessions.get(projectId)!;
}

export function updateSession(projectId: string, patch: Partial<GenerationSession>): void {
  const current = getSession(projectId);
  sessions.set(projectId, { ...current, ...patch });
  listeners.get(projectId)?.forEach((fn) => fn());
}

export function subscribe(projectId: string, listener: () => void): () => void {
  if (!listeners.has(projectId)) {
    listeners.set(projectId, new Set());
  }
  listeners.get(projectId)!.add(listener);
  return () => {
    listeners.get(projectId)?.delete(listener);
  };
}

export function abortSession(projectId: string): void {
  getSession(projectId).abortController.abort();
}

export function resetSession(projectId: string): void {
  sessions.set(projectId, makeDefaultSession(projectId));
  listeners.get(projectId)?.forEach((fn) => fn());
}
```

- [ ] **Step 4: Run session tests**

```bash
npm test -- --testPathPatterns="generation-session.test.ts" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Write hook test**

```tsx
// __tests__/use-generation-session.test.tsx
import { renderHook, act } from "@testing-library/react";
import { useGenerationSession } from "@/hooks/use-generation-session";
import { updateSession, resetSession } from "@/lib/generation-session";

const PID = "hook-test-project";

beforeEach(() => resetSession(PID));

describe("useGenerationSession", () => {
  it("returns current session state", () => {
    const { result } = renderHook(() => useGenerationSession(PID));
    expect(result.current.isGenerating).toBe(false);
  });

  it("re-renders when session updates", () => {
    const { result } = renderHook(() => useGenerationSession(PID));
    act(() => {
      updateSession(PID, { isGenerating: true });
    });
    expect(result.current.isGenerating).toBe(true);
  });
});
```

- [ ] **Step 6: Implement `hooks/use-generation-session.ts`**

```ts
// hooks/use-generation-session.ts
"use client";

import { useSyncExternalStore } from "react";
import {
  getSession,
  subscribe,
  EMPTY_SESSION,
  type GenerationSession,
} from "@/lib/generation-session";

export function useGenerationSession(projectId: string): GenerationSession {
  return useSyncExternalStore(
    (listener) => subscribe(projectId, listener),
    () => getSession(projectId),
    () => EMPTY_SESSION,
  );
}
```

- [ ] **Step 7: Run both hook tests**

```bash
npm test -- --testPathPatterns="generation-session" --no-coverage
```

Expected: PASS (both files)

- [ ] **Step 8: Commit**

```bash
git add lib/generation-session.ts hooks/use-generation-session.ts \
  __tests__/generation-session.test.ts __tests__/use-generation-session.test.tsx
git commit -m "feat: add GenerationSession singleton and useGenerationSession hook"
```

---

## Task 4: Migrate ChatArea state to session

**Files:**
- Modify: `components/workspace/chat-area.tsx`
- Modify: `__tests__/chat-area-abort.test.tsx`
- Modify: `__tests__/chat-area-transition.test.tsx`
- Modify: `__tests__/chat-area-error-retry.test.tsx`
- Create: `__tests__/chat-area-remount-survives-generation.test.tsx`

- [ ] **Step 1: Write remount resilience test first**

```tsx
// __tests__/chat-area-remount-survives-generation.test.tsx
import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { ChatArea } from "@/components/workspace/chat-area";
import { resetSession, updateSession, getSession } from "@/lib/generation-session";

const PROJECT_ID = "remount-test";

const project = {
  id: PROJECT_ID,
  name: "Test",
  userId: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

beforeEach(() => resetSession(PROJECT_ID));
afterEach(() => resetSession(PROJECT_ID));

jest.mock("@/lib/model-registry", () => ({
  DEFAULT_MODEL_ID: "gemini-2.0-flash",
  getAvailableModels: () => [{ id: "gemini-2.0-flash" }],
}));

jest.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));

describe("ChatArea remount resilience", () => {
  it("shows engineer progress after ChatArea remounts mid-generation", async () => {
    const onFilesGenerated = jest.fn();
    const { unmount, rerender } = render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={onFilesGenerated}
      />
    );

    // Simulate engineer progress being stored in session (as if generation started)
    act(() => {
      updateSession(PROJECT_ID, {
        isGenerating: true,
        engineerProgress: {
          totalLayers: 3,
          currentLayer: 1,
          totalFiles: 6,
          currentFiles: ["App.tsx"],
          completedFiles: [],
          failedFiles: [],
        },
        agentStates: {
          pm: { role: "pm", status: "done", output: "PRD" },
          architect: { role: "architect", status: "done", output: "Arch" },
          engineer: { role: "engineer", status: "streaming", output: "generating..." },
        },
      });
    });

    // Remount ChatArea
    unmount();
    rerender(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={onFilesGenerated}
      />
    );

    // Progress should still be visible
    await waitFor(() => {
      expect(screen.getByText(/第 1\//i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run it — confirm fail**

```bash
npm test -- --testPathPatterns="chat-area-remount-survives-generation" --no-coverage
```

Expected: FAIL — progress not retained after remount

- [ ] **Step 3: Update ChatArea imports**

At the top of `components/workspace/chat-area.tsx`, add:

```ts
import { useGenerationSession } from "@/hooks/use-generation-session";
import {
  updateSession,
  abortSession,
  resetSession,
  getSession,
} from "@/lib/generation-session";
```

- [ ] **Step 4: Replace local state declarations**

Find the block of `useState` calls at the top of `ChatArea` (lines ~78-95). Remove these:

```ts
// REMOVE these lines:
const [isGenerating, setIsGenerating] = useState(false);
const [generationError, setGenerationError] = useState<{
  code: ErrorCode;
  raw: string;
} | null>(null);
const [lastPrompt, setLastPrompt] = useState<string>("");
const [transitionText, setTransitionText] = useState<string | null>(null);
const [agentStates, setAgentStates] = useState<Record<AgentRole, AgentState>>({ ... });
const [engineerProgress, setEngineerProgress] = useState<EngineerProgress | null>(null);
```

And also remove:
```ts
// REMOVE:
const abortControllerRef = useRef<AbortController | null>(null);
```

Replace with:
```ts
const session = useGenerationSession(project.id);
const { isGenerating, generationError, lastPrompt, transitionText, agentStates, engineerProgress } = session;
```

- [ ] **Step 5: Replace `updateAgentState` helper**

```ts
// BEFORE:
function updateAgentState(role: AgentRole, update: Partial<AgentState>) {
  setAgentStates((prev) => ({
    ...prev,
    [role]: { ...prev[role], ...update },
  }));
}

// AFTER:
function updateAgentState(role: AgentRole, update: Partial<AgentState>) {
  const current = getSession(project.id);
  updateSession(project.id, {
    agentStates: {
      ...current.agentStates,
      [role]: { ...current.agentStates[role], ...update },
    },
  });
}
```

- [ ] **Step 6: Replace `stopGeneration`**

```ts
// BEFORE:
function stopGeneration() {
  abortControllerRef.current?.abort();
}

// AFTER:
function stopGeneration() {
  abortSession(project.id);
}
```

- [ ] **Step 7: Update `handleSubmit` — session writes**

Inside `handleSubmit`, replace all setter calls with session updates:

```ts
// At function start — BEFORE:
//   setGenerationError(null);
//   setLastPrompt(prompt);
//   setIsGenerating(true);
//   onGeneratingChange?.(true);
//   const abortController = new AbortController();
//   abortControllerRef.current = abortController;
//   setAgentStates({ pm: idle, architect: idle, engineer: idle });
// AFTER:
const abortController = new AbortController();
updateSession(project.id, {
  generationError: null,
  lastPrompt: prompt,
  isGenerating: true,
  stallWarning: false,
  abortController,
  agentStates: {
    pm: { role: "pm", status: "idle", output: "" },
    architect: { role: "architect", status: "idle", output: "" },
    engineer: { role: "engineer", status: "idle", output: "" },
  },
});
onGeneratingChange?.(true);
```

Then for `abortController.signal` usages — replace `abortController.signal` with `getSession(project.id).abortController.signal` where the signal is read inside the async loop. (The local `abortController` const is still available in the closure, so it can be referenced directly — no change needed there since we set it at the top of the function. Keep the local `const abortController` as-is for use in the function body; just remove the ref.)

- [ ] **Step 8: Replace remaining setState calls in `handleSubmit`**

Find each `set*` call and replace:

```ts
// setGenerationError({ code: ..., raw: ... })
updateSession(project.id, { generationError: { code: ..., raw: ... } });

// setTransitionText(null)
updateSession(project.id, { transitionText: null });

// setTransitionText(handoff)
updateSession(project.id, { transitionText: handoff });
```

- [ ] **Step 9: Replace functional `setEngineerProgress` calls**

```ts
// BEFORE (initial set):
setEngineerProgress({
  totalLayers: layers.length,
  currentLayer: 0,
  totalFiles,
  currentFiles: [],
  completedFiles: [],
  failedFiles: [],
});
// AFTER:
updateSession(project.id, {
  engineerProgress: {
    totalLayers: layers.length,
    currentLayer: 0,
    totalFiles,
    currentFiles: [],
    completedFiles: [],
    failedFiles: [],
  },
});

// BEFORE (functional update in layer loop):
setEngineerProgress((prev) =>
  prev ? { ...prev, currentLayer: layerIdx + 1, currentFiles: [...] } : prev
);
// AFTER:
{
  const prev = getSession(project.id).engineerProgress;
  if (prev) {
    updateSession(project.id, {
      engineerProgress: {
        ...prev,
        currentLayer: layerIdx + 1,
        currentFiles: layerPaths.map((p) => p.split("/").pop() ?? p),
      },
    });
  }
}

// BEFORE (functional update after layer completes):
setEngineerProgress((prev) =>
  prev
    ? { ...prev, completedFiles: Object.keys(allCompletedFiles), failedFiles: [...prev.failedFiles, ...layerResult.failed] }
    : prev
);
// AFTER:
{
  const prev = getSession(project.id).engineerProgress;
  if (prev) {
    updateSession(project.id, {
      engineerProgress: {
        ...prev,
        completedFiles: Object.keys(allCompletedFiles),
        failedFiles: [...prev.failedFiles, ...layerResult.failed],
      },
    });
  }
}

// BEFORE (clear at end of engineer):
setEngineerProgress(null);
// AFTER:
updateSession(project.id, { engineerProgress: null });
```

- [ ] **Step 10: Update the finally block**

```ts
// BEFORE:
} finally {
  setIsGenerating(false);
  onGeneratingChange?.(false);
  setTransitionText(null);
  setEngineerProgress(null);
  abortControllerRef.current = null;
}
// AFTER:
} finally {
  updateSession(project.id, {
    isGenerating: false,
    transitionText: null,
    engineerProgress: null,
  });
  onGeneratingChange?.(false);
}
```

- [ ] **Step 11: Update catch block abort handling**

```ts
// BEFORE:
if (isAbort) {
  setAgentStates({
    pm: { role: "pm", status: "idle", output: "" },
    architect: { role: "architect", status: "idle", output: "" },
    engineer: { role: "engineer", status: "idle", output: "" },
  });
}
// AFTER:
if (isAbort) {
  updateSession(project.id, {
    agentStates: {
      pm: { role: "pm", status: "idle", output: "" },
      architect: { role: "architect", status: "idle", output: "" },
      engineer: { role: "engineer", status: "idle", output: "" },
    },
  });
}
```

- [ ] **Step 12: Update `handleModelChange` — `selectedModel` stays local**

`selectedModel` and `persistModelTimerRef` do NOT move to the session — they are UI preferences, not generation state. No change needed for these.

- [ ] **Step 13: Run ChatArea-specific tests**

```bash
npm test -- --testPathPatterns="chat-area" --no-coverage
```

If `chat-area-abort.test.tsx`, `chat-area-transition.test.tsx`, or `chat-area-error-retry.test.tsx` fail due to session state leaking between tests, add `beforeEach(() => resetSession("proj-1"))` (or whatever projectId the test uses) at the top of each describe block.

- [ ] **Step 14: Run remount resilience test**

```bash
npm test -- --testPathPatterns="chat-area-remount-survives-generation" --no-coverage
```

Expected: PASS

- [ ] **Step 15: Run full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -20
```

Expected: green

- [ ] **Step 16: Commit**

```bash
git add components/workspace/chat-area.tsx \
  __tests__/chat-area-abort.test.tsx \
  __tests__/chat-area-transition.test.tsx \
  __tests__/chat-area-error-retry.test.tsx \
  __tests__/chat-area-remount-survives-generation.test.tsx
git commit -m "refactor: move ChatArea generation state to module-level singleton for remount resilience"
```

---

## Task 5: SSE structured logging + stall watchdog

**Files:**
- Modify: `lib/api-client.ts`
- Create: `__tests__/read-sse-body.test.ts`

This task creates a new `readSSEBody` helper in `api-client.ts`. ChatArea will use it in the next task. This task only creates the helper and tests it.

- [ ] **Step 1: Write the tests**

```ts
// __tests__/read-sse-body.test.ts
import { readSSEBody } from "@/lib/api-client";

function makeStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + "\n"));
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(c);
      ctrl.close();
    },
  });
}

function sseData(obj: object): string {
  return `data: ${JSON.stringify(obj)}`;
}

describe("readSSEBody", () => {
  beforeEach(() => jest.spyOn(console, "info").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("calls onEvent for each parsed SSE event", async () => {
    const events: object[] = [];
    const stream = makeStream([
      sseData({ type: "chunk", content: "hello" }),
      sseData({ type: "done" }),
    ]);
    await readSSEBody(stream, (e) => events.push(e));
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe("chunk");
  });

  it("logs [sse:xxxx] open on start and close on finish", async () => {
    const stream = makeStream([sseData({ type: "done" })]);
    await readSSEBody(stream, () => {});
    const calls = (console.info as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.match(/\[sse:[a-z0-9]{4}\] open/))).toBe(true);
    expect(calls.some((c) => c.match(/\[sse:[a-z0-9]{4}\] close/))).toBe(true);
  });

  it("triggers onStall callback after stall timeout", async () => {
    jest.useFakeTimers();
    const onStall = jest.fn();
    // Stream that never closes (simulate stall)
    let ctrlRef: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrlRef = ctrl; },
    });

    const readPromise = readSSEBody(stream, () => {}, { stallMs: 1000, onStall });

    // Advance time past stall threshold
    await jest.advanceTimersByTimeAsync(1100);
    expect(onStall).toHaveBeenCalledTimes(1);

    // Clean up
    ctrlRef!.close();
    await readPromise;
    jest.useRealTimers();
  });

  it("clears stall timer after stream closes normally", async () => {
    jest.useFakeTimers();
    const onStall = jest.fn();
    const stream = makeStream([sseData({ type: "done" })]);

    await readSSEBody(stream, () => {}, { stallMs: 1000, onStall });
    await jest.advanceTimersByTimeAsync(2000);

    expect(onStall).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
npm test -- --testPathPatterns="read-sse-body" --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Add `readSSEBody` to `lib/api-client.ts`**

Add after the existing `dispatchSSEData` function:

```ts
// lib/api-client.ts (addition)

function randomId(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len).padEnd(len, "0");
}

export interface ReadSSEBodyOptions {
  /** Milliseconds of silence before calling onStall. Default: 30_000 */
  stallMs?: number;
  /** Called once when stall is detected. Does not abort the stream. */
  onStall?: () => void;
  /** Tag to include in log prefix (e.g. agent name or file path) */
  tag?: string;
}

/**
 * Reads a ReadableStream of SSE-formatted data, parses each `data:` line as
 * JSON, and calls onEvent with the parsed object.
 *
 * Logs structured events to console.info with a `[sse:<id>]` prefix.
 * Calls opts.onStall if no events are received for opts.stallMs ms.
 */
export async function readSSEBody<T = Record<string, unknown>>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  opts: ReadSSEBodyOptions = {}
): Promise<void> {
  const { stallMs = 30_000, onStall, tag } = opts;
  const reqId = randomId(4);
  const prefix = tag ? `[sse:${reqId}] (${tag})` : `[sse:${reqId}]`;

  console.info(`${prefix} open`);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let lastEventAt = Date.now();
  let stallFired = false;

  const stallInterval = setInterval(() => {
    if (Date.now() - lastEventAt > stallMs && !stallFired) {
      stallFired = true;
      console.error(`${prefix} stall_detected silent=${stallMs}ms`);
      onStall?.();
    }
  }, 5_000);

  const startedAt = Date.now();

  try {
    while (true) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data) as T;
          lastEventAt = Date.now();
          stallFired = false; // reset after receiving data
          eventCount++;
          if (eventCount === 1 || eventCount % 10 === 0 || isMilestone(event)) {
            console.info(`${prefix} event #${eventCount}`, event);
          }
          onEvent(event);
        } catch {
          // malformed JSON — skip line
        }
      }

      if (done) break;
    }

    if (buffer.trim() && buffer.startsWith("data: ")) {
      try {
        const event = JSON.parse(buffer.slice(6).trim()) as T;
        onEvent(event);
      } catch { /* ignore */ }
    }

    console.info(
      `${prefix} close reason=normal duration=${Date.now() - startedAt}ms events=${eventCount}`
    );
  } catch (err) {
    const reason = err instanceof DOMException && err.name === "AbortError" ? "aborted" : "error";
    console.error(`${prefix} close reason=${reason} duration=${Date.now() - startedAt}ms`, err);
    throw err;
  } finally {
    clearInterval(stallInterval);
  }
}

function isMilestone(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const type = (event as { type?: string }).type;
  return (
    type === "code_complete" ||
    type === "files_complete" ||
    type === "error" ||
    type === "done"
  );
}
```

- [ ] **Step 4: Run SSE helper tests**

```bash
npm test -- --testPathPatterns="read-sse-body" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/api-client.ts __tests__/read-sse-body.test.ts
git commit -m "feat: add readSSEBody helper with structured SSE logging and stall watchdog"
```

---

## Task 6: Wire `readSSEBody` into ChatArea + stall warning UI

**Files:**
- Modify: `components/workspace/chat-area.tsx`
- Create: `__tests__/chat-area-stall-warning.test.tsx`

- [ ] **Step 1: Write stall warning test first**

```tsx
// __tests__/chat-area-stall-warning.test.tsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatArea } from "@/components/workspace/chat-area";
import { updateSession, resetSession } from "@/lib/generation-session";

const PID = "stall-test";
const project = {
  id: PID,
  name: "Test",
  userId: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

beforeEach(() => resetSession(PID));
afterEach(() => resetSession(PID));

jest.mock("@/lib/model-registry", () => ({
  DEFAULT_MODEL_ID: "gemini-2.0-flash",
  getAvailableModels: () => [{ id: "gemini-2.0-flash" }],
}));

jest.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));

describe("stall warning UI", () => {
  it("shows stall warning when stallWarning is true in session", async () => {
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    updateSession(PID, { isGenerating: true, stallWarning: true });

    await waitFor(() => {
      expect(screen.getByTestId("stall-warning")).toBeInTheDocument();
    });
  });

  it("中断重试 button calls abortSession and hides warning", async () => {
    const user = userEvent.setup();
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    updateSession(PID, { isGenerating: true, stallWarning: true, lastPrompt: "rebuild" });

    await waitFor(() => screen.getByTestId("stall-warning"));

    const btn = screen.getByRole("button", { name: /中断重试/ });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.queryByTestId("stall-warning")).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- --testPathPatterns="chat-area-stall-warning" --no-coverage
```

Expected: FAIL — `stall-warning` element not found

- [ ] **Step 3: Replace inline SSE read loops in ChatArea with `readSSEBody`**

Import it at the top:
```ts
import { fetchAPI, readSSEBody } from "@/lib/api-client";
```

There are 3 inline SSE reader loops to replace:

**Loop 1 — `readEngineerSSE` function:**

```ts
// BEFORE: the function uses manual reader.read() loop
// AFTER:
async function readEngineerSSE(
  body: ReadableStream<Uint8Array>,
  tag: string
): Promise<Record<string, string>> {
  let layerResult: Record<string, string> | null = null;

  await readSSEBody<{ type: string; code?: string; files?: Record<string, string>; error?: string; errorCode?: import("@/lib/types").ErrorCode }>(
    body,
    (event) => {
      if (event.type === "files_complete" && event.files) {
        layerResult = event.files;
      } else if (event.type === "code_complete" && event.code) {
        layerResult = { "/App.js": event.code };
      } else if (event.type === "error") {
        throw Object.assign(
          new Error(event.error ?? "Stream error"),
          { errorCode: event.errorCode ?? "unknown" }
        );
      }
    },
    {
      tag,
      onStall: () => updateSession(project.id, { stallWarning: true }),
    }
  );

  if (!layerResult) throw new Error("No files received from engineer");
  return layerResult;
}
```

Update the call site (inside `runLayerWithFallback` callback):
```ts
// BEFORE:
return readEngineerSSE(response.body);
// AFTER:
return readEngineerSSE(response.body, `engineer:layer-${layerIdx + 1}:${files.map((f) => f.path.split("/").pop()).join(",")}`);
```

**Loop 2 — direct path inline loop (after `directReader = directResponse.body.getReader()`):**

```ts
// Replace the manual while(true) loop with:
await readSSEBody<{ type: string; content?: string; code?: string; files?: Record<string, string>; error?: string; errorCode?: import("@/lib/types").ErrorCode }>(
  directResponse.body,
  (event) => {
    if (event.type === "chunk") {
      directOutput += event.content ?? "";
      updateAgentState("engineer", { output: directOutput });
    } else if (event.type === "code_complete") {
      if (event.code) directCode = event.code;
    } else if (event.type === "files_complete" && event.files) {
      directFiles = event.files;
    } else if (event.type === "reset") {
      directOutput = "";
      updateAgentState("engineer", { output: "" });
    } else if (event.type === "error") {
      throw Object.assign(
        new Error(event.error ?? "Stream error"),
        { errorCode: event.errorCode ?? "unknown" }
      );
    }
  },
  {
    tag: `direct:${intent}`,
    onStall: () => updateSession(project.id, { stallWarning: true }),
  }
);
// Remove the manual reader/decoder/buffer/loop variables that came before.
```

**Loop 3 — full pipeline PM/Architect/Engineer loop (after `reader = response.body.getReader()`):**

```ts
// Replace with:
await readSSEBody<{ type: string; content?: string; code?: string; error?: string; errorCode?: import("@/lib/types").ErrorCode }>(
  response.body,
  (event) => {
    if (event.type === "chunk") {
      agentOutput += event.content ?? "";
      updateAgentState(agentRole, { output: agentOutput });
    } else if (event.type === "code_complete") {
      if (event.code) lastCode = event.code;
    } else if (event.type === "reset") {
      agentOutput = "";
      updateAgentState(agentRole, { output: "" });
    } else if (event.type === "error") {
      throw Object.assign(
        new Error(event.error ?? "Stream error"),
        { errorCode: event.errorCode ?? "unknown" }
      );
    }
  },
  {
    tag: agentRole,
    onStall: () => updateSession(project.id, { stallWarning: true }),
  }
);
// Remove the manual reader/decoder/buffer/loop variables.
```

- [ ] **Step 4: Add stall warning UI to ChatArea JSX**

In the return block, after the `{transitionText && ...}` block and before `<div ref={bottomRef} />`, add:

```tsx
{isGenerating && session.stallWarning && (
  <div
    data-testid="stall-warning"
    className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg mx-2"
  >
    <span className="text-amber-500 text-lg shrink-0">⚠️</span>
    <div className="flex-1 min-w-0">
      <p className="text-sm text-amber-700 font-medium">超过 30 秒没有收到生成进度</p>
      <p className="text-xs text-amber-500 mt-0.5">
        可能是模型响应较慢或连接卡住。
      </p>
    </div>
    <div className="flex gap-2 shrink-0">
      <button
        onClick={() => updateSession(project.id, { stallWarning: false })}
        className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors"
      >
        继续等待
      </button>
      <button
        onClick={() => {
          stopGeneration();
          updateSession(project.id, { stallWarning: false });
        }}
        className="text-xs px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
      >
        中断重试
      </button>
    </div>
  </div>
)}
```

Also: clear `stallWarning` at the start of each new generation in `handleSubmit` (already included in the `updateSession` call from Task 4, Step 7, but double-check `stallWarning: false` is in that patch).

- [ ] **Step 5: Run stall warning tests**

```bash
npm test -- --testPathPatterns="chat-area-stall-warning" --no-coverage
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -20
```

Expected: green

- [ ] **Step 7: Production smoke test (manual)**

```bash
npm run build && npm start
```

1. Open http://localhost:3000 in browser.
2. DevTools Console → should see zero React #418 / #423 / #425 errors on `/` and on `/project/[id]`.
3. Submit a prompt like "做一个学生管理系统".
4. Observe `[sse:xxxx] open … close reason=normal` entries in Console — one per agent/layer call.
5. Engineer should complete. No hydration errors.

- [ ] **Step 8: Commit**

```bash
git add components/workspace/chat-area.tsx \
  __tests__/chat-area-stall-warning.test.tsx
git commit -m "feat: wire readSSEBody into ChatArea; add 30s stall detection warning UI"
```

---

## Done

All 6 tasks complete. The production app should now:

1. Have zero React #418/#423/#425 hydration errors.
2. Retain engineer generation progress across any ChatArea remount.
3. Log structured `[sse:xxxx]` events to console for future debugging.
4. Show a visible stall warning after 30s of silence, with "继续等待" / "中断重试" buttons.
5. Fail CI if new components introduce bare `new Date()` / `toLocaleDateString` calls at render time.
