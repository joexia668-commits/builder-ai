# Bugfix Direct Path Arch Context Injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject architecture summary from `deriveArchFromFiles` into the bug_fix/style_change direct path so Engineer sees the full project structure and avoids over-rewriting.

**Architecture:** Add an optional `archSummary` parameter to `buildDirectMultiFileEngineerContext`. In `chat-area.tsx`, call `deriveArchFromFiles(currentFiles)` on the full file set (not triage subset) and pass it through. Zero LLM calls, zero latency impact.

**Tech Stack:** TypeScript, Next.js, Jest

---

### Task 1: Add `archSummary` parameter to `buildDirectMultiFileEngineerContext`

**Files:**
- Modify: `lib/agent-context.ts:97-126`
- Test: `__tests__/agent-context.test.ts:282-317`

- [ ] **Step 1: Write the failing test — archSummary injected when provided**

Add to the existing `describe("buildDirectMultiFileEngineerContext")` block in `__tests__/agent-context.test.ts` after line 317:

```typescript
  it("injects arch summary and constraint when archSummary is provided", () => {
    const archSummary = "当前应用架构（从代码实时分析）：\n\n文件结构（3 个文件）：\n  /App.js — exports: App (default)\n  /components/Button.js — exports: Button\n  /components/Header.js — exports: Header (default)\n\n依赖关系：\n  /App.js → [/components/Button.js, /components/Header.js]";
    const result = buildDirectMultiFileEngineerContext(prompt, files, archSummary);
    expect(result).toContain("当前应用架构");
    expect(result).toContain("/components/Header.js");
    expect(result).toContain("严禁重写");
    expect(result).toContain("所有现有 import 必须保留");
  });
```

- [ ] **Step 2: Write the failing test — no archSummary preserves existing behavior**

Add right after the previous test:

```typescript
  it("does not inject arch block when archSummary is omitted", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).not.toContain("严禁重写");
    expect(result).not.toContain("所有现有 import 必须保留");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="agent-context.test" --testNamePattern="arch"`
Expected: FAIL — `buildDirectMultiFileEngineerContext` does not accept a third argument yet

- [ ] **Step 4: Implement — add `archSummary` parameter**

In `lib/agent-context.ts`, replace lines 97-126 with:

```typescript
export function buildDirectMultiFileEngineerContext(
  userPrompt: string,
  currentFiles: Record<string, string>,
  archSummary?: string
): string {
  const fileList = Object.keys(currentFiles)
    .map((p) => `- ${p}`)
    .join("\n");

  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `<source file="${path}">\n${code}\n</source>`)
    .join("\n\n");

  const archBlock = archSummary
    ? `\n${archSummary}\n\n重要约束：你的任务是定向修复上述反馈中的问题，严禁重写、重构或添加未提及的功能。保持应用的整体架构、功能和 UI 不变。所有现有 import 必须保留，除非 import 的目标文件确实不存在。\n`
    : "";

  return `你是一位全栈工程师。根据用户反馈，精准修改以下多文件 React 应用。

用户反馈：${userPrompt}
${archBlock}
当前应用文件列表：
${fileList}

当前版本代码（逐文件参考）：
${filesSection}

输出格式（严格遵守，违反将导致解析失败）：
- 只输出你实际需要修改的文件，未修改的文件不要输出——它们会被自动保留
- 每个修改的文件必须以分隔符开头：// === FILE: /path ===（即使只改了一行也必须输出完整文件）
- 紧接着是该文件的完整修改后代码
- 严禁输出 \`\`\`jsx、\`\`\`js、\`\`\` 等任何 Markdown 代码围栏
- 严禁输出解释性文字、摘要、注释说明
- 第一个字符必须是 /（分隔符的斜杠），不得有任何前置文字`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="agent-context.test"`
Expected: ALL PASS (new tests + existing tests)

- [ ] **Step 6: Commit**

```bash
git add lib/agent-context.ts __tests__/agent-context.test.ts
git commit -m "feat: add archSummary param to buildDirectMultiFileEngineerContext (ADR 0018)"
```

---

### Task 2: Wire up arch summary in chat-area.tsx direct path

**Files:**
- Modify: `components/workspace/chat-area.tsx:426-428`

- [ ] **Step 1: Add arch summary derivation before context building**

In `components/workspace/chat-area.tsx`, replace lines 426-428:

```typescript
        const baseDirectContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, triageFiles)
          : buildDirectEngineerContext(prompt, currentFiles);
```

with:

```typescript
        const archSummary = isMultiFileV1 ? deriveArchFromFiles(currentFiles) : "";

        const baseDirectContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, triageFiles, archSummary || undefined)
          : buildDirectEngineerContext(prompt, currentFiles);
```

Note: `deriveArchFromFiles(currentFiles)` uses the **full** file set (all 27 files), while `triageFiles` is the triage-narrowed subset. `deriveArchFromFiles` is already imported at line 26.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "agent-context|chat-area"`
Expected: no errors from these two files (pre-existing errors in other files are ok)

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: inject arch summary into bug_fix/style_change direct path (ADR 0018)"
```

---

### Task 3: Update ADR 0018 status

**Files:**
- Modify: `docs/adr/0018-bugfix-direct-path-no-arch-context.md:43-51`

- [ ] **Step 1: Update ADR status**

In `docs/adr/0018-bugfix-direct-path-no-arch-context.md`, replace lines 43-51:

```markdown
## 修复方案（待实施）

**方向 A — 给 bug_fix 加架构上下文：**
在 `buildDirectMultiFileEngineerContext` 中调用 `deriveArchFromFiles(currentFiles)`，在 prompt 开头注入架构摘要，让 Engineer 知道"这是一个计算器 app，有暗黑模式和历史记录功能"。

**方向 B — 改动范围硬约束：**
triage 阶段已选出需要修改的文件（≤3 个）。在 prompt 中明确禁止修改 triage 未选中的文件，即使 Engineer 输出了额外文件也丢弃。

**推荐：A + B 同时实施。**
```

with:

```markdown
## 修复方案

**方向 A — 给 bug_fix 加架构上下文：** ✅ 已实施
在 `buildDirectMultiFileEngineerContext` 中注入 `deriveArchFromFiles(currentFiles)` 的架构摘要（全量文件），加上"严禁重写/严禁删除 import"的约束指令。代码只传 triage 选中的文件，架构摘要覆盖全量文件。

**方向 B — 改动范围硬约束：** ⏭️ 暂不实施
经分析，实际 case 中 Engineer 只输出了 triage 选中的文件，未输出额外文件。问题在于缺少架构感知而非范围失控。后续观察是否需要。
```

- [ ] **Step 2: Update CLAUDE.md known issues table**

In `CLAUDE.md`, update the ADR 0018 row status from `⏳ 待实施` to `✅ 已修复（方向 A：架构摘要注入）`.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0018-bugfix-direct-path-no-arch-context.md CLAUDE.md
git commit -m "docs: mark ADR 0018 Direction A as implemented"
```
