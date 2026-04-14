# Realtime Architecture Derivation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile saved `archDecisions` mechanism with real-time file analysis, add merge fallback to the full pipeline, and support explicit file removal via scaffold `removeFiles`.

**Architecture:** Three-layer defense — (1) `deriveArchFromFiles()` parses existing files to build Architect context, (2) Architect prompt constrains to incremental design, (3) `{...existing, ...new}` merge with `removeFiles` support prevents file loss.

**Tech Stack:** TypeScript, Jest, React (chat-area.tsx component)

---

### Task 1: Add `removeFiles` to `ScaffoldData` type + remove `ArchDecisions`

**Files:**
- Modify: `lib/types.ts:214-243`

- [ ] **Step 1: Write the type changes**

In `lib/types.ts`, add `removeFiles` to `ScaffoldData` and remove `ArchDecisions` type + `archDecisions` from `IterationRound`:

```typescript
// lib/types.ts — ScaffoldData (line ~214)
export interface ScaffoldData {
  readonly files: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly designNotes: string;
  readonly removeFiles?: readonly string[];
}

// Delete the entire ArchDecisions interface (lines 226-232):
// DELETE: export interface ArchDecisions { ... }

// lib/types.ts — IterationRound (line ~234)
export interface IterationRound {
  readonly userPrompt: string;
  readonly intent: Intent;
  readonly pmSummary: PmOutput | null;
  readonly timestamp: string;
  // archDecisions field removed — architecture is now derived from files at runtime
}
```

- [ ] **Step 2: Verify TypeScript errors surface**

Run: `npx tsc --noEmit 2>&1 | grep -E "archDecisions|ArchDecisions|extract-arch-decisions|buildArchIterationContext" | head -20`

Expected: Multiple TS errors referencing `ArchDecisions`, `archDecisions`, `buildArchIterationContext`, `extractArchDecisions` — confirming all dependents need updating.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "refactor: add removeFiles to ScaffoldData; remove ArchDecisions type"
```

---

### Task 2: Delete `lib/extract-arch-decisions.ts` and its tests

**Files:**
- Delete: `lib/extract-arch-decisions.ts`
- Delete: `__tests__/extract-arch-decisions.test.ts`

- [ ] **Step 1: Delete both files**

```bash
rm lib/extract-arch-decisions.ts __tests__/extract-arch-decisions.test.ts
```

- [ ] **Step 2: Verify no other file imports from this module (besides chat-area.tsx which will be fixed later)**

Run: `grep -r "extract-arch-decisions" --include="*.ts" --include="*.tsx" | grep -v chat-area.tsx | grep -v ".test."`

Expected: No output (only chat-area.tsx and the deleted test imported it).

- [ ] **Step 3: Commit**

```bash
git add -u lib/extract-arch-decisions.ts __tests__/extract-arch-decisions.test.ts
git commit -m "refactor: delete extract-arch-decisions (replaced by deriveArchFromFiles)"
```

---

### Task 3: Implement `deriveArchFromFiles()` with TDD

**Files:**
- Create: `__tests__/derive-arch-from-files.test.ts`
- Modify: `lib/agent-context.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/derive-arch-from-files.test.ts`:

```typescript
import { deriveArchFromFiles } from "@/lib/agent-context";

const TODO_APP_FILES: Record<string, string> = {
  "/App.js": `import React, { useState, createContext } from 'react';
import { TodoList } from '/components/TodoList.js';
import { useTodos } from '/hooks/useTodos.js';
export default function App() { return <div><TodoList /></div>; }`,

  "/components/TodoList.js": `import React from 'react';
import { TodoItem } from '/components/TodoItem.js';
import { filterByStatus } from '/utils/filters.js';
export default function TodoList({ items }) { return <ul>{items.map(i => <TodoItem key={i.id} item={i} />)}</ul>; }
export { TodoList };`,

  "/components/TodoItem.js": `import React from 'react';
export function TodoItem({ item }) { return <li>{item.text}</li>; }
export default TodoItem;`,

  "/hooks/useTodos.js": `import { useState, useEffect } from 'react';
import { supabase } from '/supabaseClient.js';
export function useTodos() { const [todos, setTodos] = useState([]); return { todos, setTodos }; }
export default useTodos;`,

  "/utils/filters.js": `export function filterByStatus(items, status) { return items.filter(i => i.status === status); }
export function filterByDate(items, date) { return items.filter(i => i.date === date); }`,
};

