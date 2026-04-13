# Code Tab Live Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Activity tab with an enhanced 代码 (code) tab that shows real-time file-generation output. During generation the file tree auto-follows the streaming file and the right panel shows a dark `<pre>` with blinking cursor instead of Monaco. After generation, normal static Monaco read-only view is restored. `activity-panel.tsx` and `file-block.tsx` remain in the repo but are no longer used by `PreviewPanel`.

**Architecture:** `PreviewPanel` drops `"activity"` from its `Tab` union and re-points the auto-switch `useEffect` at `"code"`. It passes `liveStreams` and `engineerProgress` (already in its props) down to `FileTreeCodeViewer` instead of `ActivityPanel`. `FileTreeCodeViewer` gains optional `liveStreams` / `engineerProgress` props, merges streaming paths into the tree, auto-follows new `file_start` paths (via `userClickedRef`), and conditionally renders a dark `<pre>` with `useAutoScrollToBottom` when a file is actively streaming.

**Tech stack:** TypeScript strict mode, Next.js 14, React 18, Jest (jsdom project for `.tsx` files), `@testing-library/react`, existing `useAutoScrollToBottom` hook, existing Monaco dynamic import.

**No-touch perimeter:** All generation logic, prompts, parsers, SSE handling, `activity-panel.tsx`, `file-block.tsx`, `workspace.tsx`, all lib files.

---

## File Structure

**Modified:**

| Path | Change summary |
|---|---|
| `components/preview/file-tree-code-viewer.tsx` | Add `liveStreams` + `engineerProgress` optional props; merge streaming paths; auto-follow; status indicators; streaming `<pre>` area |
| `components/preview/preview-panel.tsx` | Remove `"activity"` tab; change auto-switch to `"code"`; remove `ActivityPanel` branch and import |
| `__tests__/preview-panel-activity-tab.test.tsx` | Rewrite — tests now cover code tab auto-switch |

**New:**

| Path | Responsibility |
|---|---|
| `__tests__/file-tree-code-viewer-streaming.test.tsx` | Unit tests for all streaming-state behaviour of `FileTreeCodeViewer` |

**Explicitly unchanged:**

- `components/preview/activity-panel.tsx` — kept, unused
- `components/preview/file-block.tsx` — kept, unused
- `components/workspace/workspace.tsx` — no changes
- All `lib/` files — no changes
- All other `__tests__/` files — no changes (including `activity-panel.test.tsx`)

---

## Task 1 — Failing tests: `FileTreeCodeViewer` streaming behaviour

**Files:**
- Create: `__tests__/file-tree-code-viewer-streaming.test.tsx`

- [ ] **Step 1: Create the failing test file**

