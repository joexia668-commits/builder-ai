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

  it("rounds have no archDecisions field (removed from type)", () => {
    for (const r of rounds) {
      expect(r).not.toHaveProperty("archDecisions");
    }
  });

  it("deriveArchFromFiles provides full architecture context regardless of round history", () => {
    const archCtx = deriveArchFromFiles(TODO_FILES);
    expect(archCtx).toContain("3 个文件");
    expect(archCtx).toContain("/App.js");
    expect(archCtx).toContain("/components/TodoList.js");
    expect(archCtx).toContain("/components/TodoItem.js");
    expect(archCtx).toContain("TodoList");
    expect(archCtx).toContain("TodoItem");
  });

  it("PM history works with rounds that have no archDecisions field", () => {
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("修复 bug #1");
    expect(result).toContain("修复 bug #5");
    expect(result).not.toContain("架构：");
  });
});

// ── Scenario 2: feature_add → bug_fix (changed structure) → feature_add (stale snapshot) ──

describe("Scenario 2: stale snapshot — bug_fix changes file structure untracked", () => {
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
    expect(archCtx).not.toMatch(/\/components\/SearchBar\.js.*→/);
  });
});

// ── Scenario 3: file rename (orphan file handled by removeFiles) ──

describe("Scenario 3: file rename — removeFiles cleans up old path", () => {
  it("validateScaffold passes through valid removeFiles", () => {
    const scaffold: ScaffoldData = {
      files: [
        // No phantom deps — keeps warnings empty
        { path: "/components/TaskList.js", description: "Renamed from TodoList", exports: ["TaskList"], deps: [], hints: "" },
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

    const finalFiles: Record<string, string> = { ...existingFiles, ...newFiles };
    for (const path of removeFiles) {
      delete finalFiles[path];
    }

    expect(finalFiles["/components/TaskList.js"]).toBeDefined();
    expect(finalFiles["/components/TodoList.js"]).toBeUndefined();
    expect(finalFiles["/components/TodoItem.js"]).toBeDefined();
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
    expect(mergedWithoutRemove["/components/SearchBar.js"]).toBeDefined();
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
    expect(finalFiles["/components/SearchBar.js"]).toBeUndefined();
  });
});

// ── Scenario 5: major restructure — merge + removeFiles handles consolidation ──

describe("Scenario 5: major restructure — merge + removeFiles handles consolidation", () => {
  it("restructure with removeFiles: old component files removed after merge into single file", () => {
    const existingFiles = { ...TODO_FILES };
    const newFiles: Record<string, string> = {
      "/App.js": "export default function App() { return <div>consolidated</div>; }",
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
    expect(parsed.userPrompt).toBe("做一个待办");
    expect(parsed.intent).toBe("new_project");
    expect(buildPmHistoryContext([parsed])).toContain("做一个待办");
  });
});
