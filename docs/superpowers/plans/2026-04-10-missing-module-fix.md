# Missing Module Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Sandpack white-screen crashes caused by AI engineer generating imports to local files that were never created in the scaffold.

**Architecture:** Three-layer defence: (1) prompt reinforcement to reduce hallucinated imports at source, (2) post-generation scan in `chat-area.tsx` that surfaces a clear error to the user when missing imports are detected, (3) Sandpack stub injection in `buildSandpackConfig` as last-resort crash prevention.

**Tech Stack:** TypeScript, Next.js 14, React 18, `@codesandbox/sandpack-react`, Jest (unit tests)

---

## File Map

| File | Change |
|------|--------|
| `lib/extract-code.ts` | Add `findMissingLocalImports(files)` |
| `lib/sandpack-config.ts` | Import and call `findMissingLocalImports`; inject stubs |
| `lib/generate-prompts.ts` | Add `【本地文件导入限制】` rule to `getMultiFileEngineerPrompt` |
| `components/workspace/chat-area.tsx` | Call `findMissingLocalImports` after layer merge; set error state if non-empty |
| `__tests__/extract-code.test.ts` | Add tests for `findMissingLocalImports` |
| `__tests__/sandpack-config.test.ts` | New file: tests for `buildSandpackConfig` stub injection |

---

## Task 1: Add `findMissingLocalImports` to `lib/extract-code.ts`

**Files:**
- Modify: `lib/extract-code.ts` (append at end)
- Test: `__tests__/extract-code.test.ts` (append new describe block)

- [ ] **Step 1: Write failing tests**

Append to `__tests__/extract-code.test.ts`:

```typescript
import { findMissingLocalImports } from "@/lib/extract-code";

describe("findMissingLocalImports", () => {
  it("returns empty array when all local imports are present", () => {
    const files = {
      "/App.js": `import { foo } from '/utils/helpers.js'`,
      "/utils/helpers.js": `export const foo = () => null;`,
    };
    expect(findMissingLocalImports(files)).toEqual([]);
  });

  it("returns missing path when a local import is not in files", () => {
    const files = {
      "/components/TaskDetailView.js": `import { formatDate } from '/utils/format.js'`,
    };
    expect(findMissingLocalImports(files)).toEqual(["/utils/format.js"]);
  });

  it("deduplicates missing paths imported from multiple files", () => {
    const files = {
      "/A.js": `import { x } from '/utils/format.js'`,
      "/B.js": `import { y } from '/utils/format.js'`,
    };
    expect(findMissingLocalImports(files)).toEqual(["/utils/format.js"]);
  });

  it("always whitelists /supabaseClient.js", () => {
    const files = {
      "/App.js": `import { supabase } from '/supabaseClient.js'`,
    };
    expect(findMissingLocalImports(files)).toEqual([]);
  });

  it("ignores external package imports (no leading slash)", () => {
    const files = {
      "/App.js": `import { Plus } from 'lucide-react'`,
    };
    expect(findMissingLocalImports(files)).toEqual([]);
  });

  it("handles multiple missing imports in the same file", () => {
    const files = {
      "/App.js": [
        `import { formatDate } from '/utils/format.js'`,
        `import { calcTotal } from '/utils/math.js'`,
      ].join("\n"),
    };
    const result = findMissingLocalImports(files);
    expect(result).toHaveLength(2);
    expect(result).toContain("/utils/format.js");
    expect(result).toContain("/utils/math.js");
  });

  it("returns empty array for empty files map", () => {
    expect(findMissingLocalImports({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="extract-code"
```

Expected: 7 new tests fail with "findMissingLocalImports is not a function"

- [ ] **Step 3: Implement `findMissingLocalImports` in `lib/extract-code.ts`**

Append at the end of `lib/extract-code.ts`:

