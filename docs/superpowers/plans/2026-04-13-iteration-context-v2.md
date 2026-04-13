# Iteration Context V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist cross-round iteration context (last 5 rounds of PM summaries, Architect decisions, user prompts) in the DB so PM and Architect agents receive history on consecutive `feature_add` iterations.

**Architecture:** Add `iterationContext Json?` column to Project table. After each pipeline run, extract an `IterationRound` (user prompt + PM output + deterministic Arch extraction) and append it. On the next run, inject formatted history into PM and Arch context strings. Replaces the in-memory `lastPmOutput` React state.

**Tech Stack:** Prisma (schema change), TypeScript (extraction logic), React (state wiring)

---

### Task 1: Add types and schema

**Files:**
- Modify: `lib/types.ts:166-202` (after `PmOutput`, before `CompletionOptions`)
- Modify: `prisma/schema.prisma:61-73` (Project model)
- Modify: `lib/types.ts:70-80` (Project interface)

- [ ] **Step 1: Add new type definitions to `lib/types.ts`**

Insert after the `ScaffoldValidationResult` interface (line 207):

```typescript
// Cross-round iteration context (V2)
export interface ArchDecisions {
  readonly fileCount: number;
  readonly componentTree: string;
  readonly stateStrategy: string;
  readonly persistenceSetup: string;
  readonly keyDecisions: readonly string[];
}

export interface IterationRound {
  readonly userPrompt: string;
  readonly intent: Intent;
  readonly pmSummary: PmOutput | null;
  readonly archDecisions: ArchDecisions | null;
  readonly timestamp: string;
}

export interface IterationContext {
  readonly rounds: readonly IterationRound[];
}
```

- [ ] **Step 2: Add `iterationContext` to the Project TS interface**

In `lib/types.ts`, find the `Project` interface (line 70) and add:

```typescript
export interface Project {
  id: string;
  name: string;
  description?: string | null;
  userId: string;
  preferredModel?: string | null;
  iterationContext?: IterationContext | null;  // ← add this line
  createdAt: Date;
  updatedAt: Date;
  messages?: ProjectMessage[];
  versions?: ProjectVersion[];
}
```

- [ ] **Step 3: Add `iterationContext` column to Prisma schema**

In `prisma/schema.prisma`, inside the `Project` model (after `preferredModel`):

```prisma
model Project {
  id               String       @id @default(cuid())
  name             String
  description      String?
  userId           String
  preferredModel   String?
  iterationContext Json?          // ← add this line
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  messages         Message[]
  user             User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  versions         Version[]
  deployments      Deployment[]
}
```

- [ ] **Step 4: Push schema to database**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts prisma/schema.prisma
git commit -m "feat: add IterationContext types and schema column"
```

---

### Task 2: Create `extractArchDecisions`

**Files:**
- Create: `lib/extract-arch-decisions.ts`
- Create: `__tests__/extract-arch-decisions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/extract-arch-decisions.test.ts`:

```typescript
import { extractArchDecisions } from "@/lib/extract-arch-decisions";
import type { ScaffoldData } from "@/lib/types";

const SCAFFOLD: ScaffoldData = {
  files: [
    { path: "/App.js", description: "Root", exports: ["App"], deps: ["/components/TodoList.js", "/components/TodoForm.js"], hints: "" },
    { path: "/components/TodoList.js", description: "List", exports: ["TodoList"], deps: ["/components/TodoItem.js"], hints: "" },
    { path: "/components/TodoItem.js", description: "Item", exports: ["TodoItem"], deps: [], hints: "" },
    { path: "/components/TodoForm.js", description: "Form", exports: ["TodoForm"], deps: [], hints: "" },
  ],
  sharedTypes: "",
  designNotes: "使用 useReducer 管理全局状态。Tab 切换视图。表单用 modal。使用 lucide 图标。",
};