describe("deriveArchFromFiles", () => {
  it("returns empty string for empty file set", () => {
    expect(deriveArchFromFiles({})).toBe("");
  });

  it("includes file count in header", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("5 个文件");
  });

  it("lists each file with line count", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("/App.js");
    expect(result).toContain("/components/TodoList.js");
    expect(result).toContain("/hooks/useTodos.js");
    expect(result).toMatch(/\/App\.js \(\d+ lines\)/);
  });

  it("extracts default exports", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toMatch(/\/App\.js.*App.*default/);
  });

  it("extracts named exports", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("filterByStatus");
    expect(result).toContain("filterByDate");
  });

  it("builds import dependency graph for local files only", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    // App.js imports TodoList and useTodos
    expect(result).toMatch(/\/App\.js.*→.*\/components\/TodoList\.js/);
    expect(result).toMatch(/\/App\.js.*→.*\/hooks\/useTodos\.js/);
  });

  it("excludes npm packages from dependency graph", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    // Should NOT list 'react' as a dependency
    expect(result).not.toMatch(/→.*\breact\b/);
  });

  it("detects useState and createContext as state management", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("useState");
    expect(result).toContain("createContext");
  });

  it("detects Supabase persistence", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("Supabase");
  });

  it("detects localStorage persistence", () => {
    const files: Record<string, string> = {
      "/App.js": `import React from 'react';
export default function App() { localStorage.setItem('key', 'val'); return <div/>; }`,
    };
    const result = deriveArchFromFiles(files);
    expect(result).toContain("localStorage");
  });

  it("includes incremental instruction header", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("从代码实时分析");
    expect(result).toContain("增量修改");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="derive-arch-from-files" 2>&1 | tail -5`

Expected: FAIL — `deriveArchFromFiles` is not exported from `@/lib/agent-context`.

- [ ] **Step 3: Implement `deriveArchFromFiles` in `lib/agent-context.ts`**

Remove the `ArchDecisions` import and `buildArchIterationContext` function. Add `deriveArchFromFiles`:

```typescript
// At top of lib/agent-context.ts — update import (remove ArchDecisions)
import type { Intent, PmOutput, IterationRound } from "@/lib/types";

// Delete buildArchIterationContext function entirely (lines 186-198)

// Add new function at the end of the file:

/**
 * Derives a structured architecture summary from existing source files.
 * Pure string analysis — zero LLM calls. Replaces the old buildArchIterationContext
 * which relied on saved archDecisions from iterationContext.
 */
export function deriveArchFromFiles(files: Record<string, string>): string {
  const entries = Object.entries(files);
  if (entries.length === 0) return "";

  const EXPORT_RE = /export\s+(default\s+)?(?:function|const|class)\s+(\w+)/g;
  const IMPORT_RE = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  const STATE_KEYWORDS = ["useState", "useReducer", "useContext", "createContext"] as const;

  const fileInfos: Array<{
    path: string;
    lines: number;
    exports: string[];
    localDeps: string[];
  }> = [];

  const allCode = entries.map(([, code]) => code).join("\n");

  for (const [path, code] of entries) {
    const lines = code.split("\n").length;

    const exports: string[] = [];
    let m: RegExpExecArray | null;
    const exportRe = new RegExp(EXPORT_RE.source, EXPORT_RE.flags);
    while ((m = exportRe.exec(code)) !== null) {
      const isDefault = Boolean(m[1]?.trim());
      exports.push(isDefault ? `${m[2]} (default)` : m[2]);
    }

    const localDeps: string[] = [];
    const importRe = new RegExp(IMPORT_RE.source, IMPORT_RE.flags);
    while ((m = importRe.exec(code)) !== null) {
      const source = m[1];
      if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) {
        if (source !== "/supabaseClient.js") {
          localDeps.push(source);
        }
      }
    }

    fileInfos.push({ path, lines, exports, localDeps });
  }

  // File list section
  const fileListLines = fileInfos.map((f) => {
    const exportsStr = f.exports.length > 0 ? f.exports.join(", ") : "(no exports)";
    return `  ${f.path} (${f.lines} lines) — exports: ${exportsStr}`;
  });

  // Dependency graph section
  const depLines = fileInfos
    .filter((f) => f.localDeps.length > 0)
    .map((f) => `  ${f.path} → [${f.localDeps.join(", ")}]`);

  // State management detection
  const detectedState = STATE_KEYWORDS.filter((kw) => allCode.includes(kw));
  const stateStr = detectedState.length > 0 ? detectedState.join(", ") : "none detected";

  // Persistence detection
  const persistence: string[] = [];
  if (allCode.includes("supabase")) persistence.push("Supabase");
  if (allCode.includes("localStorage")) persistence.push("localStorage");
  const persistStr = persistence.length > 0 ? persistence.join(", ") : "none";

  const sections = [
    `当前应用架构（从代码实时分析，请在此基础上增量修改）：`,
    ``,
    `文件结构（${entries.length} 个文件）：`,
    ...fileListLines,
  ];

  if (depLines.length > 0) {
    sections.push(``, `依赖关系：`, ...depLines);
  }

  sections.push(``, `状态管理：${stateStr}`);
  sections.push(`持久化：${persistStr}`);

  return sections.join("\n");
}
```

- [ ] **Step 4: Also update `buildPmHistoryContext` to remove archDecisions references**

In `lib/agent-context.ts`, update `buildPmHistoryContext` (line ~160):

```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="derive-arch-from-files" 2>&1 | tail -5`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/agent-context.ts __tests__/derive-arch-from-files.test.ts
git commit -m "feat: add deriveArchFromFiles; remove buildArchIterationContext + archDecisions from PM history"
```

