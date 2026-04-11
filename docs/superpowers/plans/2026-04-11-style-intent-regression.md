# Style Intent Regression Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs that cause "make buttons yellow"-style prompts to trigger a full app regeneration instead of a targeted style change.

**Architecture:** Two independent fixes — (1) add a regex layer to `classifyIntent` so color words like "黄色"/"底色" route to `style_change`; (2) change `buildDirectMultiFileEngineerContext` to ask the LLM to output only modified files instead of all files, letting the existing spread-merge in `chat-area.tsx` preserve unchanged files automatically.

**Tech Stack:** TypeScript, Jest (tests run with `npm test`)

---

## File Map

| File | Change |
|------|--------|
| `lib/intent-classifier.ts` | Add regex patterns; extend STYLE_KEYWORDS |
| `__tests__/intent-classifier.test.ts` | Add test cases for new color/style patterns |
| `lib/agent-context.ts` | Fix `buildDirectMultiFileEngineerContext` prompt |
| `__tests__/agent-context.test.ts` | Add tests for `buildDirectMultiFileEngineerContext` |

---

## Task 1: Add failing tests for intent classifier color/style patterns

**Files:**
- Modify: `__tests__/intent-classifier.test.ts`

- [ ] **Step 1: Add failing test cases to the existing `style_change detection` describe block**

Open `__tests__/intent-classifier.test.ts` and append these cases inside the `describe("style_change detection", ...)` block (after the last `it(...)` in that block):

```typescript
it("detects 黄色 (specific color word)", () => {
  expect(classifyIntent("所有按键底色换成黄色", true)).toBe("style_change");
});

it("detects 底色 (color suffix word)", () => {
  expect(classifyIntent("底色改一下", true)).toBe("style_change");
});

it("detects 红色", () => {
  expect(classifyIntent("把标题改成红色", true)).toBe("style_change");
});

it("detects 蓝色", () => {
  expect(classifyIntent("背景换成蓝色", true)).toBe("style_change");
});

it("detects hex color value", () => {
  expect(classifyIntent("把主色换成 #ff6600", true)).toBe("style_change");
});

it("detects rgb() color value", () => {
  expect(classifyIntent("color should be rgb(255,0,0)", true)).toBe("style_change");
});

it("detects 圆角", () => {
  expect(classifyIntent("给按钮加圆角", true)).toBe("style_change");
});

it("detects 阴影", () => {
  expect(classifyIntent("卡片加个阴影效果", true)).toBe("style_change");
});

it("detects 加粗", () => {
  expect(classifyIntent("标题文字加粗", true)).toBe("style_change");
});
```

Also append a **no-regression case** inside the existing `describe("feature_add (default)", ...)` block:

```typescript
it("功能性请求不误判为 style_change (下载黄色图片功能)", () => {
  // Contains 黄色 but it's a feature request, not a style change.
  // Acceptable trade-off: this test documents the known limitation;
  // in practice app-builder prompts like this are rare.
  // If this becomes a problem, add the LLM second-pass (Approach C).
  expect(classifyIntent("添加下载黄色图片的功能", true)).not.toBe("feature_add");
  // Note: it will route to style_change — document that is acceptable
});
```

Wait — actually the above is misleading. The regex WILL match "黄色" in that prompt and classify it as style_change. That's the known acceptable trade-off documented in the spec. Remove that test and replace with a pure no-regression test that doesn't involve color words:

```typescript
it("no regression: 纯功能请求仍为 feature_add", () => {
  expect(classifyIntent("添加用户登录注册功能", true)).toBe("feature_add");
});

it("no regression: bug_fix 优先级高于颜色词", () => {
  // prompt contains both a bug keyword and a color word
  expect(classifyIntent("修复黄色按钮点击报错", true)).toBe("bug_fix");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ruby/Projects/personal/builder-ai
npm test -- --testPathPatterns="intent-classifier"
```

Expected: multiple FAIL — `classifyIntent("所有按键底色换成黄色", true)` returns `"feature_add"` instead of `"style_change"`.

---

## Task 2: Implement regex layer in intent classifier

**Files:**
- Modify: `lib/intent-classifier.ts`

- [ ] **Step 1: Replace the file content with the updated implementation**