describe("extractArchDecisions", () => {
  it("extracts fileCount from scaffold", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.fileCount).toBe(4);
  });

  it("builds component tree from deps", () => {
    const result = extractArchDecisions(SCAFFOLD);
    // App is the root (nothing imports it)
    expect(result.componentTree).toContain("App");
    expect(result.componentTree).toContain("TodoList");
    expect(result.componentTree).toContain("TodoItem");
  });

  it("infers stateStrategy from designNotes", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.stateStrategy).toBe("useReducer");
  });

  it("infers stateStrategy as useState when no specific keyword", () => {
    const scaffold: ScaffoldData = {
      ...SCAFFOLD,
      designNotes: "简单的状态管理",
    };
    const result = extractArchDecisions(scaffold);
    expect(result.stateStrategy).toBe("unknown");
  });

  it("detects supabase persistence from deps", () => {
    const scaffold: ScaffoldData = {
      ...SCAFFOLD,
      files: [
        ...SCAFFOLD.files,
        { path: "/lib/db.js", description: "DB", exports: ["db"], deps: ["/supabaseClient.js"], hints: "" },
      ],
    };
    const result = extractArchDecisions(scaffold);
    expect(result.persistenceSetup).toBe("supabase");
  });

  it("detects localStorage persistence from designNotes", () => {
    const scaffold: ScaffoldData = {
      ...SCAFFOLD,
      designNotes: "使用 localStorage 持久化数据",
    };
    const result = extractArchDecisions(scaffold);
    expect(result.persistenceSetup).toBe("localStorage");
  });

  it("defaults persistence to none", () => {
    const scaffold: ScaffoldData = {
      ...SCAFFOLD,
      designNotes: "无需持久化",
      files: SCAFFOLD.files, // no supabaseClient dep
    };
    const result = extractArchDecisions(scaffold);
    expect(result.persistenceSetup).toBe("none");
  });

  it("extracts keyDecisions from designNotes", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.keyDecisions.length).toBeGreaterThan(0);
    expect(result.keyDecisions.length).toBeLessThanOrEqual(5);
    expect(result.keyDecisions[0]).toContain("useReducer");
  });

  it("handles empty designNotes gracefully", () => {
    const scaffold: ScaffoldData = { ...SCAFFOLD, designNotes: "" };
    const result = extractArchDecisions(scaffold);
    expect(result.keyDecisions).toEqual([]);
    expect(result.stateStrategy).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-arch-decisions"`
Expected: FAIL — module `@/lib/extract-arch-decisions` does not exist

- [ ] **Step 3: Implement `extractArchDecisions`**

Create `lib/extract-arch-decisions.ts`:

```typescript
import type { ScaffoldData, ScaffoldFile, ArchDecisions } from "@/lib/types";

/**
 * Deterministically extracts architectural decisions from a ScaffoldData.
 * Zero LLM calls — pure code analysis of the scaffold structure.
 */
export function extractArchDecisions(scaffold: ScaffoldData): ArchDecisions {
  return {
    fileCount: scaffold.files.length,
    componentTree: buildComponentTree(scaffold.files),
    stateStrategy: inferStateStrategy(scaffold.designNotes),
    persistenceSetup: inferPersistenceSetup(scaffold),
    keyDecisions: extractKeyDecisions(scaffold.designNotes),
  };
}

/**
 * Builds a human-readable tree string from the deps graph.
 * Root nodes = files that no other file imports.
 * Example: "App -> [TodoList -> [TodoItem], TodoForm]"
 */
function buildComponentTree(files: readonly ScaffoldFile[]): string {
  const allPaths = new Set(files.map((f) => f.path));
  const imported = new Set(files.flatMap((f) => f.deps));
  const roots = files.filter((f) => !imported.has(f.path));

  if (roots.length === 0) {
    // Cycle or no clear root — fallback to flat list
    return files.map((f) => fileName(f.path)).join(", ");
  }

  const fileMap = new Map(files.map((f) => [f.path, f]));

  function buildSubtree(path: string, visited: Set<string>): string {
    const name = fileName(path);
    if (visited.has(path)) return name;
    visited.add(path);

    const file = fileMap.get(path);
    if (!file) return name;

    const children = file.deps.filter((d) => allPaths.has(d));
    if (children.length === 0) return name;

    const childStrings = children.map((c) => buildSubtree(c, visited));
    return `${name} -> [${childStrings.join(", ")}]`;
  }

  return roots
    .map((r) => buildSubtree(r.path, new Set()))
    .join(", ");
}

function fileName(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(js|jsx|ts|tsx)$/, "");
}

function inferStateStrategy(designNotes: string): string {
  const lower = designNotes.toLowerCase();
  if (lower.includes("usereducer")) return "useReducer";
  if (lower.includes("context")) return "context";
  if (lower.includes("usestate")) return "useState";
  return "unknown";
}

function inferPersistenceSetup(scaffold: ScaffoldData): string {
  const hasSupabaseDep = scaffold.files.some((f) =>
    f.deps.some((d) => d.includes("supabaseClient"))
  );
  if (hasSupabaseDep) return "supabase";

  const lower = scaffold.designNotes.toLowerCase();
  if (lower.includes("localstorage")) return "localStorage";

  return "none";
}

function extractKeyDecisions(designNotes: string): readonly string[] {
  if (!designNotes.trim()) return [];

  // Split by Chinese period, regular period, or newline
  const sentences = designNotes
    .split(/[。.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.slice(0, 5);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-arch-decisions"`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/extract-arch-decisions.ts __tests__/extract-arch-decisions.test.ts
git commit -m "feat: add extractArchDecisions — deterministic scaffold analysis"
```

---

### Task 3: Add context builder functions

**Files:**
- Modify: `lib/agent-context.ts`
- Create: `__tests__/agent-context-v2.test.ts`

- [ ] **Step 1: Write failing tests for the new context builders**

Create `__tests__/agent-context-v2.test.ts`:

```typescript
import { buildPmHistoryContext, buildArchIterationContext } from "@/lib/agent-context";
import type { IterationRound, ArchDecisions } from "@/lib/types";

describe("buildPmHistoryContext", () => {
  it("returns empty string for empty rounds", () => {
    expect(buildPmHistoryContext([])).toBe("");
  });

  it("formats full pipeline rounds with PM summary", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "做一个待办应用",
        intent: "new_project",
        pmSummary: {
          intent: "待办事项管理",
          features: ["添加任务", "删除任务"],
          persistence: "localStorage",
          modules: ["TaskList", "TaskForm"],
        },
        archDecisions: null,
        timestamp: "2026-04-13T10:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("当前应用的迭代历史");
    expect(result).toContain("做一个待办应用");
    expect(result).toContain("待办事项管理");
    expect(result).toContain("添加任务");
  });

  it("formats direct path rounds without PM summary", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "把字体改大",
        intent: "style_change",
        pmSummary: null,
        archDecisions: null,
        timestamp: "2026-04-13T10:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("把字体改大");
    expect(result).toContain("样式调整");
  });

  it("formats multiple rounds in order", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "做个待办应用",
        intent: "new_project",
        pmSummary: { intent: "待办", features: ["添加"], persistence: "none", modules: ["List"] },
        archDecisions: null,
        timestamp: "2026-04-13T10:00:00Z",
      },
      {
        userPrompt: "加暗黑模式",
        intent: "feature_add",
        pmSummary: { intent: "主题切换", features: ["暗黑模式"], persistence: "localStorage", modules: ["Theme"] },
        archDecisions: null,
        timestamp: "2026-04-13T11:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("[第1轮]");
    expect(result).toContain("[第2轮]");
    // Round 1 should appear before Round 2
    expect(result.indexOf("做个待办应用")).toBeLessThan(result.indexOf("加暗黑模式"));
  });
});