---

### Task 4: Update `agent-context-v2.test.ts` — remove `buildArchIterationContext` tests, update PM history tests

**Files:**
- Modify: `__tests__/agent-context-v2.test.ts`

- [ ] **Step 1: Rewrite the test file**

```typescript
import { buildPmHistoryContext } from "@/lib/agent-context";
import type { IterationRound } from "@/lib/types";

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
        timestamp: "2026-04-13T10:00:00Z",
      },
      {
        userPrompt: "加暗黑模式",
        intent: "feature_add",
        pmSummary: { intent: "主题切换", features: ["暗黑模式"], persistence: "localStorage", modules: ["Theme"] },
        timestamp: "2026-04-13T11:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("[第1轮]");
    expect(result).toContain("[第2轮]");
    expect(result.indexOf("做个待办应用")).toBeLessThan(result.indexOf("加暗黑模式"));
  });

  it("does NOT include archDecisions in output (field removed)", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "做个待办",
        intent: "new_project",
        pmSummary: null,
        timestamp: "2026-04-13T10:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).not.toContain("架构：");
    expect(result).not.toContain("componentTree");
  });

  it("backward compat: old rounds with archDecisions field load without error", () => {
    // Simulates loading iterationContext from DB that still has archDecisions
    const rawFromDB = JSON.parse(JSON.stringify({
      userPrompt: "做个待办",
      intent: "new_project",
      pmSummary: null,
      archDecisions: { fileCount: 3, componentTree: "App -> [List]", stateStrategy: "useState", persistenceSetup: "none", keyDecisions: [] },
      timestamp: "2026-04-13T10:00:00Z",
    })) as IterationRound;
    // Should not throw — extra fields are ignored by TS at runtime
    const result = buildPmHistoryContext([rawFromDB]);
    expect(result).toContain("做个待办");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="agent-context-v2" 2>&1 | tail -5`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/agent-context-v2.test.ts
