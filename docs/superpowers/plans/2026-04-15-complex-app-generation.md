# Complex App Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relax seven generation constraints so BuilderAI can produce complex medium-sized applications (CRUD dashboards, data visualizations, multi-page apps, games including platformers) without regressing simple project quality.

**Architecture:** Extend `ScaffoldData` with per-file `maxLines` and project-level `dependencies`. Replace the package whitelist with a blacklist. Make the Engineer prompt read dynamic line limits from the scaffold. Raise the dependency compression threshold and make the post-processing patch limit proportional to project size.

**Tech Stack:** TypeScript, React, Sandpack, Jest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/types.ts` | Modify | Add `maxLines`, `complexity` to `ScaffoldFile`; add `dependencies` to `ScaffoldData` |
| `lib/extract-code.ts` | Modify | Replace `ALLOWED_EXTERNAL_PACKAGES` whitelist with `BLOCKED_PACKAGES` blacklist; reverse `checkDisallowedImports()` logic |
| `lib/validate-scaffold.ts` | Modify | Add rules 6-7: clamp `maxLines`, strip blacklisted `dependencies` |
| `lib/generate-prompts.ts` | Modify | Dynamic line limits, remove hardcoded package whitelist from all prompts, raise `COMPOSER_DEP_THRESHOLD` to 10 |
| `lib/sandpack-config.ts` | Modify | Accept optional `scaffoldDependencies` param; merge into `customSetup.dependencies` |
| `components/preview/preview-frame.tsx` | Modify | Accept optional `scaffoldDependencies` prop; pass through to `buildSandpackConfig` |
| `components/workspace/chat-area.tsx` | Modify | Compute dynamic `MAX_PATCH_FILES`; thread `scaffold.dependencies` through to `onFilesGenerated` and preview |
| `__tests__/extract-code.test.ts` | Modify | Add tests for blacklist-based `checkDisallowedImports` |
| `__tests__/validate-scaffold.test.ts` | Modify | Add tests for rules 6-7 |
| `__tests__/sandpack-config.test.ts` | Modify | Add tests for scaffold dependency injection |
| `__tests__/generate-prompts.test.ts` | Modify | Add/update tests for dynamic line limits and threshold change |

---

### Task 1: Extend ScaffoldFile and ScaffoldData types

**Files:**
- Modify: `lib/types.ts:231-244`

- [ ] **Step 1: Add `maxLines` and `complexity` to `ScaffoldFile`**

In `lib/types.ts`, find the `ScaffoldFile` interface (line 231) and add two optional fields:

```typescript
export interface ScaffoldFile {
  readonly path: string;
  readonly description: string;
  readonly exports: readonly string[];
  readonly deps: readonly string[];
  readonly hints: string;
  readonly maxLines?: number;
  readonly complexity?: "normal" | "high";
}
```

- [ ] **Step 2: Add `dependencies` to `ScaffoldData`**

In `lib/types.ts`, find the `ScaffoldData` interface (line 239) and add the optional `dependencies` field:

```typescript
export interface ScaffoldData {
  readonly files: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly designNotes: string;
  readonly removeFiles?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors (new fields are optional, backward compatible)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat: extend ScaffoldFile with maxLines/complexity, ScaffoldData with dependencies"
```

---

### Task 2: Replace package whitelist with blacklist in extract-code.ts

**Files:**
- Modify: `lib/extract-code.ts:616-648`
- Test: `__tests__/extract-code.test.ts`

- [ ] **Step 1: Write failing tests for blacklist-based checkDisallowedImports**

Append to `__tests__/extract-code.test.ts`:

```typescript
import { checkDisallowedImports } from "@/lib/extract-code";

describe("checkDisallowedImports — blacklist mode", () => {
  it("allows a non-blacklisted external package", () => {
    const files = {
      "/App.js": `import { LineChart } from 'recharts';\nexport default function App() { return null; }`,
    };
    expect(checkDisallowedImports(files)).toEqual([]);
  });

  it("blocks a blacklisted Node native module", () => {
    const files = {
      "/App.js": `import fs from 'fs';\nexport default function App() { return null; }`,
    };
    const violations = checkDisallowedImports(files);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ filePath: "/App.js", packageName: "fs" });
  });

  it("blocks a blacklisted server framework", () => {
    const files = {
      "/App.js": `import express from 'express';\nexport default function App() { return null; }`,
    };
    const violations = checkDisallowedImports(files);
    expect(violations).toHaveLength(1);
    expect(violations[0].packageName).toBe("express");
  });