```typescript
// __tests__/file-tree-code-viewer-streaming.test.tsx

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTreeCodeViewer } from "@/components/preview/file-tree-code-viewer";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor" data-language={language}>
      {value}
    </div>
  ),
}));

jest.mock("@/hooks/use-auto-scroll-to-bottom", () => ({
  useAutoScrollToBottom: jest.fn(),
}));

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
  totalLayers: 1,
  currentLayer: 1,
  totalFiles: 1,
  currentFiles: ["/App.js"],
  completedFiles: [],
  failedFiles: [],
  retryInfo: null,
};

const BASE_FILES: Record<string, string> = {
  "/App.js": "export default function App() {}",
  "/components/Button.js": "export function Button() {}",
};

describe("FileTreeCodeViewer — static mode (no liveStreams)", () => {
  it("renders Monaco when liveStreams is undefined", () => {
    render(<FileTreeCodeViewer files={BASE_FILES} />);
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("renders Monaco when liveStreams is empty object", () => {
    render(
      <FileTreeCodeViewer
        files={BASE_FILES}
        liveStreams={{}}
        engineerProgress={null}
      />
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });
});

describe("FileTreeCodeViewer — streaming mode", () => {
  it("FTCV-S-01: shows a streaming path in the tree even when not yet in files", () => {
    const liveStreams = {
      "/NewFile.js": makeStream({ path: "/NewFile.js", content: "const x = 1" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("tree-file-/NewFile.js")).toBeInTheDocument();
  });

  it("FTCV-S-02: merges streaming paths alongside existing files paths", () => {
    const liveStreams = {
      "/components/Button.js": makeStream({
        path: "/components/Button.js",
        content: "streaming...",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{ "/App.js": "done content" }}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("tree-file-/App.js")).toBeInTheDocument();
    expect(screen.getByTestId("tree-file-/components/Button.js")).toBeInTheDocument();
  });

  it("FTCV-S-03: renders <pre data-testid='streaming-pre'> instead of Monaco when active file is streaming", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "const x = 1" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("streaming-pre")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
  });

  it("FTCV-S-04: streaming <pre> displays the current content", () => {
    const liveStreams = {
      "/App.js": makeStream({
        path: "/App.js",
        content: "export default function App",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("streaming-pre")).toHaveTextContent(
      "export default function App"
    );
  });

  it("FTCV-S-05: streaming <pre> includes a blinking cursor element", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x" }),
    };
    const { container } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const cursor = container.querySelector("[data-testid='streaming-cursor']");
    expect(cursor).toBeInTheDocument();
  });

  it("FTCV-S-06: renders Monaco (not <pre>) when active file status is 'done'", () => {
    const liveStreams = {
      "/App.js": makeStream({
        path: "/App.js",
        content: "done content",
        status: "done",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("streaming-pre")).not.toBeInTheDocument();
  });

  it("FTCV-S-07: renders Monaco when active file is in authoritative files (self-heal priority)", () => {
    const liveStreams = {
      "/App.js": makeStream({
        path: "/App.js",
        content: "partial content",
        status: "streaming",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{ "/App.js": "final content" }}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("streaming-pre")).not.toBeInTheDocument();
  });

  it("FTCV-S-08: auto-follows the first streaming path (activates it in tree)", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const btn = screen.getByTestId("tree-file-/App.js");
    expect(btn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-09: auto-follows when a new path appears in liveStreams", () => {
    const { rerender } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    rerender(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x", status: "done" }),
          "/components/Button.js": makeStream({
            path: "/components/Button.js",
            content: "new file",
          }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const btn = screen.getByTestId("tree-file-/components/Button.js");
    expect(btn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-10: does NOT auto-follow when user has manually clicked a file", () => {
    const { rerender } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    fireEvent.click(screen.getByTestId("tree-file-/App.js"));
    rerender(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
          "/NewFile.js": makeStream({ path: "/NewFile.js", content: "y" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const appBtn = screen.getByTestId("tree-file-/App.js");
    expect(appBtn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-11: resets user override and resumes auto-follow when liveStreams is cleared", () => {
    const { rerender } = render(
      <FileTreeCodeViewer
        files={{ "/App.js": "done" }}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    fireEvent.click(screen.getByTestId("tree-file-/App.js"));
    rerender(
      <FileTreeCodeViewer
        files={{ "/App.js": "done", "/Other.js": "other" }}
        liveStreams={{}}
        engineerProgress={null}
      />
    );
    rerender(
      <FileTreeCodeViewer
        files={{ "/App.js": "done", "/Other.js": "other" }}
        liveStreams={{
          "/Other.js": makeStream({ path: "/Other.js", content: "new" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const otherBtn = screen.getByTestId("tree-file-/Other.js");
    expect(otherBtn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-12: shows green pulsing dot indicator for streaming file in tree", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x", status: "streaming" }),
    };
    const { container } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const indicator = container.querySelector("[data-testid='status-indicator-/App.js']");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass("bg-green-400");
    expect(indicator).toHaveClass("animate-pulse");
  });

  it("FTCV-S-13: shows grey checkmark indicator for done file in tree", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x", status: "done" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const indicator = screen.getByTestId("status-indicator-/App.js");
    expect(indicator).toHaveTextContent("✓");
  });

  it("FTCV-S-14: shows red ✗ indicator for failed file in tree", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "", status: "failed" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const indicator = screen.getByTestId("status-indicator-/App.js");
    expect(indicator).toHaveTextContent("✗");
  });

  it("FTCV-S-15: no indicator for files that only appear in authoritative files", () => {
    render(
      <FileTreeCodeViewer
        files={{ "/App.js": "settled content" }}
        liveStreams={{}}
        engineerProgress={null}
      />
    );
    expect(screen.queryByTestId("status-indicator-/App.js")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — should fail**

```bash
npm test -- --testPathPatterns="file-tree-code-viewer-streaming" 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module` or prop errors.

- [ ] **Step 3: Commit failing test**

```bash
git add __tests__/file-tree-code-viewer-streaming.test.tsx
git commit -m "test(file-tree-code-viewer): failing tests for streaming state (FTCV-S-01..15)"
```

---

## Task 2 — Failing tests: `PreviewPanel` code tab auto-switch

**Files:**
- Modify: `__tests__/preview-panel-activity-tab.test.tsx`

- [ ] **Step 1: Rewrite the test file**

```typescript
// __tests__/preview-panel-activity-tab.test.tsx

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import type { ProjectVersion, LiveFileStream, EngineerProgress } from "@/lib/types";