git commit -m "test: update agent-context-v2 tests for archDecisions removal"
```

---

### Task 5: Add `removeFiles` validation to `validateScaffold`

**Files:**
- Modify: `lib/validate-scaffold.ts`
- Modify: `__tests__/validate-scaffold.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/validate-scaffold.test.ts`:

```typescript
describe("removeFiles validation", () => {
  it("passes through removeFiles unchanged when valid", () => {
    const input: ScaffoldData = {
      ...makeScaffold([{ path: "/a.js", deps: [] }]),
      removeFiles: ["/old.js", "/deprecated.js"],
    };
    const { scaffold, warnings } = validateScaffold(input);
    expect(scaffold.removeFiles).toEqual(["/old.js", "/deprecated.js"]);
    expect(warnings.length).toBe(0);
  });

  it("warns when removeFiles entry also exists in files array", () => {
    const input: ScaffoldData = {
      ...makeScaffold([{ path: "/a.js", deps: [] }, { path: "/b.js", deps: [] }]),
      removeFiles: ["/a.js"],
    };
    const { scaffold, warnings } = validateScaffold(input);
    // The conflicting entry is removed from removeFiles
    expect(scaffold.removeFiles).toEqual([]);
    expect(warnings).toContainEqual(expect.stringContaining("/a.js"));
  });

  it("handles undefined removeFiles (backward compat)", () => {
    const input = makeScaffold([{ path: "/a.js", deps: [] }]);
    const { scaffold } = validateScaffold(input);
    expect(scaffold.removeFiles).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="validate-scaffold" --testNamePattern="removeFiles" 2>&1 | tail -10`

Expected: FAIL — `removeFiles` not handled by `validateScaffold`.

- [ ] **Step 3: Implement removeFiles validation**

In `lib/validate-scaffold.ts`, add after the cycle-breaking step (before the return statement at line ~169):

```typescript
  // Rule 5: validate removeFiles — entries must not also appear in files array
  let removeFiles = raw.removeFiles;
  if (removeFiles && removeFiles.length > 0) {
    const scaffoldPaths = new Set(files.map((f) => f.path));
    const conflicting = removeFiles.filter((p) => scaffoldPaths.has(p));
    if (conflicting.length > 0) {
      for (const p of conflicting) {
        warnings.push(`removeFiles 与 scaffold files 冲突: ${p}（已从 removeFiles 移除）`);
      }
      removeFiles = removeFiles.filter((p) => !scaffoldPaths.has(p));
    }
  }

  return {
    scaffold: { ...raw, files, ...(removeFiles !== undefined ? { removeFiles } : {}) },
    warnings,
  };
```

Also update the existing return statement — replace:
```typescript
  return {
    scaffold: { ...raw, files },
    warnings,
  };
```

with the version above that includes `removeFiles`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="validate-scaffold" 2>&1 | tail -5`

Expected: All tests PASS (including existing tests — no regression).

- [ ] **Step 5: Commit**

```bash
git add lib/validate-scaffold.ts __tests__/validate-scaffold.test.ts
git commit -m "feat: validate removeFiles in scaffold — reject conflicts with files array"
```

---

### Task 6: Update Architect prompt with incremental constraint

**Files:**
- Modify: `lib/generate-prompts.ts:21-71` (architect prompt)

- [ ] **Step 1: Update architect system prompt**

In `lib/generate-prompts.ts`, update the `architect` prompt in the `prompts` record to add the `removeFiles` field to the JSON schema and include incremental instructions:

Replace the architect prompt's JSON schema line:
```
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string"}],"sharedTypes":"string","designNotes":"string"}
```
with:
```
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string"}],"sharedTypes":"string","designNotes":"string","removeFiles":["string"]}
```

Add to the field descriptions:
```
- removeFiles: （可选）需要删除的旧文件路径数组。仅在迭代模式下使用，当某个功能被移除或文件被重命名时，列出应删除的旧文件路径
```

Add before the output format section:
```
迭代规则（当收到已有架构分析时必须遵守）：
- 已有文件不要重新设计，除非用户明确要求修改
- 只输出需要新增的文件和必须修改的文件
- 修改已有文件时，保留其现有 exports 和 deps 结构，仅添加新功能
- 如需删除旧文件（如重命名或移除功能），将旧路径加入 removeFiles 数组
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `npm test -- --testPathPatterns="generate-prompts|supabase-injection" 2>&1 | tail -5`

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/generate-prompts.ts
git commit -m "feat: update Architect prompt with incremental constraint and removeFiles schema"
```

---

### Task 7: Wire up `resolveArchContext` + merge + removeFiles in `chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

- [ ] **Step 1: Update imports**

In `chat-area.tsx`, update the imports:

Replace:
```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmHistoryContext,
  buildArchIterationContext,
  buildTriageContext,
} from "@/lib/agent-context";
import { extractArchDecisions } from "@/lib/extract-arch-decisions";
```
with:
```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmHistoryContext,
  deriveArchFromFiles,
  buildTriageContext,
} from "@/lib/agent-context";
```

- [ ] **Step 2: Update `resolveArchContext` function**

Replace the existing `resolveArchContext` function (lines ~156-167):

```typescript
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

- [ ] **Step 3: Update the call site for `resolveArchContext`**

Find the line (around ~1039-1040):
```typescript
            : agentRole === "architect"
              ? resolveArchContext(rounds, outputs.pm)
```
Replace with:
```typescript
            : agentRole === "architect"
              ? resolveArchContext(rounds, outputs.pm, currentFiles)
```

- [ ] **Step 4: Add merge + removeFiles before `onFilesGenerated` in full pipeline**

Find the multi-file success block (around line ~1013-1022):
```typescript
              const res = await fetchAPI("/api/versions", {
                method: "POST",
                body: JSON.stringify({
                  projectId: project.id,
                  files: allCompletedFiles,
                  description: prompt.slice(0, 80),
                }),
              });
              const version = await res.json();
              onFilesGenerated(allCompletedFiles, version);
```

Replace with:
```typescript
              // Merge: preserve existing files not regenerated by scaffold
              const finalFiles: Record<string, string> = { ...currentFiles, ...allCompletedFiles };
              // Remove files explicitly marked for deletion by Architect
              if (capturedScaffold?.removeFiles) {
                for (const removePath of capturedScaffold.removeFiles) {
                  delete finalFiles[removePath];
                }
              }
              const res = await fetchAPI("/api/versions", {
                method: "POST",
                body: JSON.stringify({
                  projectId: project.id,
                  files: finalFiles,
                  description: prompt.slice(0, 80),
                }),
              });
              const version = await res.json();
              onFilesGenerated(finalFiles, version);
```

- [ ] **Step 5: Remove `archDecisions` from iteration round persistence**

Find the full pipeline iteration round block (around line ~1150-1157):
```typescript
        const round: IterationRound = {
          userPrompt: prompt,
          intent,
          pmSummary: parsedPm,
          archDecisions: capturedScaffold ? extractArchDecisions(capturedScaffold) : null,
          timestamp: roundTimestamp,
        };
```
Replace with:
```typescript
        const round: IterationRound = {
          userPrompt: prompt,
          intent,
          pmSummary: parsedPm,
          timestamp: roundTimestamp,
        };
```

- [ ] **Step 6: Also remove `archDecisions` from direct path iteration round**

Find the direct path round block (around line ~613):
```typescript
          const round: IterationRound = {
            userPrompt: prompt,
            intent,
            pmSummary: null,
            archDecisions: null,
            timestamp: roundTimestamp,
          };
```
Replace with:
```typescript
          const round: IterationRound = {
            userPrompt: prompt,
            intent,
            pmSummary: null,
            timestamp: roundTimestamp,
          };
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v "__tests__" | head -10`

Expected: No errors from production code. (Pre-existing test errors in `__tests__/generate-route-model.test.ts` are acceptable.)

- [ ] **Step 8: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: wire deriveArchFromFiles + merge fallback + removeFiles into full pipeline"
```

---

### Task 8: Scenario verification tests

**Files:**
- Create: `__tests__/realtime-arch-scenarios.test.ts`

These tests verify every failure scenario discussed during design, using the actual functions.

- [ ] **Step 1: Write scenario tests**

Create `__tests__/realtime-arch-scenarios.test.ts`:

```typescript
/**
 * Scenario verification for realtime arch derivation.
 * Each test maps to a specific failure scenario discussed during design.
 */
import { deriveArchFromFiles, buildPmHistoryContext } from "@/lib/agent-context";
import { validateScaffold } from "@/lib/validate-scaffold";
import type { IterationRound, ScaffoldData } from "@/lib/types";

// ── Shared fixtures ────────────────────────────────────────────────

const TODO_FILES: Record<string, string> = {
  "/App.js": `import React, { useState } from 'react';
import { TodoList } from '/components/TodoList.js';
export default function App() { const [todos] = useState([]); return <TodoList items={todos} />; }`,
  "/components/TodoList.js": `import React from 'react';
import { TodoItem } from '/components/TodoItem.js';
export function TodoList({ items }) { return <ul>{items.map(i => <TodoItem key={i.id} item={i}/>)}</ul>; }
export default TodoList;`,
  "/components/TodoItem.js": `import React from 'react';
export function TodoItem({ item }) { return <li>{item.text}</li>; }
export default TodoItem;`,
};

// ── Scenario 1: bug_fix ×5 → feature_add (FIFO eviction) ──────────

describe("Scenario 1: FIFO eviction — bug_fix ×5 then feature_add", () => {
  const rounds: IterationRound[] = Array.from({ length: 5 }, (_, i) => ({
    userPrompt: `修复 bug #${i + 1}`,
    intent: "bug_fix" as const,
    pmSummary: null,
    timestamp: `2026-04-13T${10 + i}:00:00Z`,
  }));

  it("all rounds have no archDecisions (field removed entirely)", () => {
    // With archDecisions removed from IterationRound, rounds no longer carry arch info.
    // Confirm the rounds are valid without it.
    for (const r of rounds) {
      expect(r).not.toHaveProperty("archDecisions");
    }
  });

  it("deriveArchFromFiles provides full architecture context regardless of round history", () => {
    // This is the key fix: we derive from files, not from rounds
    const archCtx = deriveArchFromFiles(TODO_FILES);
    expect(archCtx).toContain("3 个文件");
    expect(archCtx).toContain("/App.js");
    expect(archCtx).toContain("/components/TodoList.js");
    expect(archCtx).toContain("/components/TodoItem.js");
    expect(archCtx).toContain("TodoList");
    expect(archCtx).toContain("TodoItem");
  });

  it("PM history still works with rounds that have no archDecisions field", () => {
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("修复 bug #1");
    expect(result).toContain("修复 bug #5");
    expect(result).not.toContain("架构：");
  });
});