```typescript
import type { Intent } from "@/lib/types";

const BUG_KEYWORDS = [
  "bug", "错误", "不工作", "修复", "报错", "没有反应",
  "失效", "崩溃", "出错", "fix", "broken", "doesn't work",
  "不能用", "失败", "exception", "异常",
] as const;

const STYLE_KEYWORDS = [
  "颜色", "字体", "样式", "布局", "ui", "美化", "主题",
  "color", "font", "style", "layout", "theme", "dark mode", "深色",
  "background", "背景", "间距", "padding", "margin", "设计",
  "圆角", "阴影", "shadow", "border-radius", "加粗", "字号",
] as const;

const NEW_PROJECT_KEYWORDS = [
  "重新做", "重新设计", "全新", "new project", "start over",
  "重做", "从头", "推倒重来",
] as const;

// Matches any Chinese color word ending in 色 (黄色, 红色, 底色, 背景色…)
const CHINESE_COLOR_RE = /[\u4e00-\u9fa5]{0,4}色/;

// Matches CSS hex or rgb color values
const CSS_COLOR_RE = /#[0-9a-fA-F]{3,6}|rgb\(|rgba\(/i;

/**
 * Returns true if the prompt contains a color-related expression that indicates
 * a style change intent (color word, hex value, rgb value).
 */
function hasColorIntent(lower: string): boolean {
  return CHINESE_COLOR_RE.test(lower) || CSS_COLOR_RE.test(lower);
}

/**
 * Classifies the intent of a user prompt based on keywords and context.
 * Priority order: new_project (no code) > bug_fix > style_change > new_project (keywords) > feature_add
 */
export function classifyIntent(
  prompt: string,
  hasExistingCode: boolean
): Intent {
  if (!hasExistingCode) return "new_project";

  const lower = prompt.toLowerCase();

  if (BUG_KEYWORDS.some((kw) => lower.includes(kw))) return "bug_fix";
  if (STYLE_KEYWORDS.some((kw) => lower.includes(kw))) return "style_change";
  if (hasColorIntent(lower)) return "style_change";
  if (NEW_PROJECT_KEYWORDS.some((kw) => lower.includes(kw))) return "new_project";

  return "feature_add";
}
```

- [ ] **Step 2: Run the tests to confirm they pass**

```bash
npm test -- --testPathPatterns="intent-classifier"
```

Expected: all tests PASS including the new color/style cases.

- [ ] **Step 3: Run full test suite to catch regressions**

```bash
npm test
```

Expected: all existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/intent-classifier.ts __tests__/intent-classifier.test.ts
git commit -m "fix: add regex color detection to classifyIntent — routes color-change prompts to style_change"
```

---

## Task 3: Add failing tests for buildDirectMultiFileEngineerContext

**Files:**
- Modify: `__tests__/agent-context.test.ts`

- [ ] **Step 1: Add import for the new function**

At the top of `__tests__/agent-context.test.ts`, the import line currently reads:

```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildPmIterationContext,
} from "@/lib/agent-context";
```

Replace it with:

```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmIterationContext,
} from "@/lib/agent-context";
```

- [ ] **Step 2: Add test cases at the end of the file**

Append after the last `describe(...)` block:

```typescript
describe("buildDirectMultiFileEngineerContext", () => {
  const prompt = "所有按键底色换成黄色";
  const files = {
    "/App.js": "export default function App() { return <div><Button/></div> }",
    "/components/Button.js": "export function Button() { return <button>Click</button> }",
  };

  it("includes user prompt labeled as 用户反馈", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("用户反馈");
    expect(result).toContain(prompt);
  });

  it("includes existing file content", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("/App.js");
    expect(result).toContain("/components/Button.js");
    expect(result).toContain("export default function App()");
  });

  it("instructs LLM to output ONLY modified files (not all files)", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("只输出你实际需要修改的文件");
  });

  it("does NOT instruct LLM to copy unchanged files verbatim", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).not.toContain("未修改的文件原样复制");
    expect(result).not.toContain("必须输出全部文件");
  });

  it("uses FILE separator format in output instructions", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("// === FILE:");
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="agent-context"
```

Expected: the new `buildDirectMultiFileEngineerContext` tests FAIL — either import error (function not exported) or assertion failures on "只输出你实际需要修改的文件" / "必须输出全部文件".

---

## Task 4: Fix buildDirectMultiFileEngineerContext prompt

**Files:**
- Modify: `lib/agent-context.ts`

- [ ] **Step 1: Update the function**

In `lib/agent-context.ts`, find `buildDirectMultiFileEngineerContext` (lines 96–124) and replace the entire function:

```typescript
/**
 * Builds Engineer context for the direct bug-fix / style-change path on multi-file V1 apps.
 * Instructs the LLM to output ONLY the files it actually modifies.
 * Unchanged files are NOT re-emitted — the caller merges { ...currentFiles, ...llmOutput }
 * so unmodified files are preserved automatically without going through the LLM.
 */
export function buildDirectMultiFileEngineerContext(
  userPrompt: string,
  currentFiles: Record<string, string>
): string {
  const fileList = Object.keys(currentFiles)
    .map((p) => `- ${p}`)
    .join("\n");

  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `<source file="${path}">\n${code}\n</source>`)
    .join("\n\n");

  return `你是一位全栈工程师。根据用户反馈，精准修改以下多文件 React 应用。

用户反馈：${userPrompt}

当前应用文件列表：
${fileList}

当前版本代码（逐文件参考）：
${filesSection}

输出格式（严格遵守）：
- 只输出你实际需要修改的文件，未修改的文件不要输出——它们会被自动保留
- 每个修改的文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整修改后代码
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容`;
}
```

- [ ] **Step 2: Run the agent-context tests**

```bash
npm test -- --testPathPatterns="agent-context"
```

Expected: all tests PASS, including the new `buildDirectMultiFileEngineerContext` suite.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/agent-context.ts __tests__/agent-context.test.ts
git commit -m "fix: buildDirectMultiFileEngineerContext outputs only modified files — prevents LLM from overwriting unchanged styles"
```

---

## Done

Both root causes are fixed:
1. "所有按键底色换成黄色" → `style_change` (direct path, no PM/Architect)
2. Direct multi-file path LLM only outputs modified files → unchanged files preserved via spread-merge