jest.mock("@/components/preview/preview-frame", () => ({
  PreviewFrame: () => <div data-testid="preview-frame" />,
}));
jest.mock("@/components/preview/file-tree-code-viewer", () => ({
  FileTreeCodeViewer: (props: {
    files: Record<string, string>;
    liveStreams?: Record<string, LiveFileStream>;
    engineerProgress?: EngineerProgress | null;
  }) => (
    <div
      data-testid="code-viewer"
      data-has-live-streams={
        props.liveStreams !== undefined && Object.keys(props.liveStreams).length > 0
          ? "true"
          : "false"
      }
    />
  ),
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

describe("PreviewPanel — code tab auto-switch (activity tab removed)", () => {
  it("PP-CT-01: does NOT render an activity tab button", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.queryByTestId("tab-activity")).not.toBeInTheDocument();
  });

  it("PP-CT-02: renders preview and code tab buttons", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("tab-preview")).toBeInTheDocument();
    expect(screen.getByTestId("tab-code")).toBeInTheDocument();
  });

  it("PP-CT-03: auto-switches to code tab when isGenerating becomes true", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("code-viewer")).toBeInTheDocument();
  });

  it("PP-CT-04: does not auto-switch to code if user overrode tab before generation", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    fireEvent.click(screen.getByTestId("tab-preview"));
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("code-viewer")).not.toBeInTheDocument();
  });

  it("PP-CT-05: does not auto-switch back if user clicked Preview mid-generation", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("code-viewer")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-preview"));
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
  });

  it("PP-CT-06: passes liveStreams to FileTreeCodeViewer when on code tab", () => {
    const liveStreams: Record<string, LiveFileStream> = {
      "/App.js": {
        path: "/App.js",
        content: "x",
        status: "streaming",
        attempt: 1,
        failedAttempts: [],
      },
    };
    render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} liveStreams={liveStreams} />
    );
    fireEvent.click(screen.getByTestId("tab-code"));
    expect(screen.getByTestId("code-viewer")).toHaveAttribute(
      "data-has-live-streams",
      "true"
    );
  });

  it("PP-CT-07: does not render activity-panel anywhere in the tree", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.queryByTestId("activity-panel")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — should fail**

```bash
npm test -- --testPathPatterns="preview-panel-activity-tab" 2>&1 | tail -10
```
Expected: FAIL — `tab-activity` still exists, auto-switch goes to `"activity"` not `"code"`.

- [ ] **Step 3: Commit failing test**

```bash
git add __tests__/preview-panel-activity-tab.test.tsx
git commit -m "test(preview-panel): rewrite activity-tab tests for code-tab auto-switch"
```

---

## Task 3 — Implement: `FileTreeCodeViewer` streaming support

**Files:**
- Modify: `components/preview/file-tree-code-viewer.tsx`

- [ ] **Step 1: Replace the entire file with the updated implementation**

```typescript
"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { buildFileTree } from "@/lib/file-tree";
import type { TreeNode } from "@/lib/file-tree";
import { useAutoScrollToBottom } from "@/hooks/use-auto-scroll-to-bottom";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

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
  liveStreams?: Record<string, LiveFileStream>;
  engineerProgress?: EngineerProgress | null;
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
  liveStreams: Record<string, LiveFileStream>;
  onFileClick: (path: string) => void;
  onDirClick: (path: string) => void;
  depth?: number;
}

function StatusIndicator({ stream }: { stream: LiveFileStream }) {
  if (stream.status === "streaming") {
    return (
      <span
        data-testid={`status-indicator-${stream.path}`}
        className="ml-auto shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse"
      />
    );
  }
  if (stream.status === "done") {
    return (
      <span
        data-testid={`status-indicator-${stream.path}`}
        className="ml-auto shrink-0 text-[10px] text-gray-400"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      data-testid={`status-indicator-${stream.path}`}
      className="ml-auto shrink-0 text-[10px] text-red-400"
    >
      ✗
    </span>
  );
}

function FileTree({
  nodes,
  activePath,
  collapsedDirs,
  liveStreams,
  onFileClick,
  onDirClick,
  depth = 0,
}: FileTreeProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          const isActive = node.path === activePath;
          const stream = liveStreams[node.path];
          return (
            <button
              key={node.path}
              data-testid={`tree-file-${node.path}`}
              onClick={() => onFileClick(node.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className={`w-full text-left py-[3px] pr-2 text-xs font-mono truncate transition-colors flex items-center gap-1 ${
                isActive
                  ? "bg-[#1e1e1e] text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              }`}
            >
              <span className="flex-1 truncate">{node.name}</span>
              {stream !== undefined && <StatusIndicator stream={stream} />}
            </button>
          );
        }

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
                liveStreams={liveStreams}
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