// ── Scenario 2: feature_add → bug_fix (changed structure) → feature_add (stale snapshot) ──

describe("Scenario 2: stale snapshot — bug_fix changes file structure untracked", () => {
  // After feature_add, a bug_fix adds SearchBar.js.
  // Old system: archDecisions from feature_add wouldn't know about SearchBar.
  // New system: deriveArchFromFiles reads current files directly.
  const filesAfterBugFix: Record<string, string> = {
    ...TODO_FILES,
    "/components/SearchBar.js": `import React, { useState } from 'react';
export function SearchBar({ onSearch }) { const [q, setQ] = useState(''); return <input value={q} onChange={e => { setQ(e.target.value); onSearch(e.target.value); }} />; }
export default SearchBar;`,
  };

  it("deriveArchFromFiles sees the new SearchBar.js added by bug_fix", () => {
    const archCtx = deriveArchFromFiles(filesAfterBugFix);
    expect(archCtx).toContain("4 个文件");
    expect(archCtx).toContain("/components/SearchBar.js");
    expect(archCtx).toContain("SearchBar");
  });

  it("dependency graph reflects current state, not stale snapshot", () => {
    const archCtx = deriveArchFromFiles(filesAfterBugFix);
    // SearchBar has no local deps (only React)
    expect(archCtx).not.toMatch(/\/components\/SearchBar\.js.*→/);
  });
});