```typescript
const LOCAL_IMPORT_RE = /from\s+['"](\/.+?)['"]/g;
const WHITELISTED_LOCAL = new Set(["/supabaseClient.js"]);

/**
 * Scan all generated files for imports of local paths ('/...') that are not
 * present in the files map. Returns a deduplicated list of missing paths.
 * /supabaseClient.js is always whitelisted (it is injected by buildSandpackConfig).
 */
export function findMissingLocalImports(
  files: Record<string, string>
): string[] {
  const presentPaths = new Set(Object.keys(files));
  const missing = new Set<string>();

  for (const code of Object.values(files)) {
    LOCAL_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LOCAL_IMPORT_RE.exec(code)) !== null) {
      const importedPath = match[1];
      if (!WHITELISTED_LOCAL.has(importedPath) && !presentPaths.has(importedPath)) {
        missing.add(importedPath);
      }
    }
  }

  return Array.from(missing);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="extract-code"
```

Expected: all 25 existing tests + 7 new tests pass (32 total)

- [ ] **Step 5: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat: add findMissingLocalImports to detect hallucinated scaffold imports"
```

---

## Task 2: Sandpack stub injection in `lib/sandpack-config.ts`

**Files:**
- Modify: `lib/sandpack-config.ts`
- Test: `__tests__/sandpack-config.test.ts` (new file)

- [ ] **Step 1: Write failing tests**

Create `__tests__/sandpack-config.test.ts`:

```typescript
import { buildSandpackConfig } from "@/lib/sandpack-config";

