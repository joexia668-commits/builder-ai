# File Tree Code Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "代码" tab's flat file-tab editor with a read-only split-pane viewer — file tree on the left, Monaco editor on the right.

**Architecture:** New `FileTreeCodeViewer` component with two sub-panels: a pure-React collapsible file tree (left, 200px fixed) and a read-only Monaco editor (right, flex-1). A pure utility function `buildFileTree` converts flat `Record<string, string>` paths into a typed tree structure. `preview-panel.tsx` swaps `MultiFileEditor` for `FileTreeCodeViewer` in the `code` tab branch.

**Tech Stack:** React 18, TypeScript strict, `@monaco-editor/react` (already installed), Tailwind CSS, Jest + React Testing Library.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/file-tree.ts` | `buildFileTree()` pure utility + `TreeNode` type |
| Create | `components/preview/file-tree-code-viewer.tsx` | Split-pane component: FileTree + CodeViewer |
| Create | `__tests__/file-tree.test.ts` | Unit tests for `buildFileTree` |
| Create | `__tests__/file-tree-code-viewer.test.tsx` | Component tests for `FileTreeCodeViewer` |
| Modify | `components/preview/preview-panel.tsx` | Swap `MultiFileEditor` → `FileTreeCodeViewer` in code tab |
| Modify | `__tests__/preview-panel.test.tsx` | Update mock: `multi-file-editor` → `file-tree-code-viewer` |

`MultiFileEditor` (`components/preview/multi-file-editor.tsx`) is **not modified or deleted**.

---

## Task 1: Define `TreeNode` type and `buildFileTree` utility

**Files:**
- Create: `lib/file-tree.ts`
- Create: `__tests__/file-tree.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/file-tree.test.ts`:

```typescript
import { buildFileTree } from "@/lib/file-tree";
import type { TreeNode } from "@/lib/file-tree";