// ── Scenario 3: file rename (orphan file handled by removeFiles) ──

describe("Scenario 3: file rename — removeFiles cleans up old path", () => {
  it("validateScaffold passes through valid removeFiles", () => {
    const scaffold: ScaffoldData = {
      files: [
        { path: "/components/TaskList.js", description: "Renamed from TodoList", exports: ["TaskList"], deps: ["/components/TodoItem.js"], hints: "" },
      ],
      sharedTypes: "",
      designNotes: "",
      removeFiles: ["/components/TodoList.js"],
    };
    const { scaffold: validated, warnings } = validateScaffold(scaffold);
    expect(validated.removeFiles).toEqual(["/components/TodoList.js"]);
    expect(warnings.length).toBe(0);
  });

  it("merge + removeFiles: old file deleted, new file present", () => {
    const existingFiles = { ...TODO_FILES };
    const newFiles: Record<string, string> = {
      "/components/TaskList.js": "export function TaskList() { return <div>Renamed!</div>; }\nexport default TaskList;",
      "/App.js": "import { TaskList } from '/components/TaskList.js';\nexport default function App() { return <TaskList />; }",
    };
    const removeFiles = ["/components/TodoList.js"];

    // Simulate merge logic from chat-area.tsx
    const finalFiles: Record<string, string> = { ...existingFiles, ...newFiles };
    for (const path of removeFiles) {
      delete finalFiles[path];
    }

    expect(finalFiles).toHaveProperty("/components/TaskList.js");
    expect(finalFiles).not.toHaveProperty("/components/TodoList.js");
    // TodoItem is preserved (not in removeFiles, not regenerated)
    expect(finalFiles).toHaveProperty("/components/TodoItem.js");
  });
});