  it("blocks a blacklisted oversized package", () => {
    const files = {
      "/App.js": `import * as THREE from 'three';\nexport default function App() { return null; }`,
    };
    const violations = checkDisallowedImports(files);
    expect(violations).toHaveLength(1);
    expect(violations[0].packageName).toBe("three");
  });

  it("allows react, react-dom, lucide-react as always", () => {
    const files = {
      "/App.js": `import React from 'react';\nimport { Search } from 'lucide-react';\nexport default function App() { return null; }`,
    };
    expect(checkDisallowedImports(files)).toEqual([]);
  });

  it("allows framer-motion (previously blocked by whitelist)", () => {
    const files = {
      "/App.js": `import { motion } from 'framer-motion';\nexport default function App() { return null; }`,
    };
    expect(checkDisallowedImports(files)).toEqual([]);
  });

  it("allows recharts (previously blocked by whitelist)", () => {
    const files = {
      "/Chart.js": `import { BarChart, Bar } from 'recharts';\nexport default function Chart() { return null; }`,
    };
    expect(checkDisallowedImports(files)).toEqual([]);
  });

  it("allows zustand (previously blocked by whitelist)", () => {
    const files = {
      "/store.js": `import { create } from 'zustand';\nexport const useStore = create(() => ({}));\nexport default useStore;`,
    };
    expect(checkDisallowedImports(files)).toEqual([]);
  });

  it("blocks scoped blacklisted package child_process", () => {
    const files = {
      "/App.js": `import { exec } from 'child_process';\nexport default function App() { return null; }`,
    };
    const violations = checkDisallowedImports(files);
    expect(violations).toHaveLength(1);
    expect(violations[0].packageName).toBe("child_process");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-code.test" --testNamePattern="blacklist mode"`
Expected: FAIL — current whitelist-based logic blocks recharts, framer-motion, zustand etc.

- [ ] **Step 3: Replace ALLOWED_EXTERNAL_PACKAGES with BLOCKED_PACKAGES**

In `lib/extract-code.ts`, replace lines 616-617:

Old:
```typescript
// Packages the Sandpack environment provides. Everything else is disallowed.
const ALLOWED_EXTERNAL_PACKAGES = new Set(["react", "react-dom", "lucide-react"]);
```

New:
```typescript
// Packages that cannot run in the Sandpack browser sandbox. Everything else is allowed.
const BLOCKED_PACKAGES = new Set([
  // Node native modules
  "fs", "path", "child_process", "crypto", "os", "net", "http", "https",
  // Requires native compilation
  "sharp", "canvas", "puppeteer", "playwright", "better-sqlite3",
  // Oversized (>5MB)
  "three", "tensorflow", "@tensorflow/tfjs",
  // Server-only frameworks
  "express", "fastify", "koa", "next", "prisma",
]);
```

- [ ] **Step 4: Reverse checkDisallowedImports logic**

In `lib/extract-code.ts`, in the `checkDisallowedImports` function (line 625-648), change the condition on line 641 from:

Old:
```typescript
      if (!ALLOWED_EXTERNAL_PACKAGES.has(basePkg)) {
```

New:
```typescript
      if (BLOCKED_PACKAGES.has(basePkg)) {
```

- [ ] **Step 5: Export BLOCKED_PACKAGES for use by validate-scaffold**

Add this export right after the `BLOCKED_PACKAGES` const declaration:

```typescript
export { BLOCKED_PACKAGES };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-code.test" --testNamePattern="blacklist mode"`
Expected: PASS — all 8 new tests pass

- [ ] **Step 7: Run all extract-code tests to check for regressions**

Run: `npm test -- --testPathPatterns="extract-code.test"`
Expected: PASS (some old tests that asserted whitelist behavior may need updating — see next step)

- [ ] **Step 8: Fix any broken existing tests**

If any existing tests asserted that packages like `recharts` or `zustand` are disallowed, update them to reflect the new blacklist behavior. These tests will now need to assert the package is *allowed*.

- [ ] **Step 9: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat: replace package whitelist with blacklist in checkDisallowedImports"
```

---

### Task 3: Add scaffold validation rules 6-7

**Files:**
- Modify: `lib/validate-scaffold.ts:122-186`
- Test: `__tests__/validate-scaffold.test.ts`

- [ ] **Step 1: Write failing tests for rules 6 and 7**

Append to `__tests__/validate-scaffold.test.ts`:

```typescript
describe("Rule 6: maxLines clamping", () => {
  it("clamps maxLines below 50 to 50", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "", maxLines: 10 },
      ],
      sharedTypes: "",
      designNotes: "",
    };
    const { scaffold, warnings } = validateScaffold(input);
    expect(scaffold.files[0].maxLines).toBe(50);
    expect(warnings).toContainEqual(expect.stringContaining("maxLines"));
  });