function StreamingView({ content }: { content: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  useAutoScrollToBottom(preRef, [content]);

  return (
    <div className="flex-1 overflow-hidden bg-[#1e1e1e]">
      <pre
        ref={preRef}
        data-testid="streaming-pre"
        className="h-full overflow-auto p-4 text-xs font-mono text-green-300 whitespace-pre-wrap"
      >
        {content}
        <span
          data-testid="streaming-cursor"
          className="inline-block w-2 h-3 bg-green-300 animate-pulse ml-0.5"
        />
      </pre>
    </div>
  );
}

export function FileTreeCodeViewer({
  files,
  liveStreams: liveStreamsProp,
  engineerProgress: _engineerProgress,
}: FileTreeCodeViewerProps) {
  const liveStreams: Record<string, LiveFileStream> = liveStreamsProp ?? {};

  const mergedPaths = useMemo(() => {
    return Array.from(new Set([...Object.keys(files), ...Object.keys(liveStreams)]));
  }, [files, liveStreams]);

  const tree = useMemo(() => buildFileTree(mergedPaths), [mergedPaths]);

  const defaultPath = useMemo(
    () => mergedPaths.find((p) => p === "/App.js") ?? mergedPaths[0] ?? "",
    [mergedPaths]
  );

  const [activePath, setActivePath] = useState(defaultPath);
  const userClickedRef = useRef(false);
  const resolvedActive = mergedPaths.includes(activePath) ? activePath : defaultPath;
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const prevStreamKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentKeys = new Set(Object.keys(liveStreams));

    // Reset user override when liveStreams is cleared (generation ended)
    if (currentKeys.size === 0 && prevStreamKeysRef.current.size > 0) {
      userClickedRef.current = false;
      prevStreamKeysRef.current = currentKeys;
      return;
    }

    // Find newly added paths
    const newPaths: string[] = [];
    currentKeys.forEach((k) => {
      if (!prevStreamKeysRef.current.has(k)) newPaths.push(k);
    });

    if (newPaths.length > 0 && !userClickedRef.current) {
      setActivePath(newPaths[newPaths.length - 1]);
    }

    prevStreamKeysRef.current = currentKeys;
  }, [liveStreams]);

  function handleFileClick(path: string) {
    userClickedRef.current = true;
    setActivePath(path);
  }

  function handleDirClick(dirPath: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  if (mergedPaths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
        选择文件以查看代码
      </div>
    );
  }

  // Authoritative files wins over streaming; only show <pre> when file is
  // genuinely mid-stream and not yet in the settled files map.
  const activeStream = liveStreams[resolvedActive];
  const showStreamingPre =
    !(resolvedActive in files) &&
    activeStream !== undefined &&
    activeStream.status === "streaming";

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-[200px] shrink-0 bg-[#252526] border-r border-[#1e1e1e] overflow-y-auto">
        <FileTree
          nodes={tree}
          activePath={resolvedActive}
          collapsedDirs={collapsedDirs}
          liveStreams={liveStreams}
          onFileClick={handleFileClick}
          onDirClick={handleDirClick}
        />
      </div>

      {showStreamingPre ? (
        <StreamingView content={activeStream.content} />
      ) : (
        <div className="flex-1 overflow-hidden">
          <MonacoEditor
            height="100%"
            language={inferLanguage(resolvedActive)}
            theme="vs-dark"
            value={files[resolvedActive] ?? activeStream?.content ?? ""}
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
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run streaming tests**

```bash
npm test -- --testPathPatterns="file-tree-code-viewer" 2>&1 | tail -20
```
Expected: ALL pass (17 new + existing).

- [ ] **Step 3: Commit**

```bash
git add components/preview/file-tree-code-viewer.tsx
git commit -m "feat(file-tree-code-viewer): streaming props, auto-follow, status indicators, streaming pre"
```

---

## Task 4 — Implement: `PreviewPanel` remove Activity tab

**Files:**
- Modify: `components/preview/preview-panel.tsx`

- [ ] **Step 1: Apply surgical changes**

  1. Remove import: `import { ActivityPanel } from "@/components/preview/activity-panel";`
  2. Change `type Tab = "preview" | "code" | "activity"` → `type Tab = "preview" | "code"`
  3. In the auto-switch `useEffect`, change `setTab("activity")` → `setTab("code")`
  4. Change tab bar array from `["preview", "code", "activity"] as Tab[]` → `["preview", "code"] as Tab[]`; remove the Activity button's label/pulsing-dot logic; simplify label to `t === "preview" ? "预览" : "代码"`
  5. Replace the three-way content switch (`tab === "preview" ? ... : tab === "code" ? ... : <ActivityPanel>`) with a two-way switch; pass `liveStreams` and `engineerProgress` to `<FileTreeCodeViewer>`

- [ ] **Step 2: Run preview-panel tests**

```bash
npm test -- --testPathPatterns="preview-panel" 2>&1 | tail -20
```
Expected: ALL pass (including the 7 new PP-CT-* tests).

- [ ] **Step 3: Run full suite**

```bash
npm test 2>&1 | tail -15
```
Expected: All suites green.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add components/preview/preview-panel.tsx
git commit -m "feat(preview-panel): remove activity tab, auto-switch to code, pass liveStreams to FileTreeCodeViewer"
```

---

## Design Notes

**Rendering priority** — Authoritative `files` wins over `liveStreams`. When `files_complete` arrives and a path appears in `files`, the streaming `<pre>` is automatically replaced by Monaco with the settled content — no extra code needed, it falls out of the `!(resolvedActive in files)` condition.

**`userClickedRef` is a `useRef` not state** — Setting it must not trigger a re-render. Both writes happen synchronously before state updates so the `useEffect` always reads the correct value.

**`prevStreamKeysRef` diffs new paths** — Without it, every content update for an existing streaming file would re-trigger auto-follow even after the user has clicked away.

**`_engineerProgress`** — Accepted in props for future progress bar sub-component. Underscore prefix suppresses `noUnusedLocals` warning in strict mode.

**Streaming `<pre>` background** — `bg-[#1e1e1e]` matches Monaco `vs-dark` so the streaming→settled transition is visually seamless.
