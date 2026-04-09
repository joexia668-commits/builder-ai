# Multi-File Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-file code generation with scaffold-first, topologically-sorted parallel multi-file generation supporting 15+ files per project.

**Architecture:** Architect agent outputs a structured JSON scaffold (file manifest with dependency graph). Client performs topological sort to determine execution layers, then dispatches parallel Engineer requests per layer. Results are assembled into a `Record<string, string>` and rendered via Sandpack's native multi-file support.

**Tech Stack:** Next.js 14, React 18, Prisma 5, Sandpack, Monaco Editor, TypeScript strict mode

**Spec:** `docs/superpowers/specs/2026-04-09-multi-file-generation-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | Modify | Add `ScaffoldFile`, `ScaffoldData`, `EngineerProgress` types |
| `lib/topo-sort.ts` | Create | Topological sort: files + deps → execution layers |
| `lib/version-files.ts` | Create | `getVersionFiles()` — unified reader for old/new Version format |
| `lib/extract-code.ts` | Modify | Add `extractMultiFileCode()` alongside existing `extractReactCode()` |
| `lib/extract-json.ts` | Modify | Add `extractScaffold()` parser + validator |
| `lib/generate-prompts.ts` | Modify | Rewrite architect prompt (JSON output), add multi-file engineer prompt |
| `lib/agent-context.ts` | Modify | Add `buildMultiFileEngineerContext()` |
| `lib/sandpack-config.ts` | Modify | `buildSandpackConfig()` accepts `Record<string, string>` instead of `string` |
| `prisma/schema.prisma` | Modify | Add `files Json?` field to Version model |
| `app/api/versions/route.ts` | Modify | Accept `files` field, write both `code` + `files` |
| `app/api/generate/route.ts` | Modify | Support `targetFiles`/`completedFiles` params, architect `jsonMode` |
| `components/preview/multi-file-editor.tsx` | Create | File tab bar wrapping existing CodeEditor |
| `components/preview/preview-panel.tsx` | Modify | Props: `code` → `files`, wire MultiFileEditor |
| `components/preview/preview-frame.tsx` | Modify | Props: `code` → `files` |
| `components/workspace/workspace.tsx` | Modify | `currentCode` → `currentFiles` state |
| `components/workspace/chat-area.tsx` | Modify | Multi-layer parallel Engineer orchestration |
| `components/agent/agent-status-bar.tsx` | Modify | Engineer sub-progress display |

---

## Task 1: Types — Add scaffold and multi-file types

**Files:**
- Modify: `lib/types.ts:80-135`

- [ ] **Step 1: Add ScaffoldFile, ScaffoldData, and EngineerProgress types**

Append these types at the end of `lib/types.ts`, before the closing `CodeRenderer` interface (line 129):

```typescript
// Multi-file scaffold types (Architect agent output)
export interface ScaffoldFile {
  readonly path: string;
  readonly description: string;
  readonly exports: readonly string[];
  readonly deps: readonly string[];
  readonly hints: string;
}

export interface ScaffoldData {
  readonly files: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly designNotes: string;
}