describe("buildFileTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("returns flat file nodes for root-level files", () => {
    const result = buildFileTree(["/App.js", "/index.css"]);
    expect(result).toEqual([
      { kind: "file", name: "App.js", path: "/App.js" },
      { kind: "file", name: "index.css", path: "/index.css" },
    ]);
  });

  it("App.js sorts first among root-level files", () => {
    const result = buildFileTree(["/index.css", "/App.js", "/utils.js"]);
    expect(result[0]).toEqual({ kind: "file", name: "App.js", path: "/App.js" });
  });

  it("groups files under directory nodes", () => {
    const result = buildFileTree(["/components/Button.js", "/App.js"]);
    const dir = result.find((n): n is Extract<TreeNode, { kind: "dir" }> => n.kind === "dir" && n.name === "components");
    expect(dir).toBeDefined();
    expect(dir!.children).toEqual([
      { kind: "file", name: "Button.js", path: "/components/Button.js" },
    ]);
  });

  it("directories sort before files at each level", () => {
    const result = buildFileTree(["/App.js", "/components/Button.js"]);
    expect(result[0].kind).toBe("dir");
    expect(result[1].kind).toBe("file");
  });

  it("handles deeply nested paths", () => {
    const result = buildFileTree(["/a/b/c/Deep.js"]);
    const a = result.find((n) => n.kind === "dir" && n.name === "a") as Extract<TreeNode, { kind: "dir" }>;
    const b = a.children.find((n) => n.kind === "dir" && n.name === "b") as Extract<TreeNode, { kind: "dir" }>;
    const c = b.children.find((n) => n.kind === "dir" && n.name === "c") as Extract<TreeNode, { kind: "dir" }>;
    expect(c.children).toEqual([
      { kind: "file", name: "Deep.js", path: "/a/b/c/Deep.js" },
    ]);
  });

  it("merges multiple files in the same directory", () => {
    const result = buildFileTree(["/components/A.js", "/components/B.js"]);
    const dir = result.find((n) => n.kind === "dir" && n.name === "components") as Extract<TreeNode, { kind: "dir" }>;
    expect(dir.children).toHaveLength(2);
    const names = dir.children.map((n) => n.name);
    expect(names).toContain("A.js");
    expect(names).toContain("B.js");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ruby/Projects/personal/builder-ai
npm test -- --testPathPatterns="file-tree.test.ts"
```

Expected: FAIL — "Cannot find module '@/lib/file-tree'"

- [ ] **Step 3: Implement `lib/file-tree.ts`**

Create `lib/file-tree.ts`:

```typescript
export type TreeNode =
  | { kind: "file"; name: string; path: string }
  | { kind: "dir"; name: string; path: string; children: TreeNode[] };

/**
 * Converts flat file paths into a tree structure.
 * Directories sort before files; /App.js is always first among root-level files.
 */
export function buildFileTree(paths: string[]): TreeNode[] {
  // Map from dir-path → dir node (for deduplication)
  const dirMap = new Map<string, Extract<TreeNode, { kind: "dir" }>>();
  const roots: TreeNode[] = [];

  function getOrCreateDir(
    segments: string[],
    parentList: TreeNode[]
  ): Extract<TreeNode, { kind: "dir" }> {
    const dirPath = "/" + segments.join("/");
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
    const node: Extract<TreeNode, { kind: "dir" }> = {
      kind: "dir",
      name: segments[segments.length - 1],
      path: dirPath,
      children: [],
    };
    dirMap.set(dirPath, node);
    parentList.push(node);
    return node;
  }

  for (const fullPath of paths) {
    // Strip leading slash and split
    const parts = fullPath.replace(/^\//, "").split("/");
    const fileName = parts[parts.length - 1];
    const dirSegments = parts.slice(0, -1);

    if (dirSegments.length === 0) {
      roots.push({ kind: "file", name: fileName, path: fullPath });
    } else {
      let currentList = roots;
      for (let i = 0; i < dirSegments.length; i++) {
        const dir = getOrCreateDir(dirSegments.slice(0, i + 1), currentList);
        currentList = dir.children;
      }
      currentList.push({ kind: "file", name: fileName, path: fullPath });
    }
  }

  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    // Dirs before files
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    // App.js always first among files
    if (a.kind === "file" && a.name === "App.js") return -1;
    if (b.kind === "file" && b.name === "App.js") return 1;
    return a.name.localeCompare(b.name);
  });
  // Recurse into dirs
  for (const node of nodes) {
    if (node.kind === "dir") sortNodes(node.children);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="file-tree.test.ts"
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/file-tree.ts __tests__/file-tree.test.ts
git commit -m "feat: add buildFileTree utility with TreeNode type"
```

---

## Task 2: Build `FileTreeCodeViewer` component

**Files:**
- Create: `components/preview/file-tree-code-viewer.tsx`
- Create: `__tests__/file-tree-code-viewer.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `__tests__/file-tree-code-viewer.test.tsx`:

```typescript
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTreeCodeViewer } from "@/components/preview/file-tree-code-viewer";

// Mock Monaco — it requires a browser environment
jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor" data-language={language}>
      {value}
    </div>
  ),
}));

const FILES = {
  "/App.js": "export default function App() {}",
  "/components/Button.js": "export function Button() {}",
  "/components/Header.js": "export function Header() {}",
};

describe("FileTreeCodeViewer", () => {
  it("renders file names in the tree", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    expect(screen.getByText("App.js")).toBeInTheDocument();
    expect(screen.getByText("Button.js")).toBeInTheDocument();
    expect(screen.getByText("Header.js")).toBeInTheDocument();
  });

  it("renders directory names in the tree", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    expect(screen.getByText("components")).toBeInTheDocument();
  });

  it("shows Monaco editor on mount with first file (App.js)", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveTextContent("export default function App()");
  });

  it("clicking a file updates Monaco content", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    fireEvent.click(screen.getByText("Button.js"));
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveTextContent("export function Button()");
  });

  it("clicking a directory toggles collapse (hides children)", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    // Initially expanded — Button.js is visible
    expect(screen.getByText("Button.js")).toBeInTheDocument();
    // Click the directory to collapse
    fireEvent.click(screen.getByText("components"));
    expect(screen.queryByText("Button.js")).not.toBeInTheDocument();
    // Click again to expand
    fireEvent.click(screen.getByText("components"));
    expect(screen.getByText("Button.js")).toBeInTheDocument();
  });

  it("shows placeholder when files is empty", () => {
    render(<FileTreeCodeViewer files={{}} />);
    expect(screen.getByText(/选择文件/)).toBeInTheDocument();
  });

  it("infers typescript language for .tsx files", () => {
    render(<FileTreeCodeViewer files={{ "/App.tsx": "const x = 1" }} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("data-language", "typescript");
  });

  it("infers css language for .css files", () => {
    render(<FileTreeCodeViewer files={{ "/styles.css": "body {}" }} />);
    fireEvent.click(screen.getByText("styles.css"));
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("data-language", "css");
  });

  it("falls back to plaintext for unknown extensions", () => {
    render(<FileTreeCodeViewer files={{ "/README.md": "# hello" }} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("data-language", "plaintext");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="file-tree-code-viewer.test.tsx"
```

Expected: FAIL — "Cannot find module '@/components/preview/file-tree-code-viewer'"

- [ ] **Step 3: Implement `FileTreeCodeViewer`**

Create `components/preview/file-tree-code-viewer.tsx`:

```typescript
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { buildFileTree } from "@/lib/file-tree";
import type { TreeNode } from "@/lib/file-tree";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
      加载编辑器...
    </div>
  ),
});

interface FileTreeCodeViewerProps {
  files: Record<string, string>;
}

function inferLanguage(path: string): string {
  const ext = path.split(".").pop() ?? "";
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    css: "css",
    json: "json",
  };
  return map[ext] ?? "plaintext";
}

interface FileTreeProps {
  nodes: TreeNode[];
  activePath: string;
  collapsedDirs: Set<string>;
  onFileClick: (path: string) => void;
  onDirClick: (path: string) => void;
  depth?: number;
}

function FileTree({
  nodes,
  activePath,
  collapsedDirs,
  onFileClick,
  onDirClick,
  depth = 0,
}: FileTreeProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          const isActive = node.path === activePath;
          return (
            <button
              key={node.path}
              data-testid={`tree-file-${node.path}`}
              onClick={() => onFileClick(node.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className={`w-full text-left py-[3px] pr-2 text-xs font-mono truncate transition-colors ${
                isActive
                  ? "bg-[#1e1e1e] text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              }`}
            >
              {node.name}
            </button>
          );
        }

        // dir node
        const isCollapsed = collapsedDirs.has(node.path);
        return (
          <div key={node.path}>
            <button
              data-testid={`tree-dir-${node.path}`}
              onClick={() => onDirClick(node.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className="w-full text-left py-[3px] pr-2 text-xs font-mono text-gray-300 hover:text-white flex items-center gap-1 truncate"
            >
              <span className="text-[10px]">{isCollapsed ? "▶" : "▼"}</span>
              {node.name}
            </button>
            {!isCollapsed && (
              <FileTree
                nodes={node.children}
                activePath={activePath}
                collapsedDirs={collapsedDirs}
                onFileClick={onFileClick}
                onDirClick={onDirClick}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function FileTreeCodeViewer({ files }: FileTreeCodeViewerProps) {
  const paths = Object.keys(files);
  const tree = buildFileTree(paths);

  // Default to App.js or first file
  const defaultPath =
    paths.find((p) => p === "/App.js") ?? paths[0] ?? "";

  const [activePath, setActivePath] = useState(defaultPath);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  function handleDirClick(dirPath: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }

  if (paths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
        选择文件以查看代码
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: File Tree */}
      <div className="w-[200px] shrink-0 bg-[#252526] border-r border-[#1e1e1e] overflow-y-auto">
        <FileTree
          nodes={tree}
          activePath={activePath}
          collapsedDirs={collapsedDirs}
          onFileClick={setActivePath}
          onDirClick={handleDirClick}
        />
      </div>

      {/* Right: Read-only Monaco editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          height="100%"
          language={inferLanguage(activePath)}
          theme="vs-dark"
          value={files[activePath] ?? ""}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="file-tree-code-viewer.test.tsx"
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/preview/file-tree-code-viewer.tsx __tests__/file-tree-code-viewer.test.tsx
git commit -m "feat: add FileTreeCodeViewer component with collapsible tree + read-only Monaco"
```

---

## Task 3: Wire `FileTreeCodeViewer` into `PreviewPanel`

**Files:**
- Modify: `components/preview/preview-panel.tsx`
- Modify: `__tests__/preview-panel.test.tsx`

- [ ] **Step 1: Update the preview-panel test mock**

In `__tests__/preview-panel.test.tsx`, replace the `multi-file-editor` mock with `file-tree-code-viewer`:

```typescript
// Replace this:
jest.mock("@/components/preview/multi-file-editor", () => ({
  MultiFileEditor: () => <div data-testid="code-editor">editor</div>,
}));

// With this:
jest.mock("@/components/preview/file-tree-code-viewer", () => ({
  FileTreeCodeViewer: () => <div data-testid="code-editor">editor</div>,
}));
```

- [ ] **Step 2: Run the existing preview-panel tests to see them fail (or pass with old import)**

```bash
npm test -- --testPathPatterns="preview-panel.test.tsx"
```

Expected: Tests may still pass (mock is by path, not component content) — this step confirms baseline before the swap.

- [ ] **Step 3: Update `preview-panel.tsx` — swap import and usage**

In `components/preview/preview-panel.tsx`:

Replace the import:
```typescript
// Remove:
import { MultiFileEditor } from "@/components/preview/multi-file-editor";

// Add:
import { FileTreeCodeViewer } from "@/components/preview/file-tree-code-viewer";
```

Replace the code tab render (around line 205):
```typescript
// Remove:
<MultiFileEditor files={files} onFilesChange={onFilesChange} />

// Add:
<FileTreeCodeViewer files={files} />
```

- [ ] **Step 4: Run all preview-panel tests**

```bash
npm test -- --testPathPatterns="preview-panel.test.tsx"
```

Expected: All tests PASS (the mock is now keyed to the new path; `code-editor` testid is preserved in the mock)

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: All tests PASS. If `multi-file-editor` snapshot/mock tests fail, they are stale — remove or update them.

- [ ] **Step 6: Commit**

```bash
git add components/preview/preview-panel.tsx __tests__/preview-panel.test.tsx
git commit -m "feat: wire FileTreeCodeViewer into PreviewPanel code tab"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open http://localhost:3000 in a browser.

- [ ] **Step 2: Verify the code tab**

1. Create or open a project that has generated multi-file code (e.g. with `/App.js` and `/components/Button.js`)
2. Click the "代码" tab
3. Confirm: left panel shows a file tree with directory nodes and file nodes
4. Click a directory — confirm it collapses (children disappear) and expands on second click
5. Click a file — confirm Monaco on the right updates to show that file's content
6. Confirm Monaco is read-only (try typing — nothing should happen)
7. Confirm the language is correctly inferred (`.js` files show JS syntax highlighting)

- [ ] **Step 3: Verify the preview tab is unaffected**

Click "预览" — confirm the preview iframe still renders correctly.

- [ ] **Step 4: Final commit if any minor fixes were needed**

```bash
git add -p
git commit -m "fix: file tree code viewer smoke test adjustments"
```

---

## Self-Review Notes

- **Spec coverage:** All sections covered — TreeNode type ✓, buildFileTree ✓, collapsible dirs ✓, read-only Monaco ✓, language inference ✓, empty state ✓, preview-panel swap ✓, MultiFileEditor retained ✓
- **No placeholders:** All steps have concrete code
- **Type consistency:** `TreeNode`, `buildFileTree`, `FileTreeCodeViewer`, `FileTreeProps` are consistent across all tasks
- **onFilesChange:** removed from the code-tab render path in Task 3 — `PreviewPanel` prop `onFilesChange` still exists for other uses, just not passed to the code viewer