describe("buildArchIterationContext", () => {
  const decisions: ArchDecisions = {
    fileCount: 12,
    componentTree: "App -> [Sidebar, MainView -> [TodoList, TodoForm]]",
    stateStrategy: "useReducer",
    persistenceSetup: "localStorage",
    keyDecisions: ["Tab切换视图", "表单用modal"],
  };

  it("formats arch decisions into readable context", () => {
    const result = buildArchIterationContext(decisions);
    expect(result).toContain("上次架构方案");
    expect(result).toContain("文件数：12");
    expect(result).toContain("App -> [Sidebar, MainView -> [TodoList, TodoForm]]");
    expect(result).toContain("useReducer");
    expect(result).toContain("localStorage");
    expect(result).toContain("Tab切换视图");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="agent-context-v2"`
Expected: FAIL — `buildPmHistoryContext` and `buildArchIterationContext` not exported

- [ ] **Step 3: Add `buildPmHistoryContext` and `buildArchIterationContext` to `lib/agent-context.ts`**

Append to the end of `lib/agent-context.ts`:

```typescript
import type { IterationRound, ArchDecisions } from "@/lib/types";
// (merge this import with the existing PmOutput import at line 1)

const INTENT_LABELS: Record<string, string> = {
  new_project: "新建项目",
  feature_add: "功能迭代",
  bug_fix: "Bug 修复",
  style_change: "样式调整",
};

/**
 * Builds a multi-round history context string for PM.
 * Replaces the single-round buildPmIterationContext.
 */
export function buildPmHistoryContext(rounds: readonly IterationRound[]): string {
  if (rounds.length === 0) return "";

  const header = "当前应用的迭代历史（请在此基础上分析增量需求，不要重新设计已有功能）：\n";

  const roundLines = rounds.map((r, i) => {
    const label = INTENT_LABELS[r.intent] ?? r.intent;
    if (r.pmSummary) {
      const features = r.pmSummary.features.join("、");
      return `[第${i + 1}轮] 用户："${r.userPrompt}"\n  意图：${r.pmSummary.intent} / 功能：${features} / 持久化：${r.pmSummary.persistence}`;
    }
    return `[第${i + 1}轮] 用户："${r.userPrompt}" (${label}，跳过PM)`;
  });

  return header + "\n" + roundLines.join("\n\n");
}

/**
 * Builds context for Architect showing its own previous decisions.
 */
export function buildArchIterationContext(archDecisions: ArchDecisions): string {
  const lines = [
    "上次架构方案（请在此基础上增量修改，保留已有文件结构）：",
    `文件数：${archDecisions.fileCount}`,
    `组件结构：${archDecisions.componentTree}`,
    `状态管理：${archDecisions.stateStrategy}`,
    `持久化：${archDecisions.persistenceSetup}`,
    `关键决策：${archDecisions.keyDecisions.join(" / ")}`,
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Update the import at top of `lib/agent-context.ts`**

Change line 1 from:

```typescript
import type { PmOutput } from "@/lib/types";
```

to:

```typescript
import type { PmOutput, IterationRound, ArchDecisions, Intent } from "@/lib/types";
```

- [ ] **Step 5: Delete `buildPmIterationContext`**

Remove the `buildPmIterationContext` function (lines 132-146 in `lib/agent-context.ts`). It will be replaced by `buildPmHistoryContext` in the next task.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="agent-context-v2"`
Expected: All 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add lib/agent-context.ts __tests__/agent-context-v2.test.ts
git commit -m "feat: add buildPmHistoryContext and buildArchIterationContext"
```

---

### Task 4: Wire up PATCH endpoint

**Files:**
- Modify: `app/api/projects/[id]/route.ts:45-65`

- [ ] **Step 1: Add `iterationContext` to the PATCH handler**

In `app/api/projects/[id]/route.ts`, modify the body destructuring (line 46) and the update data (lines 57-64):

Change:

```typescript
  const body = await req.json();
  const { name, description, currentCode, preferredModel } = body;
```

to:

```typescript
  const body = await req.json();
  const { name, description, currentCode, preferredModel, iterationContext } = body;
```

And change the `prisma.project.update` data:

```typescript
  const updated = await prisma.project.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() ?? null }),
      ...(currentCode !== undefined && { currentCode }),
      ...(preferredModel !== undefined && { preferredModel: preferredModel ?? null }),
      ...(iterationContext !== undefined && { iterationContext }),
    },
  });
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/api/projects/[id]/route.ts
git commit -m "feat: PATCH /api/projects/[id] supports iterationContext"
```

---

### Task 5: Wire write path in `chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx` (props, full pipeline completion, direct path completion)

- [ ] **Step 1: Update ChatAreaProps and add helper**

In `chat-area.tsx`, update the props interface (around line 42):

Change:

```typescript
interface ChatAreaProps {
  project: Project;
  messages: ProjectMessage[];
  onMessagesChange: (messages: ProjectMessage[]) => void;
  onFilesGenerated: (files: Record<string, string>, version: ProjectVersion) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  isPreviewingHistory?: boolean;
  isDemo?: boolean;
  initialModel?: string;
  currentFiles?: Record<string, string>;
  lastPmOutput?: PmOutput | null;
  onPmOutputGenerated?: (pm: PmOutput) => void;
  onNewProject?: () => void;
}
```

to:

```typescript
interface ChatAreaProps {
  project: Project;
  messages: ProjectMessage[];
  onMessagesChange: (messages: ProjectMessage[]) => void;
  onFilesGenerated: (files: Record<string, string>, version: ProjectVersion) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  isPreviewingHistory?: boolean;
  isDemo?: boolean;
  initialModel?: string;
  currentFiles?: Record<string, string>;
  iterationContext?: IterationContext | null;
  onIterationContextChange?: (ctx: IterationContext) => void;
  onNewProject?: () => void;
}
```

Update the destructured props in the function signature (around line 79):

Replace `lastPmOutput`, `onPmOutputGenerated` with `iterationContext`, `onIterationContextChange`.

- [ ] **Step 2: Add imports and the `appendRound` helper**

Add to imports at top of file:

```typescript
import { extractArchDecisions } from "@/lib/extract-arch-decisions";
import type { IterationContext, IterationRound, ArchDecisions } from "@/lib/types";
```

Add after the `delay` helper function (around line 77):

```typescript
const MAX_ITERATION_ROUNDS = 5;

function appendRound(
  existing: IterationContext | null | undefined,
  round: IterationRound
): IterationContext {
  const rounds = [...(existing?.rounds ?? []), round];
  return { rounds: rounds.slice(-MAX_ITERATION_ROUNDS) };
}
```

- [ ] **Step 3: Write round after full pipeline completion**

In `chat-area.tsx`, find the block at line 936 where `onPmOutputGenerated` is called:

```typescript
      // Persist PM output so next iteration can inject feature summary
      if (parsedPm) {
        onPmOutputGenerated?.(parsedPm);
      }
```

Replace with:

```typescript
      // Persist iteration round for cross-round context
      {
        const archDec: ArchDecisions | null =
          scaffold ? extractArchDecisions(scaffold) : null;
        const round: IterationRound = {
          userPrompt: prompt,
          intent,
          pmSummary: parsedPm,
          archDecisions: archDec,
          timestamp: new Date().toISOString(),
        };
        const updated = appendRound(iterationContext, round);
        onIterationContextChange?.(updated);
        // Fire-and-forget: persist to DB
        fetchAPI(`/api/projects/${project.id}`, {
          method: "PATCH",
          body: JSON.stringify({ iterationContext: updated }),
        }).catch(() => {});
      }
```

Note: `scaffold` is the variable from the multi-file path (around line 508). It is available here because this code is inside the same try block. If the pipeline took the legacy single-file path, `scaffold` will be `undefined`/not in scope — use `null` for `archDecisions` in that case. Check that the `scaffold` variable is declared with `let` at a scope visible to this line; if not, hoist it.

- [ ] **Step 4: Write round after direct path completion**

In `chat-area.tsx`, find the direct path block where version is saved (around line 477-505). After the `onFilesGenerated(...)` call and before the `return;` at line 505, add:

```typescript
        // Persist direct-path iteration round (no PM/Arch)
        {
          const round: IterationRound = {
            userPrompt: prompt,
            intent,
            pmSummary: null,
            archDecisions: null,
            timestamp: new Date().toISOString(),
          };
          const updated = appendRound(iterationContext, round);
          onIterationContextChange?.(updated);
          fetchAPI(`/api/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({ iterationContext: updated }),
          }).catch(() => {});
        }
```

- [ ] **Step 5: Update PM context injection**

Find the context construction block (around line 819-838). Change the PM branch:

From:

```typescript
        const context =
          agentRole === "pm"
            ? (intent === "feature_add" && lastPmOutput)
                ? buildPmIterationContext(lastPmOutput)
                : undefined
```

To:

```typescript
        const rounds = iterationContext?.rounds ?? [];
        const context =
          agentRole === "pm"
            ? (intent === "feature_add" && rounds.length > 0)
                ? buildPmHistoryContext(rounds)
                : undefined
```

Update the import to use `buildPmHistoryContext` instead of `buildPmIterationContext`.

- [ ] **Step 6: Update Architect context injection**

In the same context block, change the Architect branch:

From:

```typescript
            : agentRole === "architect"
              ? outputs.pm
```

To:

```typescript
            : agentRole === "architect"
              ? (() => {
                  const lastArch = [...rounds].reverse().find((r) => r.archDecisions !== null);
                  const archCtx = lastArch?.archDecisions
                    ? buildArchIterationContext(lastArch.archDecisions)
                    : "";
                  return archCtx ? `${archCtx}\n\n${outputs.pm}` : outputs.pm;
                })()
```

Add `buildArchIterationContext` to the imports from `@/lib/agent-context`.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors (there will be errors in workspace.tsx — fixed in next task)

- [ ] **Step 8: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: write iteration rounds and inject history into PM/Arch context"
```

---

### Task 6: Wire `workspace.tsx` and clean up `lastPmOutput`

**Files:**
- Modify: `components/workspace/workspace.tsx`
- Modify: `app/project/[id]/page.tsx`

- [ ] **Step 1: Update workspace.tsx — replace `lastPmOutput` with `iterationContext`**

In `workspace.tsx`:

1. Update imports — remove `PmOutput`, add `IterationContext`:

```typescript
import type { Project, ProjectMessage, ProjectVersion, IterationContext } from "@/lib/types";
```

2. Replace the `lastPmOutput` state (line 53):

From:

```typescript
  const [lastPmOutput, setLastPmOutput] = useState<PmOutput | null>(null);
```

To:

```typescript
  const [iterationContext, setIterationContext] = useState<IterationContext | null>(
    (project as unknown as { iterationContext?: IterationContext | null }).iterationContext ?? null
  );
```

3. Update the `ChatArea` props (around lines 114-131):

Replace:

```typescript
            lastPmOutput={lastPmOutput}
            onPmOutputGenerated={setLastPmOutput}
```

With:

```typescript
            iterationContext={iterationContext}
            onIterationContextChange={setIterationContext}
```

- [ ] **Step 2: Ensure `project/[id]/page.tsx` fetches `iterationContext`**

The `prisma.project.findFirst` on line 29 already returns all scalar fields (no `select` clause), so `iterationContext` is automatically included. No change needed.

Verify by checking that the query has no `select` clause:

```typescript
  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: allowedUserId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { versionNumber: "asc" } },
    },
  });
```

This is correct — `include` adds relations, all scalar fields are returned by default.

- [ ] **Step 3: Verify full build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass. Existing tests that mock `ChatArea` props may need `lastPmOutput` → `iterationContext` updates. If any test imports `buildPmIterationContext`, update it to `buildPmHistoryContext`.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/workspace.tsx app/project/[id]/page.tsx
git commit -m "feat: wire iterationContext through workspace, remove lastPmOutput"
```

---

### Task 7: Manual smoke test

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev:clean`
Expected: Server starts on http://localhost:3000

- [ ] **Step 2: Create a new project and generate an app**

1. Create a new project
2. Type: "做一个待办事项应用"
3. Wait for full pipeline to complete
4. Verify the app renders in preview

- [ ] **Step 3: Verify round was persisted**

Open Prisma Studio: `npx prisma studio`
Find the project → check `iterationContext` field.
Expected: JSON with 1 round containing `userPrompt`, `pmSummary`, `archDecisions`, `timestamp`.

- [ ] **Step 4: Iterate with a feature_add**

Type: "加一个暗黑模式"
Expected:
- PM output should reference existing features (check console/network for the PM request body — it should contain the history context)
- Architect output should reference previous file structure
- App renders with new feature added

- [ ] **Step 5: Verify round 2 was appended**

Check Prisma Studio again.
Expected: `iterationContext.rounds` now has 2 entries.

- [ ] **Step 6: Test page refresh persistence**

Refresh the page (F5).
Type: "加搜索功能"
Expected: PM still receives iteration history (2 prior rounds) — context survives refresh.

- [ ] **Step 7: Test direct path round**

Type: "把标题颜色改成蓝色"
Expected: Direct path runs (Engineer only). Check Prisma Studio — round 3 should have `intent: "style_change"`, `pmSummary: null`, `archDecisions: null`.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: address smoke test findings for iteration context v2"
```