// Engineer multi-file generation progress
export interface EngineerProgress {
  readonly totalLayers: number;
  readonly currentLayer: number;
  readonly totalFiles: number;
  readonly currentFiles: readonly string[];
  readonly completedFiles: readonly string[];
  readonly failedFiles: readonly string[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors related to types.ts

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add ScaffoldData and EngineerProgress types for multi-file generation"
```

---

## Task 2: Topological sort — `lib/topo-sort.ts`

**Files:**
- Create: `lib/topo-sort.ts`
- Create: `__tests__/topo-sort.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/topo-sort.test.ts`:

```typescript
import { topologicalSort } from "@/lib/topo-sort";

describe("topologicalSort", () => {
  it("returns single layer for files with no deps", () => {
    const files = [
      { path: "/utils/format.js", deps: [] },
      { path: "/hooks/useAuth.js", deps: [] },
    ];
    const layers = topologicalSort(files);
    expect(layers).toEqual([["/utils/format.js", "/hooks/useAuth.js"]]);
  });

  it("sorts files into correct dependency layers", () => {
    const files = [
      { path: "/App.js", deps: ["/components/Header.js"] },
      { path: "/components/Header.js", deps: ["/hooks/useAuth.js"] },
      { path: "/hooks/useAuth.js", deps: [] },
    ];
    const layers = topologicalSort(files);
    expect(layers).toEqual([
      ["/hooks/useAuth.js"],
      ["/components/Header.js"],
      ["/App.js"],
    ]);
  });

  it("groups independent files in the same layer", () => {
    const files = [
      { path: "/App.js", deps: ["/components/A.js", "/components/B.js"] },
      { path: "/components/A.js", deps: ["/hooks/useX.js"] },
      { path: "/components/B.js", deps: ["/hooks/useX.js"] },
      { path: "/hooks/useX.js", deps: [] },
    ];
    const layers = topologicalSort(files);
    expect(layers[0]).toEqual(["/hooks/useX.js"]);
    expect(layers[1]).toEqual(expect.arrayContaining(["/components/A.js", "/components/B.js"]));
    expect(layers[1]).toHaveLength(2);
    expect(layers[2]).toEqual(["/App.js"]);
  });

  it("throws on circular dependency", () => {
    const files = [
      { path: "/a.js", deps: ["/b.js"] },
      { path: "/b.js", deps: ["/a.js"] },
    ];
    expect(() => topologicalSort(files)).toThrow("Circular dependency");
  });

  it("returns empty array for empty input", () => {
    expect(topologicalSort([])).toEqual([]);
  });

  it("ignores deps that point to files not in the list (external deps)", () => {
    const files = [
      { path: "/App.js", deps: ["/supabaseClient.js"] },
    ];
    const layers = topologicalSort(files);
    expect(layers).toEqual([["/App.js"]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="topo-sort" 2>&1 | tail -5`
Expected: FAIL — Cannot find module `@/lib/topo-sort`

- [ ] **Step 3: Implement topological sort**

Create `lib/topo-sort.ts`:

```typescript
/**
 * Topological sort that groups files into execution layers.
 * Files within a layer have no interdependencies and can be processed in parallel.
 * Layers are ordered so that all dependencies of layer N are in layers 0..N-1.
 *
 * @param files - Array of { path, deps } where deps are paths of other project files
 * @returns Array of layers, each layer is an array of file paths
 * @throws Error if circular dependency is detected
 */
export function topologicalSort(
  files: ReadonlyArray<{ readonly path: string; readonly deps: readonly string[] }>
): string[][] {
  if (files.length === 0) return [];

  const pathSet = new Set(files.map((f) => f.path));

  // Build adjacency: inDegree counts only deps within our file set
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → files that depend on it

  for (const f of files) {
    inDegree.set(f.path, 0);
    dependents.set(f.path, []);
  }

  for (const f of files) {
    for (const dep of f.deps) {
      if (!pathSet.has(dep)) continue; // external dep, ignore
      inDegree.set(f.path, (inDegree.get(f.path) ?? 0) + 1);
      dependents.get(dep)!.push(f.path);
    }
  }

  const layers: string[][] = [];
  let remaining = files.length;

  // Seed: all files with inDegree 0
  let currentLayer = files
    .filter((f) => inDegree.get(f.path) === 0)
    .map((f) => f.path);

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    remaining -= currentLayer.length;

    const nextLayer: string[] = [];
    for (const path of currentLayer) {
      for (const dependent of dependents.get(path) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) nextLayer.push(dependent);
      }
    }
    currentLayer = nextLayer;
  }

  if (remaining > 0) {
    throw new Error("Circular dependency detected in scaffold file graph");
  }

  return layers;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="topo-sort" 2>&1 | tail -10`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/topo-sort.ts __tests__/topo-sort.test.ts
git commit -m "feat: add topological sort for scaffold dependency layers"
```

---

## Task 3: Version files helper — `lib/version-files.ts`

**Files:**
- Create: `lib/version-files.ts`
- Create: `__tests__/version-files.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/version-files.test.ts`:

```typescript
import { getVersionFiles } from "@/lib/version-files";

describe("getVersionFiles", () => {
  it("returns files field when present", () => {
    const version = {
      code: "old code",
      files: { "/App.js": "new code", "/components/Header.js": "header" },
    };
    expect(getVersionFiles(version)).toEqual({
      "/App.js": "new code",
      "/components/Header.js": "header",
    });
  });

  it("wraps legacy code string as /App.js when files is null", () => {
    const version = { code: "export default function App() {}", files: null };
    expect(getVersionFiles(version)).toEqual({
      "/App.js": "export default function App() {}",
    });
  });

  it("wraps legacy code string as /App.js when files is undefined", () => {
    const version = { code: "legacy code" };
    expect(getVersionFiles(version)).toEqual({
      "/App.js": "legacy code",
    });
  });

  it("prefers files over code even if both present", () => {
    const version = {
      code: "fallback",
      files: { "/App.js": "primary", "/utils.js": "util" },
    };
    const result = getVersionFiles(version);
    expect(result["/App.js"]).toBe("primary");
    expect(result["/utils.js"]).toBe("util");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="version-files" 2>&1 | tail -5`
Expected: FAIL — Cannot find module `@/lib/version-files`

- [ ] **Step 3: Implement getVersionFiles**

Create `lib/version-files.ts`:

```typescript
/**
 * Unified reader for Version records.
 * New versions have `files` (Record<string, string>).
 * Old versions only have `code` (string) — wrapped as { "/App.js": code }.
 */
export function getVersionFiles(
  version: { code: string; files?: Record<string, string> | null }
): Record<string, string> {
  if (version.files) return version.files as Record<string, string>;
  return { "/App.js": version.code };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="version-files" 2>&1 | tail -5`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/version-files.ts __tests__/version-files.test.ts
git commit -m "feat: add getVersionFiles helper for backward-compatible multi-file reads"
```

---

## Task 4: Extract multi-file code from LLM output

**Files:**
- Modify: `lib/extract-code.ts`
- Modify: `__tests__/extract-code.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/extract-code.test.ts`:

```typescript
import { extractMultiFileCode } from "@/lib/extract-code";

describe("extractMultiFileCode", () => {
  it("parses two files separated by FILE markers", () => {
    const raw = [
      "// === FILE: /App.js ===",
      "export default function App() { return <div/>; }",
      "// === FILE: /components/Header.js ===",
      "export function Header() { return <header/>; }",
    ].join("\n");
    const result = extractMultiFileCode(raw, ["/App.js", "/components/Header.js"]);
    expect(result).not.toBeNull();
    expect(result!["/App.js"]).toContain("export default function App");
    expect(result!["/components/Header.js"]).toContain("export function Header");
  });

  it("returns null when expected file is missing from output", () => {
    const raw = "// === FILE: /App.js ===\nexport default function App() {}";
    const result = extractMultiFileCode(raw, ["/App.js", "/missing.js"]);
    expect(result).toBeNull();
  });

  it("returns null when a file has unbalanced braces (truncated)", () => {
    const raw = [
      "// === FILE: /App.js ===",
      "export default function App() { return <div/>; }",
      "// === FILE: /broken.js ===",
      "export function Broken() { return (",
    ].join("\n");
    const result = extractMultiFileCode(raw, ["/App.js", "/broken.js"]);
    expect(result).toBeNull();
  });

  it("trims whitespace around each file's code", () => {
    const raw = [
      "// === FILE: /App.js ===",
      "",
      "  export default function App() {}  ",
      "",
      "// === FILE: /utils.js ===",
      "  export function fmt() { return 'x'; }  ",
    ].join("\n");
    const result = extractMultiFileCode(raw, ["/App.js", "/utils.js"]);
    expect(result).not.toBeNull();
    expect(result!["/App.js"]).toBe("export default function App() {}");
    expect(result!["/utils.js"]).toBe("export function fmt() { return 'x'; }");
  });

  it("handles LLM preamble text before first FILE marker", () => {
    const raw = [
      "Here are the files:",
      "// === FILE: /App.js ===",
      "export default function App() {}",
    ].join("\n");
    const result = extractMultiFileCode(raw, ["/App.js"]);
    expect(result).not.toBeNull();
    expect(result!["/App.js"]).toBe("export default function App() {}");
  });

  it("returns empty object for empty expectedFiles", () => {
    const result = extractMultiFileCode("anything", []);
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-code" --testNamePattern="extractMultiFileCode" 2>&1 | tail -5`
Expected: FAIL — `extractMultiFileCode` is not exported

- [ ] **Step 3: Implement extractMultiFileCode**

Add to the end of `lib/extract-code.ts` (after the existing `extractReactCode` function):

```typescript
/**
 * Extract multiple files from LLM output using FILE separator markers.
 *
 * Expected format:
 *   // === FILE: /path/to/file.js ===
 *   (code for file)
 *   // === FILE: /another/file.js ===
 *   (code for file)
 *
 * @param raw - Raw LLM output text
 * @param expectedFiles - List of file paths that must be present
 * @returns Record mapping path → code, or null if any file is missing or incomplete
 */
export function extractMultiFileCode(
  raw: string,
  expectedFiles: readonly string[]
): Record<string, string> | null {
  if (expectedFiles.length === 0) return {};

  const marker = /^\/\/ === FILE: (.+?) ===/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1];
      fileMap[currentPath] = [];
    } else if (currentPath !== null) {
      fileMap[currentPath].push(line);
    }
  }

  const result: Record<string, string> = {};

  for (const path of expectedFiles) {
    const codeLines = fileMap[path];
    if (!codeLines) return null; // missing file

    const code = codeLines.join("\n").trim();
    if (!isCodeComplete(code)) return null; // truncated

    result[path] = code;
  }

  return result;
}
```

Note: `isCodeComplete` is already defined in `extract-code.ts` (line 55). It is a module-private function, so `extractMultiFileCode` can call it directly since they are in the same file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-code" 2>&1 | tail -10`
Expected: All tests PASS (both old `extractReactCode` and new `extractMultiFileCode`)

- [ ] **Step 5: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat: add extractMultiFileCode for parsing multi-file LLM output"
```

---

## Task 5: Scaffold JSON parser — `extractScaffold`

**Files:**
- Modify: `lib/extract-json.ts`
- Modify: `__tests__/extract-json.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/extract-json.test.ts`:

```typescript
import { extractScaffold } from "@/lib/extract-json";
import type { ScaffoldData } from "@/lib/types";

const VALID_SCAFFOLD: ScaffoldData = {
  files: [
    {
      path: "/App.js",
      description: "Root component",
      exports: ["App"],
      deps: ["/components/Header.js"],
      hints: "Use useState for routing",
    },
    {
      path: "/components/Header.js",
      description: "Top navigation",
      exports: ["Header"],
      deps: [],
      hints: "lucide-react icons",
    },
  ],
  sharedTypes: "type User = { id: string; name: string }",
  designNotes: "Minimalist, slate palette",
};

describe("extractScaffold", () => {
  it("parses valid scaffold JSON", () => {
    const result = extractScaffold(JSON.stringify(VALID_SCAFFOLD));
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.files[0].path).toBe("/App.js");
    expect(result!.sharedTypes).toContain("User");
  });

  it("parses scaffold wrapped in ```json fence", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_SCAFFOLD) + "\n```";
    const result = extractScaffold(fenced);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
  });

  it("returns null when files array is empty", () => {
    const empty = { ...VALID_SCAFFOLD, files: [] };
    expect(extractScaffold(JSON.stringify(empty))).toBeNull();
  });

  it("returns null when file entry is missing path", () => {
    const bad = {
      files: [{ description: "no path", exports: [], deps: [], hints: "" }],
      sharedTypes: "",
      designNotes: "",
    };
    expect(extractScaffold(JSON.stringify(bad))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(extractScaffold("not json at all")).toBeNull();
  });

  it("returns null when files is not an array", () => {
    const bad = { files: "not array", sharedTypes: "", designNotes: "" };
    expect(extractScaffold(JSON.stringify(bad))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-json" --testNamePattern="extractScaffold" 2>&1 | tail -5`
Expected: FAIL — `extractScaffold` is not exported

- [ ] **Step 3: Implement extractScaffold**

Add to `lib/extract-json.ts`, after the existing `extractArchOutput` function. Import the new type at the top:

Add `ScaffoldData` to the existing import on line 1:

```typescript
import type { PmOutput, ArchOutput, ScaffoldData, ScaffoldFile } from "@/lib/types";
```

Then append after `extractArchOutput`:

```typescript
function isScaffoldFile(val: unknown): val is ScaffoldFile {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.path !== "string" || obj.path.trim() === "") return false;
  if (typeof obj.description !== "string") return false;
  if (!Array.isArray(obj.exports)) return false;
  if (!Array.isArray(obj.deps)) return false;
  if (typeof obj.hints !== "string") return false;
  return true;
}

function isScaffoldData(val: unknown): val is ScaffoldData {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (!Array.isArray(obj.files) || obj.files.length === 0) return false;
  if (!obj.files.every(isScaffoldFile)) return false;
  if (typeof obj.sharedTypes !== "string") return false;
  if (typeof obj.designNotes !== "string") return false;
  return true;
}

export function extractScaffold(raw: string): ScaffoldData | null {
  try {
    const parsed = parseJson(raw);
    if (!isScaffoldData(parsed)) return null;
    return parsed as ScaffoldData;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-json" 2>&1 | tail -10`
Expected: All tests PASS (both old extractPmOutput/extractArchOutput and new extractScaffold)

- [ ] **Step 5: Commit**

```bash
git add lib/extract-json.ts __tests__/extract-json.test.ts
git commit -m "feat: add extractScaffold parser for architect JSON output"
```

---

## Task 6: Prompts — Architect JSON + multi-file Engineer

**Files:**
- Modify: `lib/generate-prompts.ts`
- Modify: `__tests__/generate-prompts.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/generate-prompts.test.ts`:

```typescript
import { getSystemPrompt, getMultiFileEngineerPrompt } from "@/lib/generate-prompts";

describe("architect prompt — JSON scaffold mode", () => {
  const prompt = getSystemPrompt("architect", "proj-123");

  it("instructs JSON output format", () => {
    expect(prompt).toContain("JSON");
    expect(prompt).toContain('"files"');
    expect(prompt).toContain('"path"');
    expect(prompt).toContain('"deps"');
  });

  it("includes file count constraint", () => {
    expect(prompt).toMatch(/8.*20/);
  });

  it("includes the allowed-packages constraint", () => {
    expect(prompt).toContain("lucide-react");
    expect(prompt).toContain("supabaseClient.js");
  });
});

describe("getMultiFileEngineerPrompt", () => {
  const files = [
    { path: "/components/Header.js", description: "Top nav", exports: ["Header"], deps: [], hints: "Use lucide icons" },
    { path: "/hooks/useAuth.js", description: "Auth hook", exports: ["useAuth"], deps: ["/supabaseClient.js"], hints: "Return { user, login, logout }" },
  ];

  const prompt = getMultiFileEngineerPrompt({
    projectId: "proj-123",
    targetFiles: files,
    sharedTypes: "type User = { id: string }",
    completedFiles: { "/utils/api.js": "export function fetchData() { return fetch('/api'); }" },
    designNotes: "Minimalist slate design",
  });

  it("lists target files with paths and descriptions", () => {
    expect(prompt).toContain("/components/Header.js");
    expect(prompt).toContain("Top nav");
    expect(prompt).toContain("/hooks/useAuth.js");
  });

  it("includes shared types", () => {
    expect(prompt).toContain("type User = { id: string }");
  });

  it("includes completed dependency code", () => {
    expect(prompt).toContain("fetchData");
    expect(prompt).toContain("/utils/api.js");
  });

  it("specifies FILE separator format", () => {
    expect(prompt).toContain("// === FILE:");
  });

  it("includes package constraints", () => {
    expect(prompt).toContain("lucide-react");
  });

  it("includes projectId for supabase appId", () => {
    expect(prompt).toContain("proj-123");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="generate-prompts" --testNamePattern="scaffold|getMultiFileEngineerPrompt" 2>&1 | tail -5`
Expected: FAIL — `getMultiFileEngineerPrompt` not exported, architect prompt doesn't contain "JSON" yet

- [ ] **Step 3: Update architect prompt and add getMultiFileEngineerPrompt**

Replace the entire content of `lib/generate-prompts.ts` with:

```typescript
import type { AgentRole, ScaffoldFile } from "@/lib/types";

export function getSystemPrompt(agent: AgentRole, projectId: string): string {
  const prompts: Record<AgentRole, string> = {
    pm: `你是一位专业的产品经理（PM）。用户会描述他们想要的应用，你需要分析需求并输出结构化产品需求文档（PRD）。

输出格式：严格输出单个 JSON 对象，不得包含任何 Markdown 代码围栏、解释性文字或其他内容。

JSON schema（intent/features/persistence/modules 为必填，dataModel 可选）：
{"intent":"string","features":["string"],"persistence":"none|localStorage|supabase","modules":["string"],"dataModel":["string"]}

字段说明：
- intent：一句话描述核心目标，不超过 30 字
- features：核心功能列表，最多 8 条，每条不超过 20 字
- persistence：数据持久化方式，无需持久化填 "none"，本地存储填 "localStorage"，云端数据库填 "supabase"
- modules：页面/功能模块名称列表，最多 6 个
- dataModel：主要数据字段列表（可选，仅需持久化时填写）

不输出代码，不输出 JSON 以外的任何内容。`,

    architect: `你是一位资深系统架构师。你会收到 PM 的产品需求文档，需要设计多文件 React 项目的文件结构和技术方案。

输出格式：严格输出单个 JSON 对象，不得包含任何 Markdown 代码围栏、解释性文字或其他内容。

JSON schema：
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string"}],"sharedTypes":"string","designNotes":"string"}

字段说明：
- files[].path：Sandpack 文件路径，以 / 开头，如 /App.js、/components/Header.js、/hooks/useTodos.js
- files[].description：一句话描述该文件职责
- files[].exports：该文件导出的函数/组件名列表
- files[].deps：该文件依赖的其他项目文件路径列表（不含 react、lucide-react 等外部包）
- files[].hints：给工程师的实现要点提示
- sharedTypes：多文件共享的类型定义代码（如 type Todo = { id: string; title: string; done: boolean }）
- designNotes：整体设计风格说明

技术约束（必须遵守）：
- 使用 React 函数组件 + Hooks
- 样式使用 Tailwind CSS（已在 Sandpack 环境预配置）
- 如需数据持久化，使用 Supabase JS SDK（@supabase/supabase-js 已预装），通过 /supabaseClient.js 导入
- 允许使用 lucide-react 图标库；绝对禁止使用 recharts、framer-motion 等其他外部库
- 文件数量控制在 8-20 个，每个文件职责单一，不超过 150 行
- /App.js 为入口文件，必须包含

不输出 JSON 以外的任何内容。`,

    engineer: `你是一位全栈工程师。你会收到用户需求、PM 的 PRD 和架构师的技术方案，需要生成完整可运行的 React 应用代码。

【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）

绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

技术约束（严格遵守）：
- 输出单个 React 函数组件，导出为默认导出：export default function App() {}
- 样式必须使用 Tailwind CSS 类名（已预配置）
- 可以使用 React hooks：useState、useEffect、useCallback、useRef
- 如需数据持久化，使用沙箱预置的 Supabase 客户端（已预装）：
  import { supabase } from '/supabaseClient.js'
  // 使用 dynamic_app_data 表，appId 固定为 '${projectId}'
  // 表结构: { id, appId, key, data (JSONB), createdAt, updatedAt }
  // 读取: await supabase.from('dynamic_app_data').select('*').eq('appId', '${projectId}')
  // 写入: await supabase.from('dynamic_app_data').upsert({ appId: '${projectId}', key: 'todos', data: { items: [...] } })
- 如数据量小或无需云端持久化，使用 localStorage 代替
- 允许使用 lucide-react 图标库；绝对禁止使用 recharts、framer-motion 等其他外部库；本地文件只允许 import { supabase } from '/supabaseClient.js'

输出要求（严格遵守）：
- 只输出代码本身，不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容
- 代码必须完整可运行，UI 要美观现代
- 代码行数控制在 320 行以内，不写注释，使用紧凑写法`,
  };

  return prompts[agent];
}

interface MultiFileEngineerPromptInput {
  readonly projectId: string;
  readonly targetFiles: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly completedFiles: Record<string, string>;
  readonly designNotes: string;
}

export function getMultiFileEngineerPrompt(input: MultiFileEngineerPromptInput): string {
  const { projectId, targetFiles, sharedTypes, completedFiles, designNotes } = input;

  const fileList = targetFiles
    .map((f) => `- ${f.path}: ${f.description} (导出: ${f.exports.join(", ")})`)
    .join("\n");

  const hints = targetFiles
    .map((f) => `${f.path}: ${f.hints}`)
    .join("\n");

  const completedEntries = Object.entries(completedFiles);
  const completedSection = completedEntries.length > 0
    ? completedEntries.map(([path, code]) => `// === FILE: ${path} ===\n${code}`).join("\n\n")
    : "（无已完成文件）";

  const separatorExample = targetFiles
    .map((f) => `// === FILE: ${f.path} ===\n（${f.path} 的完整代码）`)
    .join("\n");

  return `你是一位全栈工程师。请根据以下信息生成指定文件的完整代码。

设计风格：${designNotes}

要生成的文件：
${fileList}

共享类型定义：
${sharedTypes}

实现指引：
${hints}

已完成的依赖文件（可直接 import 使用）：
${completedSection}

【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）
- 上方已完成的项目文件

绝对禁止引入任何其他 npm 包。
UI 样式只使用 Tailwind CSS class。图标只使用 lucide-react。

如需数据持久化：
  import { supabase } from '/supabaseClient.js'
  // 使用 dynamic_app_data 表，appId 固定为 '${projectId}'

输出要求（严格遵守）：
- 按以下分隔符格式输出每个文件，不输出其他内容
- 每个文件代码必须完整可运行，不超过 150 行
- 不写注释，使用紧凑写法

${separatorExample}`;
}
```

- [ ] **Step 4: Run all generate-prompts tests**

Run: `npm test -- --testPathPatterns="generate-prompts" 2>&1 | tail -15`
Expected: All tests PASS

Also run the supabase injection tests to make sure old engineer prompt still works:

Run: `npm test -- --testPathPatterns="supabase-injection" 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
git commit -m "feat: rewrite architect prompt for JSON scaffold, add multi-file engineer prompt"
```

---

## Task 7: Schema migration — add `files` field to Version

**Files:**
- Modify: `prisma/schema.prisma:73-84`

- [ ] **Step 1: Add files field to Version model**

In `prisma/schema.prisma`, add `files Json?` after the `code` field on line 78:

```prisma
model Version {
  id            String   @id @default(cuid())
  projectId     String
  versionNumber Int
  code          String
  files         Json?
  description   String?
  agentMessages Json?
  createdAt     DateTime @default(now())
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, versionNumber])
}
```

- [ ] **Step 2: Push schema to database**

Run: `npx prisma db push 2>&1 | tail -5`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Verify Prisma client is regenerated**

Run: `npx prisma generate 2>&1 | tail -3`
Expected: "Generated Prisma Client"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add files Json field to Version model for multi-file storage"
```

---

## Task 8: Versions API — accept and write `files` field

**Files:**
- Modify: `app/api/versions/route.ts:25-60`
- Modify: `__tests__/versions-api.test.ts`

- [ ] **Step 1: Write failing test**

Add to `__tests__/versions-api.test.ts` (find the existing test file and append within the `POST` describe block):

```typescript
it("accepts files field and writes both code and files", async () => {
  const files = { "/App.js": "app code", "/components/Header.js": "header code" };
  const body = { projectId: "proj-1", files, description: "multi-file" };
  // Simulate POST with files instead of code
  const req = new Request("http://localhost/api/versions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const res = await POST(req);
  const data = await res.json();
  expect(res.status).toBe(201);
  // Should have written both code (from /App.js) and files
  expect(mockPrisma.version.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        code: "app code",
        files: { "/App.js": "app code", "/components/Header.js": "header code" },
      }),
    })
  );
});
```

Note: Adapt this test to match the existing mock patterns in `__tests__/versions-api.test.ts`. Read that file first to understand the mock setup before writing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="versions-api" --testNamePattern="files field" 2>&1 | tail -10`
Expected: FAIL

- [ ] **Step 3: Update POST handler**

Modify the POST handler in `app/api/versions/route.ts` to accept `files`:

```typescript
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { projectId, code, files, description } = body as {
    projectId?: string;
    code?: string;
    files?: Record<string, string>;
    description?: string;
  };

  // Determine the effective code: from files["/App.js"] or direct code param
  const effectiveCode = files?.["/App.js"] ?? code;

  if (!projectId || !effectiveCode) {
    return NextResponse.json(
      { error: "projectId and (code or files with /App.js) are required" },
      { status: 400 }
    );
  }

  // Verify project belongs to user
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Get next version number
  const lastVersion = await prisma.version.findFirst({
    where: { projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const version = await prisma.version.create({
    data: {
      projectId,
      code: effectiveCode,
      ...(files ? { files } : {}),
      description,
      versionNumber,
    },
  });

  // Update project updatedAt
  await prisma.project.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(version, { status: 201 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="versions-api" 2>&1 | tail -10`
Expected: All tests PASS (both old and new)

- [ ] **Step 5: Commit**

```bash
git add app/api/versions/route.ts __tests__/versions-api.test.ts
git commit -m "feat: versions API accepts files field, writes both code and files"
```

---

## Task 9: Generate route — architect jsonMode + multi-file engineer support

**Files:**
- Modify: `app/api/generate/route.ts`

- [ ] **Step 1: Update route to support multi-file params and architect jsonMode**

Modify `app/api/generate/route.ts`:

1. Update the body destructuring (around line 25) to include new fields:

```typescript
const { agent, prompt, context, projectId, modelId, targetFiles, completedFiles, scaffold } = body as {
  projectId: string;
  prompt: string;
  agent: AgentRole;
  context?: string;
  modelId?: string;
  targetFiles?: Array<{ path: string; description: string; exports: string[]; deps: string[]; hints: string }>;
  completedFiles?: Record<string, string>;
  scaffold?: { sharedTypes: string; designNotes: string };
};
```

2. Update the `userContent` construction to handle multi-file engineer mode:

```typescript
const userContent =
  agent === "pm"
    ? `用户需求：${prompt}`
    : agent === "architect"
      ? `PM 的产品需求文档：\n\n${context}\n\n请基于以上 PRD 设计多文件 React 项目的文件结构和技术方案。`
      : targetFiles && scaffold
        ? context ?? ""  // multi-file mode: context is built by client via getMultiFileEngineerPrompt
        : `请根据以下完整背景信息，生成完整可运行的 React 组件代码：\n\n${context}`;
```

3. Update the `completionOptions` to enable jsonMode for architect too:

```typescript
const completionOptions: CompletionOptions =
  (agent === "pm" || agent === "architect") ? { jsonMode: true } : {};
```

4. Update the engineer code extraction block (around line 101) to handle multi-file:

```typescript
if (agent === "engineer") {
  if (targetFiles && targetFiles.length > 0) {
    const { extractMultiFileCode } = await import("@/lib/extract-code");
    const expectedPaths = targetFiles.map((f) => f.path);
    const filesResult = extractMultiFileCode(fullContent, expectedPaths);
    if (filesResult === null) {
      send(controller, { type: "error", error: "生成的代码不完整，请重试" });
    } else {
      send(controller, { type: "files_complete", files: filesResult });
    }
  } else {
    const finalCode = extractReactCode(fullContent);
    if (finalCode === null) {
      send(controller, { type: "error", error: "生成的代码不完整，请重试" });
    } else {
      send(controller, { type: "code_complete", code: finalCode });
    }
  }
}
```

- [ ] **Step 2: Add `files_complete` to SSE event types in `lib/types.ts`**

Update the `SSEEventType` union in `lib/types.ts` (line 90):

```typescript
export type SSEEventType =
  | "thinking"
  | "chunk"
  | "code_chunk"
  | "code_complete"
  | "files_complete"
  | "reset"
  | "done"
  | "error";
```

And add `files` to `SSEEvent` (line 99):

```typescript
export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  messageId?: string;
  error?: string;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/route.ts lib/types.ts
git commit -m "feat: generate route supports architect jsonMode and multi-file engineer output"
```

---

## Task 10: Sandpack config — accept multi-file input

**Files:**
- Modify: `lib/sandpack-config.ts`
- Modify: `__tests__/supabase-injection.test.ts`

- [ ] **Step 1: Write failing test**

Add a new describe block to `__tests__/supabase-injection.test.ts`:

```typescript
describe("buildSandpackConfig — multi-file input", () => {
  const files = {
    "/App.js": "export default function App() { return <div/>; }",
    "/components/Header.js": "export function Header() { return <h1/>; }",
  };
  const config = buildSandpackConfig(files, "proj-multi");

  it("includes all user files in config", () => {
    expect(config.files["/App.js"].code).toContain("App");
    expect(config.files["/components/Header.js"].code).toContain("Header");
  });

  it("still includes hidden supabaseClient.js", () => {
    expect(config.files["/supabaseClient.js"]).toBeDefined();
    expect(config.files["/supabaseClient.js"].hidden).toBe(true);
  });

  it("user files are not hidden", () => {
    expect(config.files["/App.js"].hidden).toBeUndefined();
    expect(config.files["/components/Header.js"].hidden).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="supabase-injection" --testNamePattern="multi-file" 2>&1 | tail -5`
Expected: FAIL — `buildSandpackConfig` doesn't accept `Record<string, string>` yet

- [ ] **Step 3: Update buildSandpackConfig**

Change the `buildSandpackConfig` signature and implementation in `lib/sandpack-config.ts`:

```typescript
export function buildSandpackConfig(
  input: string | Record<string, string>,
  projectId: string
): SandpackConfig {
  void projectId; // projectId reserved for future per-project isolation

  // Normalize: string input becomes single-file { "/App.js": code }
  const userFiles: Record<string, string> =
    typeof input === "string" ? { "/App.js": input || PLACEHOLDER_APP } : input;

  // Ensure /App.js has a value (Sandpack entry point)
  if (!userFiles["/App.js"]) {
    userFiles["/App.js"] = PLACEHOLDER_APP;
  }

  // Convert to Sandpack file entries
  const sandpackFiles: Record<string, SandpackFileEntry> = {};
  for (const [path, code] of Object.entries(userFiles)) {
    sandpackFiles[path] = { code };
  }

  // Inject hidden supabase client
  sandpackFiles["/supabaseClient.js"] = {
    code: buildSupabaseClientCode(),
    hidden: true,
  };

  return {
    template: "react",
    theme: "auto",
    files: sandpackFiles,
    customSetup: {
      dependencies: {
        "@supabase/supabase-js": "^2.39.0",
        "lucide-react": "^0.300.0",
      },
    },
    options: {
      recompileMode: "delayed",
      recompileDelay: 500,
      externalResources: ["https://cdn.tailwindcss.com"],
    },
  };
}
```

- [ ] **Step 4: Run all supabase-injection tests**

Run: `npm test -- --testPathPatterns="supabase-injection" 2>&1 | tail -15`
Expected: All tests PASS (old single-file and new multi-file)

- [ ] **Step 5: Commit**

```bash
git add lib/sandpack-config.ts __tests__/supabase-injection.test.ts
git commit -m "feat: buildSandpackConfig accepts Record<string,string> for multi-file"
```

---

## Task 11: MultiFileEditor component

**Files:**
- Create: `components/preview/multi-file-editor.tsx`

- [ ] **Step 1: Create the MultiFileEditor component**

Create `components/preview/multi-file-editor.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import { CodeEditor } from "@/components/preview/code-editor";

interface MultiFileEditorProps {
  files: Record<string, string>;
  onFilesChange: (files: Record<string, string>) => void;
}

function sortFilePaths(paths: string[]): string[] {
  return paths.sort((a, b) => {
    // /App.js always first
    if (a === "/App.js") return -1;
    if (b === "/App.js") return 1;
    return a.localeCompare(b);
  });
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function MultiFileEditor({ files, onFilesChange }: MultiFileEditorProps) {
  const paths = sortFilePaths(Object.keys(files));
  const [activePath, setActivePath] = useState(paths[0] ?? "/App.js");

  // If the active file was removed (e.g. new generation), reset to first
  const effectivePath = paths.includes(activePath) ? activePath : paths[0] ?? "/App.js";

  const handleCodeChange = useCallback(
    (newCode: string) => {
      onFilesChange({ ...files, [effectivePath]: newCode });
    },
    [files, effectivePath, onFilesChange]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* File tab bar */}
      <div className="flex border-b bg-[#252526] overflow-x-auto shrink-0">
        {paths.map((path) => (
          <button
            key={path}
            data-testid={`file-tab-${path}`}
            onClick={() => setActivePath(path)}
            className={`px-3 py-1.5 text-xs font-mono whitespace-nowrap border-r border-[#1e1e1e] transition-colors ${
              path === effectivePath
                ? "bg-[#1e1e1e] text-white"
                : "bg-[#2d2d2d] text-gray-400 hover:text-gray-200"
            }`}
          >
            {getFileName(path)}
          </button>
        ))}
      </div>

      {/* Monaco editor for active file */}
      <CodeEditor
        code={files[effectivePath] ?? ""}
        onChange={handleCodeChange}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/preview/multi-file-editor.tsx
git commit -m "feat: add MultiFileEditor component with file tab bar"
```

---

## Task 12: PreviewPanel + PreviewFrame — accept files prop

**Files:**
- Modify: `components/preview/preview-panel.tsx`
- Modify: `components/preview/preview-frame.tsx`

- [ ] **Step 1: Update PreviewFrame to accept files**

Replace the `PreviewFrame` component in `components/preview/preview-frame.tsx`:

```typescript
"use client";

import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { SandpackErrorBoundary } from "@/components/preview/error-boundary";
import { buildSandpackConfig } from "@/lib/sandpack-config";

interface PreviewFrameProps {
  files: Record<string, string>;
  projectId: string;
}

export function PreviewFrame({ files, projectId }: PreviewFrameProps) {
  const config = buildSandpackConfig(files, projectId);
  const appCode = files["/App.js"] ?? "";
  const sandpackKey = `${Object.keys(files).length}-${appCode.length}-${appCode.slice(0, 40)}`;

  return (
    <SandpackErrorBoundary>
      <SandpackProvider
        key={sandpackKey}
        template={config.template as "react"}
        files={config.files}
        options={config.options}
        customSetup={config.customSetup}
        theme={config.theme as "auto"}
      >
        <SandpackLayout style={{ height: "100%", border: "none" }}>
          <SandpackPreview
            style={{ height: "100%" }}
            showNavigator={false}
            showOpenInCodeSandbox={false}
            showRefreshButton
          />
        </SandpackLayout>
      </SandpackProvider>
    </SandpackErrorBoundary>
  );
}
```

- [ ] **Step 2: Update PreviewPanel to use files instead of code**

Replace the `PreviewPanel` component in `components/preview/preview-panel.tsx`:

```typescript
"use client";

import { useState } from "react";
import { PreviewFrame } from "@/components/preview/preview-frame";
import { MultiFileEditor } from "@/components/preview/multi-file-editor";
import { VersionTimeline } from "@/components/timeline/version-timeline";
import type { ProjectVersion } from "@/lib/types";

type Tab = "preview" | "code";

interface PreviewPanelProps {
  files: Record<string, string>;
  projectId: string;
  isGenerating: boolean;
  onFilesChange: (files: Record<string, string>) => void;
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onVersionRestore: (newVersion: ProjectVersion) => void;
}

export function PreviewPanel({
  files,
  projectId,
  isGenerating,
  onFilesChange,
  versions,
  previewingVersion,
  onPreviewVersion,
  onVersionRestore,
}: PreviewPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const hasCode = Object.values(files).some((code) => code.length > 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 min-w-0">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex gap-1">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={`tab-${t}`}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {t === "preview" ? "预览" : "代码"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span>⚡ Sandpack</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "preview" ? (
          <div className="flex-1 overflow-hidden relative">
            {hasCode ? (
              <PreviewFrame files={files} projectId={projectId} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 bg-gray-50 text-center px-8">
                <div className="text-5xl">🏗️</div>
                <p className="font-semibold text-gray-700">BuilderAI</p>
                <p className="text-sm text-gray-400">等待生成 — 在左侧输入需求，AI 将为你生成应用</p>
              </div>
            )}
            {isGenerating && (
              <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-48 h-4 bg-gray-200 rounded animate-pulse" />
                  <div className="w-32 h-4 bg-gray-200 rounded animate-pulse" />
                  <p className="text-sm text-muted-foreground">正在生成中...</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <MultiFileEditor files={files} onFilesChange={onFilesChange} />
        )}

        {/* Version timeline */}
        {versions.length > 0 && (
          <VersionTimeline
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={onPreviewVersion}
            onRestoreVersion={onVersionRestore}
            isGenerating={isGenerating}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: Errors in `workspace.tsx` (still passes `code` prop) — this is expected and will be fixed in Task 13.

- [ ] **Step 4: Commit**

```bash
git add components/preview/preview-frame.tsx components/preview/preview-panel.tsx
git commit -m "feat: PreviewPanel and PreviewFrame accept multi-file Record<string,string>"
```

---

## Task 13: Workspace — `currentCode` to `currentFiles` migration

**Files:**
- Modify: `components/workspace/workspace.tsx`

- [ ] **Step 1: Update workspace state from string to Record**

Replace the content of `components/workspace/workspace.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ConversationSidebar } from "@/components/sidebar/conversation-sidebar";
import { ChatArea } from "@/components/workspace/chat-area";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { getVersionFiles } from "@/lib/version-files";
import type { Project, ProjectMessage, ProjectVersion } from "@/lib/types";

interface WorkspaceProps {
  project: Project & {
    messages: ProjectMessage[];
    versions: ProjectVersion[];
  };
  allProjects: { id: string; name: string; updatedAt: Date }[];
}

type MobileTab = "chat" | "preview";

export function Workspace({ project, allProjects }: WorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");

  useEffect(() => {
    function handleOffline() {
      toast.error("网络已断开，请检查你的网络连接");
    }
    function handleOnline() {
      toast.success("网络已恢复");
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const lastVersion = project.versions[project.versions.length - 1];
  const [currentFiles, setCurrentFiles] = useState<Record<string, string>>(
    lastVersion ? getVersionFiles(lastVersion as { code: string; files?: Record<string, string> | null }) : {}
  );
  const [versions, setVersions] = useState<ProjectVersion[]>(project.versions);
  const [messages, setMessages] = useState<ProjectMessage[]>(project.messages);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewingVersion, setPreviewingVersion] = useState<ProjectVersion | null>(null);

  const displayFiles = previewingVersion
    ? getVersionFiles(previewingVersion as { code: string; files?: Record<string, string> | null })
    : currentFiles;

  function handleRestoreVersion(newVersion: ProjectVersion) {
    setCurrentFiles(
      getVersionFiles(newVersion as { code: string; files?: Record<string, string> | null })
    );
    setVersions((prev) => [...prev, newVersion]);
    setPreviewingVersion(null);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mobile tab bar */}
      <div className="flex md:hidden border-b bg-white shrink-0">
        <button
          data-testid="mobile-tab-chat"
          data-active={mobileTab === "chat"}
          onClick={() => setMobileTab("chat")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mobileTab === "chat"
              ? "text-indigo-600 border-b-2 border-indigo-600"
              : "text-gray-500"
          }`}
        >
          对话
        </button>
        <button
          data-testid="mobile-tab-preview"
          data-active={mobileTab === "preview"}
          onClick={() => setMobileTab("preview")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mobileTab === "preview"
              ? "text-indigo-600 border-b-2 border-indigo-600"
              : "text-gray-500"
          }`}
        >
          预览
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="hidden md:flex shrink-0">
          <ConversationSidebar
            currentProjectId={project.id}
            projects={allProjects}
          />
        </div>

        <div
          className={`flex-1 flex flex-col overflow-hidden border-r md:flex ${
            mobileTab === "chat" ? "flex" : "hidden md:flex"
          }`}
        >
          <ChatArea
            initialModel={project.preferredModel ?? undefined}
            project={project}
            messages={messages}
            onMessagesChange={setMessages}
            onGeneratingChange={setIsGenerating}
            isPreviewingHistory={previewingVersion !== null}
            onFilesGenerated={(files, version) => {
              setCurrentFiles(files);
              setVersions((prev) => [...prev, version]);
              setPreviewingVersion(null);
            }}
          />
        </div>

        <div
          className={`relative flex-1 flex flex-col overflow-hidden ${
            mobileTab === "preview" ? "flex" : "hidden md:flex"
          }`}
        >
          <PreviewPanel
            files={displayFiles}
            projectId={project.id}
            isGenerating={isGenerating}
            onFilesChange={setCurrentFiles}
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={setPreviewingVersion}
            onVersionRestore={handleRestoreVersion}
          />
        </div>
      </div>
    </div>
  );
}
```

Note: This changes `onCodeGenerated` to `onFilesGenerated` — ChatArea must also be updated (Task 14) for this to compile.

- [ ] **Step 2: Verify the file compiles (will have errors until Task 14)**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "workspace.tsx" | head -5`
Expected: Errors about `onFilesGenerated` not existing on ChatArea — this is expected.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/workspace.tsx
git commit -m "feat: workspace uses currentFiles Record<string,string> instead of currentCode string"
```

---

## Task 14: ChatArea — multi-layer parallel Engineer orchestration

This is the largest and most complex task. It changes `chat-area.tsx` to:
1. Parse architect output as scaffold JSON
2. Run topological sort to get execution layers
3. Dispatch parallel Engineer requests per layer
4. Collect file results and emit `onFilesGenerated`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

- [ ] **Step 1: Update ChatArea props**

Change the `ChatAreaProps` interface:

Replace:
```typescript
onCodeGenerated: (code: string, version: ProjectVersion) => void;
```
With:
```typescript
onFilesGenerated: (files: Record<string, string>, version: ProjectVersion) => void;
```

- [ ] **Step 2: Add imports for new dependencies**

Add to the import section at the top of `chat-area.tsx`:

```typescript
import { topologicalSort } from "@/lib/topo-sort";
import { extractScaffold } from "@/lib/extract-json";
import { getMultiFileEngineerPrompt } from "@/lib/generate-prompts";
import type { EngineerProgress, ScaffoldData, ScaffoldFile } from "@/lib/types";
```

- [ ] **Step 3: Add engineerProgress state**

After the existing `agentStates` useState (around line 63), add:

```typescript
const [engineerProgress, setEngineerProgress] = useState<EngineerProgress | null>(null);
```

- [ ] **Step 4: Rewrite the Engineer generation section in handleSubmit**

The key change is inside the `for (const agentRole of AGENT_ORDER)` loop. After the architect agent completes, we parse the scaffold and run multi-layer parallel generation instead of a single engineer call.

Replace the engineer portion of the loop. The simplest approach: when `agentRole === "engineer"`, break out of the normal loop and run the multi-file flow instead.

After the line `if (agentRole === "pm") parsedPm = extractPmOutput(agentOutput);` and the corresponding persist/handoff logic, add a branch for engineer that replaces the normal SSE flow:

```typescript
// Inside the for-of loop, after architect completes and before engineer would run:
if (agentRole === "engineer") {
  // Try to parse architect output as scaffold
  const scaffold = extractScaffold(outputs.architect);

  if (scaffold && scaffold.files.length > 1) {
    // === MULTI-FILE PATH ===
    updateAgentState("engineer", { status: "thinking", output: "" });

    const layers = topologicalSort(scaffold.files);
    const totalFiles = scaffold.files.length;
    const allCompletedFiles: Record<string, string> = {};
    const allFailedFiles: string[] = [];

    setEngineerProgress({
      totalLayers: layers.length,
      currentLayer: 0,
      totalFiles,
      currentFiles: [],
      completedFiles: [],
      failedFiles: [],
    });

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const layerPaths = layers[layerIdx];
      const layerFiles = layerPaths
        .map((p) => scaffold.files.find((f) => f.path === p))
        .filter((f): f is ScaffoldFile => f !== undefined);

      setEngineerProgress((prev) => prev ? {
        ...prev,
        currentLayer: layerIdx + 1,
        currentFiles: layerPaths.map((p) => p.split("/").pop() ?? p),
      } : prev);

      updateAgentState("engineer", {
        status: "streaming",
        output: `正在生成第 ${layerIdx + 1}/${layers.length} 层: ${layerPaths.map((p) => p.split("/").pop()).join(", ")}`,
      });

      // Build prompt for this layer's files
      const engineerPrompt = getMultiFileEngineerPrompt({
        projectId: project.id,
        targetFiles: layerFiles,
        sharedTypes: scaffold.sharedTypes,
        completedFiles: allCompletedFiles,
        designNotes: scaffold.designNotes,
      });

      // Call generate API for this batch
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          prompt,
          agent: "engineer",
          context: engineerPrompt,
          modelId: selectedModel,
          targetFiles: layerFiles,
          completedFiles: allCompletedFiles,
          scaffold: { sharedTypes: scaffold.sharedTypes, designNotes: scaffold.designNotes },
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }
      if (!response.body) throw new Error("No response body");

      setTransitionText(null);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let layerOutput = "";
      let sseBuffer = "";
      let layerFiles_result: Record<string, string> | null = null;

      const processSSELines = (lines: string[]) => {
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as {
              type: string;
              content?: string;
              code?: string;
              files?: Record<string, string>;
              error?: string;
            };
            if (event.type === "chunk") {
              layerOutput += event.content ?? "";
            } else if (event.type === "files_complete") {
              if (event.files) layerFiles_result = event.files;
            } else if (event.type === "code_complete") {
              // Legacy single-file fallback
              if (event.code) layerFiles_result = { "/App.js": event.code };
            } else if (event.type === "reset") {
              layerOutput = "";
            } else if (event.type === "error") {
              throw new Error(event.error ?? "Stream error");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        sseBuffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = done ? "" : (lines.pop() ?? "");
        processSSELines(lines);
        if (done) break;
      }
      if (sseBuffer.trim()) processSSELines([sseBuffer]);

      if (layerFiles_result) {
        Object.assign(allCompletedFiles, layerFiles_result);
        setEngineerProgress((prev) => prev ? {
          ...prev,
          completedFiles: Object.keys(allCompletedFiles),
        } : prev);
      } else {
        allFailedFiles.push(...layerPaths);
        setEngineerProgress((prev) => prev ? {
          ...prev,
          failedFiles: [...prev.failedFiles, ...layerPaths],
        } : prev);
      }
    }

    // Engineer done — build summary
    const completedList = Object.keys(allCompletedFiles).join(", ");
    const failedNote = allFailedFiles.length > 0
      ? `\n\n⚠️ 以下文件生成失败: ${allFailedFiles.join(", ")}`
      : "";
    const summaryOutput = `✅ 已生成 ${Object.keys(allCompletedFiles).length} 个文件:\n${completedList}${failedNote}`;

    outputs.engineer = summaryOutput;
    updateAgentState("engineer", { status: "done", output: summaryOutput });
    setEngineerProgress(null);

    const engineerMsg: ProjectMessage = {
      id: `temp-agent-engineer-${Date.now()}`,
      projectId: project.id,
      role: "engineer",
      content: summaryOutput,
      metadata: null,
      createdAt: new Date(),
    };
    currentMessages = [...currentMessages, engineerMsg];
    onMessagesChange(currentMessages);

    await persistMessage("engineer", summaryOutput, {
      agentName: AGENTS.engineer.name,
      agentColor: AGENTS.engineer.color,
    });

    // Save version with multi-file output
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

    // Skip the normal loop continuation for engineer
    continue;
  }
  // else: scaffold parse failed or single file → fall through to legacy single-file flow
}
```

- [ ] **Step 5: Update the legacy code_complete handler**

In the existing code after the for-of loop (the `if (lastCode)` block around line 274), change `onCodeGenerated` to `onFilesGenerated`:

```typescript
if (lastCode) {
  const res = await fetchAPI("/api/versions", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      code: lastCode,
      description: prompt.slice(0, 80),
    }),
  });
  const version = await res.json();
  onFilesGenerated({ "/App.js": lastCode }, version);
}
```

- [ ] **Step 6: Pass engineerProgress to AgentStatusBar**

Update the JSX to pass the new prop:

```typescript
<AgentStatusBar
  agentStates={agentStates}
  isGenerating={isGenerating}
  engineerProgress={engineerProgress}
/>
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: May have errors about AgentStatusBar not accepting `engineerProgress` yet — this is fixed in Task 15.

- [ ] **Step 8: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: ChatArea orchestrates multi-layer parallel Engineer generation"
```

---

## Task 15: AgentStatusBar — engineer sub-progress display

**Files:**
- Modify: `components/agent/agent-status-bar.tsx`

- [ ] **Step 1: Update AgentStatusBar to display EngineerProgress**

Replace the content of `components/agent/agent-status-bar.tsx`:

```typescript
"use client";

import { cn } from "@/lib/utils";
import { AGENTS, AGENT_ORDER } from "@/lib/types";
import type { AgentRole, AgentState, EngineerProgress } from "@/lib/types";
import { ThinkingIndicator } from "@/components/agent/thinking-indicator";

interface AgentStatusBarProps {
  agentStates: Record<AgentRole, AgentState>;
  isGenerating: boolean;
  engineerProgress?: EngineerProgress | null;
}

export function AgentStatusBar({
  agentStates,
  isGenerating,
  engineerProgress,
}: AgentStatusBarProps) {
  return (
    <div data-testid="agent-status-bar" className="border-b bg-white px-4 py-2 flex items-center gap-2">
      {AGENT_ORDER.map((role, index) => {
        const agent = AGENTS[role];
        const state = agentStates[role];
        const isDone = state.status === "done";
        const isActive =
          state.status === "thinking" || state.status === "streaming";
        const isIdle = state.status === "idle";

        return (
          <div key={role} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                isDone && "bg-emerald-50 border-emerald-200 text-emerald-700",
                isActive && "border-2 text-white",
                isIdle && !isGenerating && "bg-gray-50 border-gray-200 text-gray-400",
                isIdle && isGenerating && "bg-gray-50 border-gray-200 text-gray-300 opacity-50"
              )}
              style={
                isActive
                  ? { borderColor: agent.color, backgroundColor: agent.color }
                  : undefined
              }
            >
              <span>{agent.avatar}</span>
              <span>{agent.role}</span>
              {isDone && <span>✓</span>}
              {isActive && <ThinkingIndicator color="white" />}
            </div>

            {/* Engineer sub-progress */}
            {role === "engineer" && isActive && engineerProgress && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span>
                  第 {engineerProgress.currentLayer}/{engineerProgress.totalLayers} 层
                </span>
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{
                      width: `${(engineerProgress.completedFiles.length / engineerProgress.totalFiles) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-gray-400">
                  {engineerProgress.completedFiles.length}/{engineerProgress.totalFiles}
                </span>
              </div>
            )}

            {index < AGENT_ORDER.length - 1 && (
              <span className="text-gray-300 text-xs">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify full TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors — the full chain now compiles (types → topo-sort → extract → prompts → route → sandpack → components)

- [ ] **Step 3: Commit**

```bash
git add components/agent/agent-status-bar.tsx
git commit -m "feat: AgentStatusBar shows engineer multi-file progress bar"
```

---

## Task 16: Full integration verification

**Files:**
- No new files — verify everything works together

- [ ] **Step 1: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass. Note any failures and fix them.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit --pretty 2>&1`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npm run lint 2>&1 | tail -10`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 4: Run dev server and verify no runtime errors**

Run: `npm run dev` and open http://localhost:3000
Expected: App loads without console errors. Existing single-file projects still display correctly.

- [ ] **Step 5: Commit any fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: resolve integration issues from multi-file generation"
```

- [ ] **Step 6: Final commit — update CLAUDE.md architecture docs**

Update the "Request flow for AI generation" section in `CLAUDE.md` to document the new multi-file flow. Add a note about the `files_complete` SSE event and the scaffold JSON format.

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with multi-file generation architecture"
```
