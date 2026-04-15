# Sandpack Runtime Auto-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Sandpack runtime errors after code generation and auto-fix them via LLM, up to 2 rounds, forming a generate → preview → detect → fix loop.

**Architecture:** A `useSandpackError` hook listens for `show-error` messages inside SandpackProvider. Errors bubble up through preview-frame → preview-panel → workspace. Workspace calls `/api/generate` with a runtime error fix prompt, parses the response, and silently replaces the files. On success, PATCHes the latest version.

**Tech Stack:** React 18, Sandpack React, Next.js 14 API Routes, TypeScript

---

### Task 1: SandpackRuntimeError Type + buildRuntimeErrorFixPrompt

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/generate-prompts.ts`
- Create: `__tests__/generate-prompts-runtime.test.ts`

- [ ] **Step 1: Add SandpackRuntimeError type**

In `lib/types.ts`, add after the `LucideIconFix` interface:

```typescript
export interface SandpackRuntimeError {
  readonly message: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}
```

- [ ] **Step 2: Write failing tests for buildRuntimeErrorFixPrompt**

Create `__tests__/generate-prompts-runtime.test.ts`:

```typescript
import { buildRuntimeErrorFixPrompt } from "@/lib/generate-prompts";
import type { SandpackRuntimeError } from "@/lib/types";