// ── Scenario 4: file deletion (merge preserves unwanted file → removeFiles fixes it) ──

describe("Scenario 4: feature deletion — removeFiles prevents orphaned files", () => {
  it("without removeFiles: deleted feature's file is preserved by merge", () => {
    const existingFiles = { ...TODO_FILES, "/components/SearchBar.js": "export function SearchBar() {}" };
    const newFiles: Record<string, string> = {
      "/App.js": "export default function App() { return <div>No search</div>; }",
    };

    const mergedWithoutRemove = { ...existingFiles, ...newFiles };
    // SearchBar.js is still there — orphaned
    expect(mergedWithoutRemove).toHaveProperty("/components/SearchBar.js");
  });

  it("with removeFiles: deleted feature's file is cleaned up", () => {
    const existingFiles = { ...TODO_FILES, "/components/SearchBar.js": "export function SearchBar() {}" };
    const newFiles: Record<string, string> = {
      "/App.js": "export default function App() { return <div>No search</div>; }",
    };
    const removeFiles = ["/components/SearchBar.js"];

    const finalFiles: Record<string, string> = { ...existingFiles, ...newFiles };
    for (const path of removeFiles) {
      delete finalFiles[path];
    }
    expect(finalFiles).not.toHaveProperty("/components/SearchBar.js");
  });
});

// ── Scenario 5: major restructure — merge preserves old files but removeFiles can clean ──

describe("Scenario 5: major restructure — merge + removeFiles handles consolidation", () => {
  it("restructure with removeFiles: old component files removed after merge into single file", () => {
    const existingFiles = { ...TODO_FILES };
    const newFiles: Record<string, string> = {
      "/App.js": "export default function App() { /* all-in-one */ return <div>consolidated</div>; }",
    };
    const removeFiles = ["/components/TodoList.js", "/components/TodoItem.js"];

    const finalFiles: Record<string, string> = { ...existingFiles, ...newFiles };
    for (const path of removeFiles) {
      delete finalFiles[path];
    }

    expect(Object.keys(finalFiles)).toEqual(["/App.js"]);
  });

  it("restructure without removeFiles: old files orphaned but not lost", () => {
    const existingFiles = { ...TODO_FILES };
    const newFiles: Record<string, string> = {
      "/App.js": "export default function App() { return <div>consolidated</div>; }",
    };

    const finalFiles = { ...existingFiles, ...newFiles };
    // All old files preserved — harmless orphans
    expect(Object.keys(finalFiles).length).toBe(3);
  });
});

