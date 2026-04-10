# Lucide Naming Conflict Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent AI-generated code from producing duplicate identifier errors when a component file name collides with a lucide-react icon name (e.g. `Calculator`).

**Architecture:** Two prompt-only changes in `lib/generate-prompts.ts`. (A) Architect prompt gets a naming convention rule requiring functional suffixes on component exports. (B) Multi-file engineer prompt gets an alias rule for same-name icon + component imports. No runtime logic changes.

**Tech Stack:** TypeScript, Jest (existing test suite in `__tests__/generate-prompts.test.ts`)

---

### Task 1: Write failing tests for the two new prompt rules

**Files:**
- Modify: `__tests__/generate-prompts.test.ts`

- [ ] **Step 1: Open the test file and locate the two describe blocks to add to**

  The architect tests live in `describe("getSystemPrompt")` (around line 75+).
  The multi-file engineer tests live in `describe("getMultiFileEngineerPrompt")` (around line 166+).

- [ ] **Step 2: Add the architect naming-convention test**

  Append inside `describe("getSystemPrompt")`, after the existing `GP-ARCH-JSON-03` test (around line 163):

  ```typescript
  // GP-ARCH-NAMING-01: architect prompt must require functional suffix on component exports
  it("GP-ARCH-NAMING-01: architect 提示词要求组件导出名加功能性后缀，避免与 lucide-react 图标重名", () => {
    const prompt = getSystemPrompt("architect", "proj-1");
    expect(prompt).toContain("Panel");
    expect(prompt).toContain("CalculatorPanel");
    expect(prompt).toContain("lucide-react 图标重名");
  });
  ```

- [ ] **Step 3: Add the multi-file engineer alias-rule test**

  Append inside `describe("getMultiFileEngineerPrompt")`, after the existing `GP-MFE-06` test (around line 234):

  ```typescript
  // GP-MFE-ALIAS-01: multi-file engineer prompt must instruct aliasing when icon and component share a name
  it("GP-MFE-ALIAS-01: getMultiFileEngineerPrompt 包含同名 lucide 图标别名规则", () => {
    const prompt = getMultiFileEngineerPrompt({
      projectId: "proj-alias",
      targetFiles: [],
      sharedTypes: "",
      completedFiles: {},
      designNotes: "",
    });
    expect(prompt).toContain("CalculatorIcon");
    expect(prompt).toContain("别名");
  });
  ```

- [ ] **Step 4: Run the new tests to confirm they fail (RED)**

  ```bash
  cd /Users/ruby/Projects/personal/builder-ai-fix
  npm test -- --testPathPatterns="generate-prompts"
  ```

  Expected: `GP-ARCH-NAMING-01` and `GP-MFE-ALIAS-01` both **FAIL** (the rules don't exist yet). All other tests should still **PASS**.

---

### Task 2: Add naming convention rule to the Architect prompt

**Files:**
- Modify: `lib/generate-prompts.ts` (architect section, lines ~45–49)

- [ ] **Step 1: Locate the 文件规划要求 section in the architect prompt**

  In `lib/generate-prompts.ts`, find the architect prompt block. The 文件规划要求 section reads:

  ```
  文件规划要求：
  - 拆分为 8 到 20 个文件，每个文件单一职责，不超过 150 行
  - 必须包含 /App.js 作为入口文件
  - 每个文件明确导出内容和依赖关系
  ```

- [ ] **Step 2: Append the naming convention rule as the last bullet in that section**

  Replace:
  ```
  - 每个文件明确导出内容和依赖关系
  ```

  With:
  ```
  - 每个文件明确导出内容和依赖关系
  - 组件导出名必须加功能性后缀（如 Panel、View、List、Form），避免与 lucide-react 图标重名。例如：CalculatorPanel 而非 Calculator，HistoryList 而非 History，SettingsPanel 而非 Settings
  ```

- [ ] **Step 3: Run the architect naming test to confirm it passes (GREEN)**

  ```bash
  npm test -- --testPathPatterns="generate-prompts" --testNamePattern="GP-ARCH-NAMING-01"
  ```

  Expected: **PASS**

- [ ] **Step 4: Run the full generate-prompts test suite to confirm no regressions**

  ```bash
  npm test -- --testPathPatterns="generate-prompts"
  ```

  Expected: all tests **PASS** (only `GP-MFE-ALIAS-01` still fails — that's expected, Task 3 fixes it)

---

### Task 3: Add alias rule to the Multi-file Engineer prompt

**Files:**
- Modify: `lib/generate-prompts.ts` (`getMultiFileEngineerPrompt` function, lines ~193–196)

- [ ] **Step 1: Locate the icon/HTTP lines in `getMultiFileEngineerPrompt`**

  Inside the returned template string, find:

  ```
  UI 样式只使用 Tailwind CSS class。
  图标只使用 lucide-react。
  HTTP 请求只使用原生 fetch API。
  ```

- [ ] **Step 2: Append the alias rule after the icon line**

  Replace:
  ```
  UI 样式只使用 Tailwind CSS class。
  图标只使用 lucide-react。
  HTTP 请求只使用原生 fetch API。
  ```

  With:
  ```
  UI 样式只使用 Tailwind CSS class。
  图标只使用 lucide-react。若需同时从 lucide-react 和本地组件文件导入同名符号，必须对图标做别名：import { Calculator as CalculatorIcon } from 'lucide-react'，JSX 中使用别名。
  HTTP 请求只使用原生 fetch API。
  ```

- [ ] **Step 3: Run the alias rule test to confirm it passes (GREEN)**

  ```bash
  npm test -- --testPathPatterns="generate-prompts" --testNamePattern="GP-MFE-ALIAS-01"
  ```

  Expected: **PASS**

- [ ] **Step 4: Run the full generate-prompts test suite to confirm everything passes**

  ```bash
  npm test -- --testPathPatterns="generate-prompts"
  ```

  Expected: all tests **PASS** including `GP-ARCH-NAMING-01` and `GP-MFE-ALIAS-01`

---

### Task 4: Run full test suite and commit

**Files:** none (verification only)

- [ ] **Step 1: Run the full Jest test suite**

  ```bash
  cd /Users/ruby/Projects/personal/builder-ai-fix
  npm test
  ```

  Expected: all tests **PASS**. If any pre-existing test fails, it is unrelated to this change — do not fix it here.

- [ ] **Step 2: Commit**

  ```bash
  git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
  git commit -m "fix: prevent lucide-react icon name collision in generated code

  - Architect prompt: require functional suffix on component exports (Panel/View/List/Form)
  - Multi-file engineer prompt: require aliasing when icon and component share a name"
  ```

- [ ] **Step 3: Verify the worktree branch**

  ```bash
  git log --oneline -3
  ```

  Expected: top commit is the one just made on branch `fix/calculator-naming-conflict`.