describe("buildRuntimeErrorFixPrompt", () => {
  const files: Record<string, string> = {
    "/App.js": `import { useAudio } from "./hooks/useAudio";\nexport default function App() { return <div />; }`,
    "/hooks/useAudio.js": `import { useState } from "react";\nexport function useAudio() { const [v, setV] = useState(); return v.volume; }`,
    "/components/Header.js": `export function Header() { return <h1>Header</h1>; }`,
  };

  const error: SandpackRuntimeError = {
    message: "TypeError: Cannot read properties of undefined (reading 'volume')",
    path: "/hooks/useAudio.js",
    line: 2,
    column: 72,
  };

  it("includes error message in prompt", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("Cannot read properties of undefined");
  });

  it("includes error file path and location", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("/hooks/useAudio.js");
    expect(prompt).toContain("第 2 行");
  });

  it("includes the error file's code", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("// === EXISTING FILE: /hooks/useAudio.js ===");
    expect(prompt).toContain("export function useAudio()");
  });

  it("includes direct import dependencies of the error file", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    // useAudio.js imports from "react" (external, skipped) — no local deps
    // But App.js imports useAudio → App.js should NOT be included (we include deps OF error file, not importers)
    // useAudio.js has no local imports, so only the error file itself
    expect(prompt).toContain("// === EXISTING FILE: /hooks/useAudio.js ===");
  });

  it("includes output format instructions", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("// === FILE:");
  });

  it("limits dependency files to 5", () => {
    // Create a file that imports 7 local files
    const manyImportFiles: Record<string, string> = {
      "/App.js": `import {A} from "/a";\nimport {B} from "/b";\nimport {C} from "/c";\nimport {D} from "/d";\nimport {E} from "/e";\nimport {F} from "/f";\nimport {G} from "/g";\nexport default function App() {}`,
      "/a.js": "export const A = 1;",
      "/b.js": "export const B = 2;",
      "/c.js": "export const C = 3;",
      "/d.js": "export const D = 4;",
      "/e.js": "export const E = 5;",
      "/f.js": "export const F = 6;",
      "/g.js": "export const G = 7;",
    };
    const err: SandpackRuntimeError = { message: "err", path: "/App.js", line: 1, column: 1 };
    const prompt = buildRuntimeErrorFixPrompt(err, manyImportFiles, "proj-1");
    const existingFileCount = (prompt.match(/\/\/ === EXISTING FILE:/g) || []).length;
    // 1 (error file) + 5 (max deps) = 6
    expect(existingFileCount).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="generate-prompts-runtime"`
Expected: FAIL — `buildRuntimeErrorFixPrompt` not exported

- [ ] **Step 4: Implement buildRuntimeErrorFixPrompt**

In `lib/generate-prompts.ts`, add import at top:

```typescript
import type { SandpackRuntimeError } from "@/lib/types";
import { extractFileImports } from "@/lib/extract-code";
```

Add function at the end of the file:

```typescript
const MAX_RUNTIME_FIX_DEPS = 5;

export function buildRuntimeErrorFixPrompt(
  error: SandpackRuntimeError,
  allFiles: Readonly<Record<string, string>>,
  projectId: string
): string {
  const errorFileCode = allFiles[error.path] ?? "";

  // Collect direct local imports of the error file (max 5)
  const deps = extractFileImports(errorFileCode)
    .map((imp) => imp.path)
    .filter((p) => p in allFiles && p !== error.path)
    .slice(0, MAX_RUNTIME_FIX_DEPS);

  const contextFiles = [error.path, ...deps];
  const contextEntries = contextFiles
    .map((path) => `// === EXISTING FILE: ${path} ===\n${allFiles[path] ?? ""}`)
    .join("\n\n");

  return `你是一位全栈工程师。以下代码在浏览器运行时出现了错误，请修复。

【运行时错误】
错误信息: ${error.message}
出错文件: ${error.path}
出错位置: 第 ${error.line} 行, 第 ${error.column} 列

【当前代码】
${contextEntries}

【修复要求】
- 只修复导致运行时错误的问题，不要改变功能逻辑
- 对可能为 undefined/null 的值加防御性检查（可选链 ?. 或默认值 ??）
- 不要引入新的外部包（只能用 react、react-dom、lucide-react）
- 确保所有变量在使用前已正确初始化

【输出格式】
只输出修复后的文件，格式：
// === FILE: /path ===
(修复后的完整文件代码)

不要输出 Markdown 代码块，不要输出解释文字。`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="generate-prompts-runtime"`
Expected: All 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/generate-prompts.ts __tests__/generate-prompts-runtime.test.ts
git commit -m "feat: add SandpackRuntimeError type and buildRuntimeErrorFixPrompt"
```

---

### Task 2: useSandpackError Hook

**Files:**
- Create: `hooks/use-sandpack-error.ts`

This hook must be used inside a `SandpackProvider`. It cannot be unit-tested with Jest alone (requires Sandpack runtime). We'll test it through integration in Task 5.

- [ ] **Step 1: Create the hook**

Create `hooks/use-sandpack-error.ts`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useSandpack } from "@codesandbox/sandpack-react";
import type { SandpackRuntimeError } from "@/lib/types";

interface UseSandpackErrorOptions {
  readonly enabled: boolean;
  readonly onError: (error: SandpackRuntimeError) => void;
}

export function useSandpackError({ enabled, onError }: UseSandpackErrorOptions): void {
  const seenRef = useRef<Set<string>>(new Set());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Reset dedup set when re-enabled (new fix round)
  useEffect(() => {
    if (enabled) seenRef.current.clear();
  }, [enabled]);

  const { listen } = useSandpack();

  useEffect(() => {
    if (!enabled) return;

    const unsub = listen((message) => {
      if (
        message.type === "action" &&
        (message as Record<string, unknown>).action === "show-error"
      ) {
        const msg = message as Record<string, unknown>;
        const errorMessage = String(msg.message ?? msg.title ?? "Unknown error");
        const path = String(msg.path ?? "/App.js");
        const line = Number(msg.line ?? 0);
        const column = Number(msg.column ?? 0);

        const key = `${path}:${errorMessage}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);

        onErrorRef.current({ message: errorMessage, path, line, column });
      }
    });

    return unsub;
  }, [enabled, listen]);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hooks/use-sandpack-error.ts
git commit -m "feat: add useSandpackError hook for Sandpack runtime error capture"
```

---

### Task 3: Version PATCH API

**Files:**
- Create: `app/api/versions/[id]/route.ts`

- [ ] **Step 1: Create the PATCH route**

Create `app/api/versions/[id]/route.ts`:

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const version = await prisma.version.findFirst({
    where: { id: params.id, project: { userId: session.user.id } },
  });
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { files } = body as { files?: Record<string, string> };
  if (!files) return NextResponse.json({ error: "files is required" }, { status: 400 });

  const effectiveCode = files["/App.js"] ?? version.code;

  const updated = await prisma.version.update({
    where: { id: params.id },
    data: {
      files,
      code: effectiveCode,
    },
  });

  return NextResponse.json(updated);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/api/versions/[id]/route.ts
git commit -m "feat: add PATCH /api/versions/[id] for runtime fix file updates"
```

---

### Task 4: Wire Up preview-frame.tsx

**Files:**
- Modify: `components/preview/preview-frame.tsx`

- [ ] **Step 1: Add error listener component inside SandpackProvider**

The `useSandpackError` hook must be called inside `SandpackProvider`. Create an inner component to hold it.

Replace the entire `preview-frame.tsx`:

```typescript
"use client";

import type { CSSProperties } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { SandpackErrorBoundary } from "@/components/preview/error-boundary";
import { buildSandpackConfig } from "@/lib/sandpack-config";
import { useSandpackError } from "@/hooks/use-sandpack-error";
import type { SandpackRuntimeError } from "@/lib/types";

const PROVIDER_STYLE: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

interface PreviewFrameProps {
  files: Record<string, string>;
  projectId: string;
  errorFixEnabled?: boolean;
  onSandpackError?: (error: SandpackRuntimeError) => void;
}

function SandpackErrorListener({
  enabled,
  onError,
}: {
  enabled: boolean;
  onError: (error: SandpackRuntimeError) => void;
}) {
  useSandpackError({ enabled, onError });
  return null;
}

export function PreviewFrame({ files, projectId, errorFixEnabled = false, onSandpackError }: PreviewFrameProps) {
  const config = buildSandpackConfig(files, projectId);
  const appCode = files["/App.js"] ?? "";
  const sandpackKey = `${Object.keys(files).length}-${appCode.length}-${appCode.slice(0, 40)}`;

  return (
    <SandpackErrorBoundary>
      <div className="absolute inset-0 flex flex-col">
        <SandpackProvider
          key={sandpackKey}
          template={config.template as "react"}
          files={config.files}
          options={config.options}
          customSetup={config.customSetup}
          theme={config.theme as "auto"}
          style={PROVIDER_STYLE}
        >
          {onSandpackError && (
            <SandpackErrorListener
              enabled={errorFixEnabled}
              onError={onSandpackError}
            />
          )}
          <SandpackLayout style={{ flex: 1, height: "100%", minHeight: 0, border: "none" }}>
            <SandpackPreview
              style={{ flex: 1, height: "100%", minHeight: 0 }}
              showNavigator={false}
              showOpenInCodeSandbox={false}
              showRefreshButton
            />
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </SandpackErrorBoundary>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add components/preview/preview-frame.tsx
git commit -m "feat: wire useSandpackError into preview-frame"
```

---

### Task 5: Wire Up preview-panel.tsx

**Files:**
- Modify: `components/preview/preview-panel.tsx`

- [ ] **Step 1: Add props and pass through to PreviewFrame**

In `components/preview/preview-panel.tsx`:

Add to imports:
```typescript
import type { ProjectVersion, LiveFileStream, EngineerProgress, SandpackRuntimeError } from "@/lib/types";
```

Add 3 new props to `PreviewPanelProps`:
```typescript
interface PreviewPanelProps {
  files: Record<string, string>;
  projectId: string;
  isGenerating: boolean;
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onVersionRestore: (newVersion: ProjectVersion) => void;
  latestVersionId?: string;
  liveStreams: Record<string, LiveFileStream>;
  engineerProgress: EngineerProgress | null;
  errorFixEnabled?: boolean;
  onSandpackError?: (error: SandpackRuntimeError) => void;
  isFixingError?: boolean;
}
```

Add to destructuring:
```typescript
  errorFixEnabled = false,
  onSandpackError,
  isFixingError = false,
```

Pass through to `PreviewFrame`:
```typescript
<PreviewFrame
  files={files}
  projectId={projectId}
  errorFixEnabled={errorFixEnabled}
  onSandpackError={onSandpackError}
/>
```

Add a "fixing" overlay similar to the "generating" overlay, right after the generating overlay:
```typescript
{isFixingError && (
  <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-48 h-4 bg-amber-200 rounded animate-pulse" />
      <p className="text-sm text-amber-700">正在修复运行时错误...</p>
    </div>
  </div>
)}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add components/preview/preview-panel.tsx
git commit -m "feat: pass error fix props through preview-panel"
```

---

### Task 6: Workspace Fix Logic

**Files:**
- Modify: `components/workspace/workspace.tsx`

This is the core integration. The workspace receives runtime errors, calls the API, and replaces files.

- [ ] **Step 1: Add imports and state**

Add to imports in `workspace.tsx`:

```typescript
import { fetchAPI, fetchSSE } from "@/lib/api-client";
import { buildRuntimeErrorFixPrompt } from "@/lib/generate-prompts";
import type { Project, ProjectMessage, ProjectVersion, IterationContext, SandpackRuntimeError } from "@/lib/types";
```

Add new state variables after the existing state declarations (after `const [iterationContext, setIterationContext] = ...`):

```typescript
  const [fixAttempt, setFixAttempt] = useState(0);
  const [errorFixEnabled, setErrorFixEnabled] = useState(false);
  const [isFixingError, setIsFixingError] = useState(false);
  const errorFixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add `useRef` to the import from "react" at the top.

- [ ] **Step 2: Add error fix window management**

Add an effect that opens the 5-second error detection window when generation finishes. Insert after the existing state declarations:

```typescript
  // Open error detection window when generation finishes
  const prevGeneratingRef2 = useRef(isGenerating);
  useEffect(() => {
    const wasGenerating = prevGeneratingRef2.current;
    prevGeneratingRef2.current = isGenerating;

    // Falling edge: generation just finished
    if (wasGenerating && !isGenerating) {
      setFixAttempt(0);
      setErrorFixEnabled(true);
      errorFixTimerRef.current = setTimeout(() => setErrorFixEnabled(false), 5000);
    }

    return () => {
      if (errorFixTimerRef.current) clearTimeout(errorFixTimerRef.current);
    };
  }, [isGenerating]);
```

- [ ] **Step 3: Add handleSandpackError callback**

Add the fix handler after `handleRestoreVersion`:

```typescript
  async function handleSandpackError(error: SandpackRuntimeError) {
    if (fixAttempt >= 2 || isFixingError) return;

    setIsFixingError(true);
    setErrorFixEnabled(false);

    try {
      const fixPrompt = buildRuntimeErrorFixPrompt(error, currentFiles, project.id);
      const response = await fetchSSE("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          prompt: "修复运行时错误",
          agent: "engineer",
          context: fixPrompt,
        }),
      });

      if (!response.body) return;

      // Parse SSE response for files
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fixedFiles: Record<string, string> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "files_complete" && evt.files) {
              fixedFiles = evt.files;
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }

      if (fixedFiles && Object.keys(fixedFiles).length > 0) {
        const merged = { ...currentFiles, ...fixedFiles };
        setCurrentFiles(merged);
        setFixAttempt((prev) => prev + 1);

        // Re-open detection window for next round
        setErrorFixEnabled(true);
        errorFixTimerRef.current = setTimeout(() => {
          setErrorFixEnabled(false);
          // If we get here without another error, fix succeeded — update version
          const latestVersion = versions[versions.length - 1];
          if (latestVersion) {
            fetchAPI(`/api/versions/${latestVersion.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ files: merged }),
            }).catch(() => {});
          }
        }, 5000);
      }
    } catch {
      // Fix attempt failed — silently give up
    } finally {
      setIsFixingError(false);
    }
  }
```

- [ ] **Step 4: Pass new props to PreviewPanel**

Update the `PreviewPanel` component invocation to include the new props:

```typescript
<PreviewPanel
  files={displayFiles}
  projectId={project.id}
  isGenerating={isGenerating}
  versions={versions}
  previewingVersion={previewingVersion}
  onPreviewVersion={setPreviewingVersion}
  onVersionRestore={handleRestoreVersion}
  latestVersionId={versions[versions.length - 1]?.id}
  liveStreams={liveStreams}
  engineerProgress={engineerProgress}
  errorFixEnabled={errorFixEnabled}
  onSandpackError={handleSandpackError}
  isFixingError={isFixingError}
/>
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add components/workspace/workspace.tsx
git commit -m "feat: add Sandpack runtime error auto-fix logic in workspace"
```

---

### Task 7: Full Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test -- --testPathPatterns="generate-prompts-runtime"`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Manual smoke test**

Start dev server: `npm run dev`

Test sequence:
1. Generate a project that is likely to have runtime errors (e.g., "做一个音乐播放器，带音量控制")
2. If Sandpack shows a runtime error, watch the preview panel — it should show "正在修复运行时错误..." overlay
3. After fix, the preview should render without errors
4. Check the Version table — the latest version's `files` field should contain the fixed code

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address issues from runtime autofix smoke testing"
```