  it("clamps maxLines above 500 to 500", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "", maxLines: 800 },
      ],
      sharedTypes: "",
      designNotes: "",
    };
    const { scaffold, warnings } = validateScaffold(input);
    expect(scaffold.files[0].maxLines).toBe(500);
    expect(warnings).toContainEqual(expect.stringContaining("maxLines"));
  });

  it("leaves valid maxLines unchanged", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "", maxLines: 300 },
      ],
      sharedTypes: "",
      designNotes: "",
    };
    const { scaffold, warnings } = validateScaffold(input);
    expect(scaffold.files[0].maxLines).toBe(300);
    expect(warnings).toHaveLength(0);
  });

  it("leaves undefined maxLines unchanged", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "" },
      ],
      sharedTypes: "",
      designNotes: "",
    };
    const { scaffold } = validateScaffold(input);
    expect(scaffold.files[0].maxLines).toBeUndefined();
  });
});

describe("Rule 7: blocked dependencies removal", () => {
  it("removes blacklisted packages from dependencies", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "" },
      ],
      sharedTypes: "",
      designNotes: "",
      dependencies: { "recharts": "^2.0.0", "express": "^4.0.0", "fs": "latest" },
    };
    const { scaffold, warnings } = validateScaffold(input);
    expect(scaffold.dependencies).toEqual({ "recharts": "^2.0.0" });
    expect(warnings).toContainEqual(expect.stringContaining("express"));
    expect(warnings).toContainEqual(expect.stringContaining("fs"));
  });

  it("leaves clean dependencies unchanged", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "" },
      ],
      sharedTypes: "",
      designNotes: "",
      dependencies: { "recharts": "^2.0.0", "framer-motion": "^11.0.0" },
    };
    const { scaffold, warnings } = validateScaffold(input);
    expect(scaffold.dependencies).toEqual({ "recharts": "^2.0.0", "framer-motion": "^11.0.0" });
    expect(warnings).toHaveLength(0);
  });

  it("handles undefined dependencies", () => {
    const input: ScaffoldData = {
      files: [
        { path: "/a.js", description: "test", exports: ["default"], deps: [], hints: "" },
      ],
      sharedTypes: "",
      designNotes: "",
    };
    const { scaffold } = validateScaffold(input);
    expect(scaffold.dependencies).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="validate-scaffold" --testNamePattern="Rule 6|Rule 7"`
Expected: FAIL — rules 6 and 7 don't exist yet

- [ ] **Step 3: Import BLOCKED_PACKAGES in validate-scaffold.ts**

At top of `lib/validate-scaffold.ts`, add:

```typescript
import { BLOCKED_PACKAGES } from "@/lib/extract-code";
```

- [ ] **Step 4: Add Rule 6 (maxLines clamping) after Rule 5**

In `lib/validate-scaffold.ts`, after the Rule 5 block (line 180) and before the `return` statement (line 182), add:

```typescript
  // Rule 6: clamp maxLines to [50, 500]
  files = files.map((f) => {
    if (f.maxLines === undefined) return f;
    if (f.maxLines < 50) {
      warnings.push(`maxLines 过小: ${f.path} (${f.maxLines} → 50)`);
      return { ...f, maxLines: 50 };
    }
    if (f.maxLines > 500) {
      warnings.push(`maxLines 过大: ${f.path} (${f.maxLines} → 500)`);
      return { ...f, maxLines: 500 };
    }
    return f;
  });

  // Rule 7: strip blacklisted dependencies
  let dependencies = raw.dependencies;
  if (dependencies) {
    const cleaned: Record<string, string> = {};
    for (const [pkg, ver] of Object.entries(dependencies)) {
      const basePkg = pkg.startsWith("@")
        ? pkg.split("/").slice(0, 2).join("/")
        : pkg.split("/")[0];
      if (BLOCKED_PACKAGES.has(basePkg)) {
        warnings.push(`移除黑名单依赖: ${pkg}`);
      } else {
        cleaned[pkg] = ver;
      }
    }
    dependencies = Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
```

- [ ] **Step 5: Update the return statement to include dependencies**

Replace the return statement:

Old:
```typescript
  return {
    scaffold: { ...raw, files, ...(removeFiles !== undefined ? { removeFiles } : {}) },
    warnings,
  };
```

New:
```typescript
  return {
    scaffold: {
      ...raw,
      files,
      ...(removeFiles !== undefined ? { removeFiles } : {}),
      ...(dependencies !== undefined ? { dependencies } : {}),
    },
    warnings,
  };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="validate-scaffold"`
Expected: PASS — all existing + new tests

- [ ] **Step 7: Commit**

```bash
git add lib/validate-scaffold.ts __tests__/validate-scaffold.test.ts
git commit -m "feat: add scaffold validation rules 6-7 (maxLines clamp, blocked deps removal)"
```

---

### Task 4: Update Architect and Engineer prompts for dynamic constraints

**Files:**
- Modify: `lib/generate-prompts.ts:4-608`
- Test: `__tests__/generate-prompts.test.ts`

- [ ] **Step 1: Write failing tests for dynamic line limits and threshold**

Append to `__tests__/generate-prompts.test.ts`:

```typescript
import { getMultiFileEngineerPrompt, snipCompletedFiles, getSystemPrompt } from "@/lib/generate-prompts";

describe("dynamic line limits", () => {
  it("uses maxLines from scaffold file when provided", () => {
    const prompt = getMultiFileEngineerPrompt({
      projectId: "test-proj",
      targetFiles: [
        { path: "/game.js", description: "game loop", exports: ["default"], deps: [], hints: "core", maxLines: 400 },
      ],
      sharedTypes: "",
      completedFiles: {},
      designNotes: "test",
    });
    expect(prompt).toContain("400");
    expect(prompt).not.toContain("150 行");
  });

  it("defaults to 150 when maxLines is omitted", () => {
    const prompt = getMultiFileEngineerPrompt({
      projectId: "test-proj",
      targetFiles: [
        { path: "/button.js", description: "button", exports: ["default"], deps: [], hints: "simple" },
      ],
      sharedTypes: "",
      completedFiles: {},
      designNotes: "test",
    });
    expect(prompt).toContain("150");
  });
});

describe("COMPOSER_DEP_THRESHOLD at 10", () => {
  it("does not compress direct deps when target has 7 deps (below new threshold)", () => {
    const completedFiles: Record<string, string> = {};
    const deps: string[] = [];
    for (let i = 0; i < 7; i++) {
      const path = `/dep${i}.js`;
      deps.push(path);
      completedFiles[path] = `export function dep${i}() { return ${i}; }`;
    }
    const result = snipCompletedFiles(completedFiles, [
      { path: "/app.js", description: "app", exports: ["default"], deps, hints: "" },
    ]);
    // All 7 deps should have full code (not compressed to signatures)
    for (const dep of deps) {
      expect(result[dep]).toContain("return");
    }
  });
});

describe("architect prompt no longer has hardcoded package whitelist", () => {
  it("does not contain recharts in the forbidden list", () => {
    const prompt = getSystemPrompt("architect", "test-proj");
    expect(prompt).not.toContain("recharts");
  });

  it("contains blacklist guidance", () => {
    const prompt = getSystemPrompt("architect", "test-proj");
    expect(prompt).toContain("express");
    // Should mention dependencies field
    expect(prompt).toContain("dependencies");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="generate-prompts.test" --testNamePattern="dynamic line|COMPOSER_DEP|architect prompt no longer"`
Expected: FAIL — prompts still have old constraints, threshold is still 5

- [ ] **Step 3: Raise COMPOSER_DEP_THRESHOLD to 10**

In `lib/generate-prompts.ts`, change line 187:

Old:
```typescript
const COMPOSER_DEP_THRESHOLD = 5;
```

New:
```typescript
const COMPOSER_DEP_THRESHOLD = 10;
```

- [ ] **Step 4: Update Architect system prompt**

In `lib/generate-prompts.ts`, replace the architect prompt in `getSystemPrompt` (the `architect:` key in the `prompts` object). Replace everything from the `architect:` key value to the closing backtick before `engineer:`.

New architect prompt content (replace the entire string value):

```typescript
    architect: `你是一位资深系统架构师。你会收到 PM 的产品需求文档，需要设计多文件 React 应用的文件脚手架。

技术约束（必须遵守）：
- 使用 React 函数组件 + Hooks
- 样式使用 Tailwind CSS（已在 Sandpack 环境预配置）
- 如需数据持久化，使用 Supabase JS SDK（@supabase/supabase-js 已预装）
- 多视图/多页面必须用 useState 状态切换实现，禁止使用 react-router-dom：
  const [view, setView] = useState('home')
  {view === 'home' && <HomeView onNavigate={setView} />}
  {view === 'form' && <FormView onBack={() => setView('home')} />}
- lucide-react 图标库已安装可直接使用

【第三方包规则】
你可以在 dependencies 字段中声明项目需要的 npm 包（如 recharts、framer-motion、zustand 等）。
Sandpack 沙箱会动态安装这些包。

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

文件规划要求：
- 拆分为 8 到 20 个文件，每个文件单一职责
- UI 组件、工具函数：maxLines 设为 150
- 核心业务逻辑（游戏循环、状态管理、数据处理引擎）：maxLines 可设 300-500
- 总项目行数预算：不超过 3000 行
- 必须包含 /App.js 作为入口文件
- 每个文件明确导出内容和依赖关系
- 组件导出名必须加功能性后缀（如 Panel、View、List、Form），避免与 lucide-react 图标重名。例如：CalculatorPanel 而非 Calculator，HistoryList 而非 History，SettingsPanel 而非 Settings

JSON schema：
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string","maxLines":"number (可选，默认150)"}],"sharedTypes":"string","designNotes":"string","removeFiles":["string"],"dependencies":{"packageName":"version"}}

字段说明：
- files: 文件列表，每项包含 path（文件路径）、description（职责描述）、exports（导出列表）、deps（依赖的其他文件路径）、hints（实现提示）、maxLines（可选，该文件的最大行数，默认 150）
- sharedTypes: 所有文件共享的 TypeScript/JSDoc 类型定义
- designNotes: 整体设计说明和风格指南
- removeFiles: （可选）需要删除的旧文件路径数组。仅在迭代模式下使用
- dependencies: （可选）项目需要的第三方 npm 包，格式同 package.json 的 dependencies

迭代规则（当收到已有架构分析时必须遵守）：
- 已有文件不要重新设计，除非用户明确要求修改
- 只输出需要新增的文件和必须修改的文件
- 修改已有文件时，保留其现有 exports 和 deps 结构，仅添加新功能
- 如需删除旧文件（如重命名或移除功能），将旧路径加入 removeFiles 数组

输出格式（严格遵守两个阶段）：

<thinking>
在此分析文件拆分合理性、依赖关系、模块边界。内容不限，不出现在最终结果中。
</thinking>

<output>
{"files":[...],"sharedTypes":"...","designNotes":"...","dependencies":{...}} （仅 JSON，不含任何其他内容）
</output>`,
```

- [ ] **Step 5: Update Engineer single-file system prompt**

In the `engineer:` key of `getSystemPrompt`, make these changes:

1. Replace the `【严禁包限制】` block (lines 83-93) with:

```
【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma
```

2. Replace line 121 (the hardcoded lucide/package restriction):

Old: `- 允许使用 lucide-react 图标库；绝对禁止使用 recharts、framer-motion 等其他外部库；本地文件只允许 import { supabase } from '/supabaseClient.js'`

New: `- 允许使用 lucide-react 图标库和沙箱中已安装的第三方包；本地文件只允许 import { supabase } from '/supabaseClient.js'`

3. Replace line 127 (the line limit line):

Old: `- 代码行数控制在 320 行以内，不写注释，使用紧凑写法`

New: `- 代码行数控制在 320 行以内，使用紧凑写法`

- [ ] **Step 6: Update multi-file engineer prompt for dynamic line limits**

In `lib/generate-prompts.ts`, in `getMultiFileEngineerPrompt` function:

6a. Replace the `【严禁包限制】` block (lines 285-294) with:

```
【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- Architect 在 scaffold 中声明的第三方包（已由 Sandpack 沙箱安装）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma
```

6b. Replace the last line of the function (line 343):

Old:
```typescript
- 每个文件不超过 150 行，使用紧凑写法`;
```

New — dynamically compute from the target files' maxLines:

```typescript
${targetFiles.length === 1
    ? `- 本文件代码行数控制在 ${targetFiles[0].maxLines ?? 150} 行以内`
    : targetFiles.map((f) => `- ${f.path}: 不超过 ${f.maxLines ?? 150} 行`).join("\n")}`;
```

- [ ] **Step 7: Update buildMissingFileEngineerPrompt**

In `lib/generate-prompts.ts`, in `buildMissingFileEngineerPrompt` (line 354), replace the `【严禁包限制】` block (lines 398-407) with:

```
【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma
```

- [ ] **Step 8: Update buildMismatchedFilesEngineerPrompt**

In `lib/generate-prompts.ts`, in `buildMismatchedFilesEngineerPrompt` (line 445), replace the `【严禁包限制】` block (lines 474-483) with the same block as step 7.

- [ ] **Step 9: Update buildDisallowedImportsEngineerPrompt**

In `lib/generate-prompts.ts`, in `buildDisallowedImportsEngineerPrompt` (line 521), update the `【允许的外部依赖】` section (lines 541-544) and the `【常见替换方案】` section (lines 546-554).

Replace lines 541-554:

Old:
```
【允许的外部依赖（仅限这些）】
- react / react-dom
- lucide-react（图标）
- /supabaseClient.js（数据库，使用 DynamicAppData 表，appId 固定为 '${projectId}'）

【常见替换方案】
- react-router-dom → 用 useState 控制当前视图：
  const [view, setView] = useState('home')
  {view === 'home' && <HomeView onNavigate={setView} />}
  {view === 'form' && <FormView onNavigate={setView} />}
- axios / fetch 库 → 原生 fetch API
- date-fns / moment → 原生 Date 对象
- recharts / chart.js → 纯 CSS 或 SVG 绘制
```

New:
```
【允许的外部依赖】
- react / react-dom
- lucide-react（图标）
- /supabaseClient.js（数据库，使用 DynamicAppData 表，appId 固定为 '${projectId}'）
- Architect 声明的第三方包（已安装在 Sandpack 沙箱中）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

【修复方案】
将禁止的包替换为浏览器兼容的实现（原生 API 或已安装的替代包）。
```

- [ ] **Step 10: Update buildRuntimeErrorFixPrompt**

In `lib/generate-prompts.ts`, in `buildRuntimeErrorFixPrompt` (line 568), update line 599:

Old: `- 不要引入新的外部包（只能用 react、react-dom、lucide-react）`

New: `- 不要引入沙箱中不存在的外部包`

- [ ] **Step 11: Run tests**

Run: `npm test -- --testPathPatterns="generate-prompts"`
Expected: PASS — all new + existing tests

- [ ] **Step 12: Commit**

```bash
git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
git commit -m "feat: dynamic line limits, blacklist-based prompts, raise COMPOSER_DEP_THRESHOLD to 10"
```

---

### Task 5: Add scaffold dependencies to Sandpack config

**Files:**
- Modify: `lib/sandpack-config.ts:154-222`
- Modify: `components/preview/preview-frame.tsx:20-39`
- Test: `__tests__/sandpack-config.test.ts`

- [ ] **Step 1: Write failing tests for scaffold dependency injection**

Append to `__tests__/sandpack-config.test.ts`:

```typescript
describe("scaffold dependencies injection", () => {
  it("merges scaffold dependencies into customSetup", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
    };
    const deps = { "recharts": "^2.0.0", "framer-motion": "^11.0.0" };
    const config = buildSandpackConfig(files, "proj-1", deps);
    expect(config.customSetup?.dependencies).toEqual(
      expect.objectContaining({
        "@supabase/supabase-js": "^2.39.0",
        "lucide-react": "^0.300.0",
        "recharts": "^2.0.0",
        "framer-motion": "^11.0.0",
      })
    );
  });

  it("works without scaffold dependencies (backward compatible)", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.customSetup?.dependencies).toEqual({
      "@supabase/supabase-js": "^2.39.0",
      "lucide-react": "^0.300.0",
    });
  });

  it("scaffold dependency overrides default version", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
    };
    const deps = { "lucide-react": "^0.400.0" };
    const config = buildSandpackConfig(files, "proj-1", deps);
    expect(config.customSetup?.dependencies?.["lucide-react"]).toBe("^0.400.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="sandpack-config" --testNamePattern="scaffold dependencies"`
Expected: FAIL — `buildSandpackConfig` doesn't accept a third parameter

- [ ] **Step 3: Add scaffoldDependencies parameter to buildSandpackConfig**

In `lib/sandpack-config.ts`, change the function signature (line 154):

Old:
```typescript
export function buildSandpackConfig(
  input: string | Record<string, string>,
  projectId: string
): SandpackConfig {
```

New:
```typescript
export function buildSandpackConfig(
  input: string | Record<string, string>,
  projectId: string,
  scaffoldDependencies?: Readonly<Record<string, string>>
): SandpackConfig {
```

- [ ] **Step 4: Merge scaffold dependencies into customSetup**

In `lib/sandpack-config.ts`, change the `customSetup` block (lines 210-214):

Old:
```typescript
    customSetup: {
      dependencies: {
        "@supabase/supabase-js": "^2.39.0",
        "lucide-react": "^0.300.0",
      },
    },
```

New:
```typescript
    customSetup: {
      dependencies: {
        "@supabase/supabase-js": "^2.39.0",
        "lucide-react": "^0.300.0",
        ...scaffoldDependencies,
      },
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="sandpack-config"`
Expected: PASS — all tests including new ones

- [ ] **Step 6: Add scaffoldDependencies prop to PreviewFrame**

In `components/preview/preview-frame.tsx`, update the props interface and function:

```typescript
interface PreviewFrameProps {
  files: Record<string, string>;
  projectId: string;
  errorFixEnabled?: boolean;
  onSandpackError?: (error: SandpackRuntimeError) => void;
  scaffoldDependencies?: Readonly<Record<string, string>>;
}
```

Update the component function signature:

```typescript
export function PreviewFrame({ files, projectId, errorFixEnabled = false, onSandpackError, scaffoldDependencies }: PreviewFrameProps) {
  const config = buildSandpackConfig(files, projectId, scaffoldDependencies);
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add lib/sandpack-config.ts components/preview/preview-frame.tsx __tests__/sandpack-config.test.ts
git commit -m "feat: inject scaffold dependencies into Sandpack customSetup"
```

---

### Task 6: Thread scaffold dependencies through chat-area and workspace

**Files:**
- Modify: `components/workspace/chat-area.tsx:55-66,685-1096`
- Modify: `components/workspace/workspace.tsx` (may need to pass scaffoldDependencies)
- Modify: `components/preview/preview-panel.tsx` (may need to pass scaffoldDependencies)

This task wires the data flow: scaffold → chat-area state → onFilesGenerated → workspace → preview-frame.

- [ ] **Step 1: Find how files flow from chat-area to preview-frame**

Read the workspace component to understand the data flow between `onFilesGenerated` and `PreviewFrame`. The scaffold dependencies need to be stored alongside the files and passed through.

Read these files:
- `components/workspace/workspace.tsx` — find where `currentFiles` is stored and passed to preview
- `components/preview/preview-panel.tsx` — find where `PreviewFrame` is rendered

- [ ] **Step 2: Add scaffoldDependencies to workspace state**

In `components/workspace/workspace.tsx`, add a state variable for scaffold dependencies:

```typescript
const [scaffoldDependencies, setScaffoldDependencies] = useState<Record<string, string> | undefined>();
```

Thread it to the `PreviewFrame` (or `PreviewPanel`) component as a prop, and accept a setter callback from `ChatArea` alongside `onFilesGenerated`.

- [ ] **Step 3: Store scaffold.dependencies in chat-area after architect phase**

In `components/workspace/chat-area.tsx`, after the scaffold is validated (around line 685 where `scaffold.files.length > 1` is checked), capture the dependencies:

```typescript
const scaffoldDeps = scaffold.dependencies;
```

- [ ] **Step 4: Replace fixed MAX_PATCH_FILES with dynamic computation**

In `components/workspace/chat-area.tsx`:

Remove the constant on line 66:
```typescript
const MAX_PATCH_FILES = 3;
```

Replace it with a function:
```typescript
function computeMaxPatchFiles(totalFiles: number): number {
  return Math.min(8, Math.max(3, Math.ceil(totalFiles * 0.3)));
}
```

Then, at each location where `MAX_PATCH_FILES` is used (lines 427, 909, 982, 1024), replace it with a call to `computeMaxPatchFiles(totalFiles)` using the `totalFiles` value available in that scope.

For line 427 (triage path), use `Object.keys(currentFiles).length` as totalFiles.

For lines 909, 982, 1024 (post-processing), use `Object.keys(allCompletedFiles).length` as totalFiles.

- [ ] **Step 5: Pass scaffoldDependencies through onFilesGenerated callback**

Update the `ChatAreaProps` interface to include a scaffold dependencies callback:

```typescript
onScaffoldDependenciesChange?: (deps: Record<string, string> | undefined) => void;
```

Call it after architect phase completes with valid scaffold:

```typescript
onScaffoldDependenciesChange?.(scaffoldDeps);
```

Also call it with `undefined` when entering direct path (no scaffold).

- [ ] **Step 6: Wire scaffoldDependencies from workspace to preview-frame**

In `workspace.tsx`, pass `scaffoldDependencies` to the preview component. In `preview-panel.tsx`, forward it to `PreviewFrame`.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add components/workspace/chat-area.tsx components/workspace/workspace.tsx components/preview/preview-panel.tsx
git commit -m "feat: dynamic MAX_PATCH_FILES, thread scaffold dependencies to Sandpack"
```

---

### Task 7: Update existing tests and verify full test suite

**Files:**
- Modify: `__tests__/preview-frame.test.tsx` (if buildSandpackConfig signature changes break mocks)
- Modify: `__tests__/supabase-injection.test.ts` (same)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: Check for any failures due to our changes

- [ ] **Step 2: Fix any broken tests**

Common breakages to check:
- Tests calling `buildSandpackConfig(files, projectId)` — should still work (third param is optional)
- Tests asserting `checkDisallowedImports` blocks `recharts` — must be updated to expect it's allowed now
- Tests asserting the Architect prompt contains `recharts` in the forbidden list — remove those assertions

Fix each broken test to match the new behavior.

- [ ] **Step 3: Run full test suite again**

Run: `npm test`
Expected: PASS — all tests green

- [ ] **Step 4: Commit**

```bash
git add __tests__/
git commit -m "test: update existing tests for blacklist-based package validation"
```

---

### Task 8: Update CLAUDE.md known limitations table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the known limitations table**

In `CLAUDE.md`, find the "Known limitations & open issues" table. Update the complex game entry:

Old:
```
| 复杂游戏类项目（如超级玛丽）无法生成可玩内容 — 每文件 150 行限制 + Sandpack 禁止游戏框架（Phaser/PixiJS）+ AI 倾向搭框架跳过核心逻辑 | — | ⚠️ 已知限制（系统设计目标为中小型 React UI 应用） |
```

New:
```
| 复杂游戏类项目 — 动态行数上限 + 第三方包黑名单机制已解锁，但 AI 代码质量在 300+ 行文件时可能下降 | — | ✅ 基本解决（动态 maxLines + 包黑名单 + 动态补全上限） |
```

- [ ] **Step 2: Update the Architecture section**

In CLAUDE.md, update the `resolveModelId` comment or the key files table if the `ScaffoldData` type description needs updating. Add `dependencies` to the ScaffoldData description in the types table row.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update known limitations for complex app generation support"
```

---

### Task 9: Manual integration test

This is a manual verification step — no code changes.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test simple project (regression)**

Create a new project with prompt: "做一个简单的待办事项应用"

Verify:
- PM → Architect → Engineer pipeline works
- Architect scaffold has no `dependencies` or `maxLines` fields (defaults apply)
- Generated code stays within 150 lines per file
- Preview renders correctly in Sandpack
- No regressions from current behavior

- [ ] **Step 3: Test complex project**

Create a new project with prompt: "做一个带数据图表的仪表盘应用，使用 recharts 展示各种数据"

Verify:
- Architect declares `dependencies: { "recharts": "..." }` in scaffold
- Architect sets `maxLines: 300+` for the chart data processing files
- Engineer uses recharts components in the generated code
- Sandpack installs recharts and renders the charts
- No `checkDisallowedImports` violations for recharts

- [ ] **Step 4: Test game project**

Create a new project with prompt: "做一个超级玛丽风格的平台跳跃游戏，用 Canvas API"

Verify:
- Architect sets `maxLines: 400-500` for game loop and physics files
- Engineer generates substantial game logic (not skeleton/placeholder)
- Game renders in the Sandpack preview (Canvas-based)
- Post-processing handles any missing files (dynamic patch limit)