describe("buildSandpackConfig", () => {
  it("injects a stub for a missing local import", () => {
    const files = {
      "/App.js": `import { formatDate } from '/utils/format.js'\nexport default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/utils/format.js"]).toBeDefined();
    expect(config.files["/utils/format.js"].code).toContain("console.warn");
    expect(config.files["/utils/format.js"].hidden).toBe(true);
  });

  it("does not inject a stub when all local imports are present", () => {
    const files = {
      "/App.js": `import { foo } from '/utils/helpers.js'\nexport default function App() { return null; }`,
      "/utils/helpers.js": `export const foo = () => null;`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    // /utils/helpers.js should come from userFiles, not be a stub
    expect(config.files["/utils/helpers.js"].code).toBe(`export const foo = () => null;`);
    expect(config.files["/utils/helpers.js"].hidden).toBeUndefined();
  });

  it("does not inject a stub for /supabaseClient.js", () => {
    const files = {
      "/App.js": `import { supabase } from '/supabaseClient.js'\nexport default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    // supabaseClient.js is always injected by buildSandpackConfig itself
    expect(config.files["/supabaseClient.js"].code).toContain("createClient");
  });

  it("injects stubs for multiple missing imports", () => {
    const files = {
      "/App.js": [
        `import { formatDate } from '/utils/format.js'`,
        `import { calcTotal } from '/utils/math.js'`,
        `export default function App() { return null; }`,
      ].join("\n"),
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/utils/format.js"]).toBeDefined();
    expect(config.files["/utils/math.js"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="sandpack-config"
```

Expected: 4 tests fail (sandpack-config module not found or stubs not injected)

- [ ] **Step 3: Implement stub injection in `lib/sandpack-config.ts`**

Read the current file first, then add the import and injection logic.

At the top of `lib/sandpack-config.ts`, add the import:

```typescript
import { findMissingLocalImports } from "@/lib/extract-code";
```

Inside `buildSandpackConfig`, after the loop that builds `sandpackFiles` and before injecting `/supabaseClient.js`, add:

```typescript
  // Inject stubs for any local imports the AI generated but never created.
  // This prevents a Sandpack white-screen crash; the stub logs a console.warn
  // so the missing module is visible in devtools.
  const missingPaths = findMissingLocalImports(userFiles);
  for (const missingPath of missingPaths) {
    sandpackFiles[missingPath] = {
      code: `// Auto-stub: ${missingPath} was not generated by AI\nexport default new Proxy({}, {\n  get(_, key) {\n    console.warn(\`[Builder AI] Missing module stub: ${missingPath} — "\${String(key)}" called on missing module\`);\n    return () => null;\n  }\n});`,
      hidden: true,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="sandpack-config"
```

Expected: all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/sandpack-config.ts __tests__/sandpack-config.test.ts
git commit -m "feat: inject Sandpack stubs for missing local imports to prevent white-screen crash"
```

---

## Task 3: User-visible error in `components/workspace/chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx` (around line 495)

This task has no unit test — the error display path is covered by existing component render infrastructure and the integration is straightforward. Manual verification is sufficient.

- [ ] **Step 1: Add the import for `findMissingLocalImports`**

In `components/workspace/chat-area.tsx`, find the existing extract-code imports:

```typescript
import { extractPmOutput, extractScaffoldFromTwoPhase } from "@/lib/extract-json";
```

Add `findMissingLocalImports` to the imports from `@/lib/extract-code`. The existing `runLayerWithFallback` import is from `@/lib/engineer-circuit`. Add a new import line:

```typescript
import { findMissingLocalImports } from "@/lib/extract-code";
```

- [ ] **Step 2: Insert missing-import check before `onFilesGenerated` in the multi-file path**

Locate this block (around line 495–506):

```typescript
            if (Object.keys(allCompletedFiles).length > 0) {
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
            }
```

Replace with:

```typescript
            if (Object.keys(allCompletedFiles).length > 0) {
              const missingImports = findMissingLocalImports(allCompletedFiles);
              if (missingImports.length > 0) {
                setGenerationError({
                  code: "parse_failed",
                  raw: `AI 生成的代码引用了未创建的文件：${missingImports.join("、")}。请重新生成。`,
                });
              }
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
            }
```

Note: `onFilesGenerated` is still called even when there are missing imports — this ensures the Sandpack stub (Task 2) gets a chance to render something instead of a blank screen.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: show user-visible error when generated files contain missing local imports"
```

---

## Task 4: Prompt reinforcement in `lib/generate-prompts.ts`

**Files:**
- Modify: `lib/generate-prompts.ts`

- [ ] **Step 1: Locate the insertion point**

In `getMultiFileEngineerPrompt`, find the existing `【严禁包限制】` block (line ~183). The new rule goes immediately after it, before the `设计说明：` line.

The current structure around that area is:

```
绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
...

UI 样式只使用 Tailwind CSS class。
...

如需数据持久化，使用沙箱预置的 Supabase 客户端：
...

设计说明：${designNotes}
```

- [ ] **Step 2: Add the local import restriction rule**

In `lib/generate-prompts.ts`, find the line:

```typescript
  return `你是一位全栈工程师。根据架构师的文件脚手架，实现以下目标文件。
```

And locate the section that ends with `HTTP 请求只使用原生 fetch API。` (before the Supabase block). After that line, add:

```
【本地文件导入限制】
只允许 import 以下本地路径：
- 当前目标文件的 deps 列表中明确列出的文件路径
- /supabaseClient.js
禁止 import 任何未在 deps 中出现的本地路径（如 /utils/format.js、/helpers/xxx.js 等）。
如果需要工具函数，必须在当前文件内自己实现，不得假设存在其他文件。
```

The full modified section should read:

```typescript
UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。若需同时从 lucide-react 和本地组件文件导入同名符号，必须对图标做别名：import { Calculator as CalculatorIcon } from 'lucide-react'，JSX 中使用别名。
HTTP 请求只使用原生 fetch API。

【本地文件导入限制】
只允许 import 以下本地路径：
- 当前目标文件的 deps 列表中明确列出的文件路径
- /supabaseClient.js
禁止 import 任何未在 deps 中出现的本地路径（如 /utils/format.js、/helpers/xxx.js 等）。
如果需要工具函数，必须在当前文件内自己实现，不得假设存在其他文件。

如需数据持久化，使用沙箱预置的 Supabase 客户端：
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run all tests to confirm nothing regressed**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/generate-prompts.ts
git commit -m "feat: add local file import restriction rule to multi-file engineer prompt"
```