// ── Backward compatibility: old iterationContext with archDecisions in DB ──

describe("Backward compatibility: old DB data with archDecisions", () => {
  it("JSON.parse of old round format doesn't throw and is usable", () => {
    const oldRoundJSON = `{
      "userPrompt": "做一个待办",
      "intent": "new_project",
      "pmSummary": null,
      "archDecisions": {"fileCount":3,"componentTree":"App","stateStrategy":"useState","persistenceSetup":"none","keyDecisions":[]},
      "timestamp": "2026-04-13T10:00:00Z"
    }`;
    const parsed = JSON.parse(oldRoundJSON) as IterationRound;
    // Should be usable — extra fields are ignored at runtime
    expect(parsed.userPrompt).toBe("做一个待办");
    expect(parsed.intent).toBe("new_project");
    expect(buildPmHistoryContext([parsed])).toContain("做一个待办");
  });
});
```

- [ ] **Step 2: Run all scenario tests**

Run: `npm test -- --testPathPatterns="realtime-arch-scenarios" 2>&1 | tail -10`

Expected: All tests PASS.

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm test 2>&1 | tail -10`

Expected: All existing tests pass. Only pre-existing failures (if any) remain.

- [ ] **Step 4: Commit**

```bash
git add __tests__/realtime-arch-scenarios.test.ts
git commit -m "test: add scenario verification for all 5 discussed failure cases"
```

---

### Task 9: Update CLAUDE.md architecture docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Architecture section**

In `CLAUDE.md`, find the "Intent classification & context memory" section and update the Architect context description.

Replace:
```
- **Architect** (full pipeline): `resolveArchContext(rounds, pmOutput)` — finds last round with non-null `archDecisions`, prepends arch summary (file count, component tree, state strategy, key decisions) to PM output so Architect modifies incrementally
```
with:
```
- **Architect** (full pipeline): `resolveArchContext(rounds, pmOutput, existingFiles)` — calls `deriveArchFromFiles(existingFiles)` to build a real-time architecture summary (file list, exports, imports, state strategy, persistence) from current code, prepends to PM output so Architect modifies incrementally. No longer depends on saved `archDecisions`.
```

Also in the same section, remove or update references to `extractArchDecisions(scaffold)`:

Replace:
```
`iterationContext` is loaded from `Project.iterationContext` (Json? column, FIFO max 5 rounds) at page load and held in `Workspace` state. After each generation (both direct and full pipeline), a new `IterationRound` is appended and fire-and-forget PATCHed to `/api/projects/[id]`. `extractArchDecisions(scaffold)` deterministically extracts `ArchDecisions` from `ScaffoldData` without an extra LLM call.
```
with:
```
`iterationContext` is loaded from `Project.iterationContext` (Json? column, FIFO max 5 rounds) at page load and held in `Workspace` state. After each generation (both direct and full pipeline), a new `IterationRound` is appended and fire-and-forget PATCHed to `/api/projects/[id]`. Architecture context is derived at runtime from existing files via `deriveArchFromFiles()`, not stored in `iterationContext`.
```

In the "Key files" table, remove the `extract-arch-decisions.ts` entry if present, and note the new function location:

Add under `lib/agent-context.ts` description: `+ deriveArchFromFiles()` 

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for realtime arch derivation + merge fallback"
```

---

### Task 10: Final integration verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -15`

Expected: All tests pass. No regressions.

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -v "__tests__" | head -10`

Expected: No production code errors.

- [ ] **Step 3: Dev server smoke test**

Run: `npm run dev` and verify:
1. Open http://localhost:3000
2. Create or open an existing project
3. Generate a new app (triggers `new_project` → full pipeline)
4. Verify the generated app renders correctly
5. Send a `feature_add` prompt — verify Architect sees the real-time architecture context in its response

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "chore: final integration verification for realtime arch derivation"
```
