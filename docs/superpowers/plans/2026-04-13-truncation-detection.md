# Truncation Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect six types of code truncation in LLM-generated files so truncated files are marked as `failed` and retried automatically by the existing `runLayerWithFallback` machinery.

**Architecture:** Replace `isBracesBalanced` with `isDelimitersBalanced` (checks `{}`, `()`, `[]`) and add `hasUnterminatedLiteral` (checks `'`, `"`, `` ` ``, `/* */`). Both checks run in `extractMultiFileCodePartial`. Update retry hint wording to cover truncation scenarios. Zero changes to `runLayerWithFallback`, `route.ts`, or `chat-area.tsx` orchestration logic.

**Tech Stack:** TypeScript, Jest

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `lib/extract-code.ts` | Code extraction + validation utilities | Modify: rename `isBracesBalanced` → `isDelimitersBalanced`, add `hasUnterminatedLiteral`, wire into `extractMultiFileCodePartial` |
| `lib/types.ts` | Shared type definitions | Modify: add `"string_truncated"` to `AttemptReason` union |
| `lib/generate-prompts.ts` | Engineer prompt construction | Modify: update retry instruction wording (line 257) |
| `components/workspace/chat-area.tsx` | Generation orchestration | Modify: update retryHint reason string (line 657) |
| `__tests__/extract-code.test.ts` | Unit + integration tests for extract-code | Modify: add ~14 new test cases |

---

### Task 1: `isDelimitersBalanced` — tests + implementation

**Files:**
- Modify: `__tests__/extract-code.test.ts`
- Modify: `lib/extract-code.ts:73-80`

- [ ] **Step 1: Write failing tests for `isDelimitersBalanced`**

Add this new `describe` block at the end of `__tests__/extract-code.test.ts`, after the `deduplicateDefaultExport` describe block (after line 432):

```typescript
describe("isDelimitersBalanced", () => {
  // Import at top of file is updated in Step 3
  const { isDelimitersBalanced } = require("@/lib/extract-code");

  it("returns true when all three delimiter pairs are balanced", () => {
    expect(isDelimitersBalanced("fn([{x: 1}])")).toBe(true);
  });

  it("returns true for code with no delimiters", () => {
    expect(isDelimitersBalanced("const x = 1")).toBe(true);
  });

  it("returns false for unbalanced braces", () => {
    expect(isDelimitersBalanced("function App() { return 1;")).toBe(false);
  });

  it("returns false for unbalanced parens", () => {
    expect(isDelimitersBalanced("function App(")).toBe(false);
  });

  it("returns false for unbalanced brackets", () => {
    expect(isDelimitersBalanced("const arr = [1, 2,")).toBe(false);
  });

  it("returns false when only parens are unbalanced but braces are balanced", () => {
    expect(isDelimitersBalanced("export default function App() { return foo(1, 2; }")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-code" --testNamePattern="isDelimitersBalanced"`
Expected: FAIL — `isDelimitersBalanced` is not exported

- [ ] **Step 3: Implement `isDelimitersBalanced` and rename all call sites**

In `lib/extract-code.ts`, replace the `isBracesBalanced` function (lines 73-80) with:

```typescript
/** Check that all three delimiter pairs are balanced. */
export function isDelimitersBalanced(code: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (const ch of code) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  return braces === 0 && parens === 0 && brackets === 0;
}
```

Then rename all call sites within the same file. There are 4 locations:

1. `isCodeComplete` function (line ~91): change `return isBracesBalanced(code)` → `return isDelimitersBalanced(code)`

2. `extractAnyMultiFileCode` (line ~184): change `if (!isBracesBalanced(code)) return null` → `if (!isDelimitersBalanced(code)) return null`

3. `extractMultiFileCode` (line ~233): change `if (!isBracesBalanced(code)) return null` → `if (!isDelimitersBalanced(code)) return null`

4. `extractMultiFileCodePartial` (line ~283): change `if (!isBracesBalanced(code))` → `if (!isDelimitersBalanced(code))`

Also update the test file import (line 8 of `__tests__/extract-code.test.ts`) to add `isDelimitersBalanced`:

```typescript
import { extractReactCode, extractMultiFileCode, findMissingLocalImports, findMissingLocalImportsWithNames, extractMultiFileCodePartial, deduplicateDefaultExport, isDelimitersBalanced } from "@/lib/extract-code";
```

And update the test to use the direct import instead of `require`:

```typescript
describe("isDelimitersBalanced", () => {
  it("returns true when all three delimiter pairs are balanced", () => {
    expect(isDelimitersBalanced("fn([{x: 1}])")).toBe(true);
  });

  it("returns true for code with no delimiters", () => {
    expect(isDelimitersBalanced("const x = 1")).toBe(true);
  });

  it("returns false for unbalanced braces", () => {
    expect(isDelimitersBalanced("function App() { return 1;")).toBe(false);
  });

  it("returns false for unbalanced parens", () => {
    expect(isDelimitersBalanced("function App(")).toBe(false);
  });

  it("returns false for unbalanced brackets", () => {
    expect(isDelimitersBalanced("const arr = [1, 2,")).toBe(false);
  });

  it("returns false when only parens are unbalanced but braces are balanced", () => {
    expect(isDelimitersBalanced("export default function App() { return foo(1, 2; }")).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-code"`
Expected: ALL PASS (new tests + existing tests — existing tests must not regress since `isDelimitersBalanced` is a strict superset of `isBracesBalanced`)

- [ ] **Step 5: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat(extract-code): replace isBracesBalanced with isDelimitersBalanced — adds () and [] checks"
```

---

### Task 2: `hasUnterminatedLiteral` — tests + implementation

**Files:**
- Modify: `__tests__/extract-code.test.ts`
- Modify: `lib/extract-code.ts`

- [ ] **Step 1: Write failing tests for `hasUnterminatedLiteral`**

Add this `describe` block after the `isDelimitersBalanced` tests in `__tests__/extract-code.test.ts`:

```typescript
describe("hasUnterminatedLiteral", () => {
  it("returns false for normal code with closed strings", () => {
    expect(hasUnterminatedLiteral("import { X } from 'react';\nconst y = \"ok\";")).toBe(false);
  });

  it("returns true for unterminated single-quoted string", () => {
    expect(hasUnterminatedLiteral("import { X } from 'lucide")).toBe(true);
  });

  it("returns true for unterminated double-quoted string", () => {
    expect(hasUnterminatedLiteral('import { X } from "lucide')).toBe(true);
  });

  it("returns true for unterminated template literal", () => {
    expect(hasUnterminatedLiteral("const x = `hello ${")).toBe(true);
  });

  it("returns false for escaped quote inside string", () => {
    expect(hasUnterminatedLiteral("const x = 'it\\'s fine';")).toBe(false);
  });

  it("returns false for quote inside single-line comment", () => {
    expect(hasUnterminatedLiteral("// don't touch\nconst x = 1;")).toBe(false);
  });

  it("returns true for unterminated multi-line comment", () => {
    expect(hasUnterminatedLiteral("/* TODO: fix this")).toBe(true);
  });

  it("returns false for properly closed multi-line comment", () => {
    expect(hasUnterminatedLiteral("/* comment */ const x = 1;")).toBe(false);
  });
});
```

Update the import line at the top of `__tests__/extract-code.test.ts` to include `hasUnterminatedLiteral`:

```typescript
import { extractReactCode, extractMultiFileCode, findMissingLocalImports, findMissingLocalImportsWithNames, extractMultiFileCodePartial, deduplicateDefaultExport, isDelimitersBalanced, hasUnterminatedLiteral } from "@/lib/extract-code";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-code" --testNamePattern="hasUnterminatedLiteral"`
Expected: FAIL — `hasUnterminatedLiteral` is not exported

- [ ] **Step 3: Implement `hasUnterminatedLiteral`**

Add this function in `lib/extract-code.ts`, right after the `isDelimitersBalanced` function:

```typescript
/**
 * Detect unclosed string literals (' " `) or unclosed multi-line comments.
 * Uses a character-level state machine mirroring stripComments().
 * Returns true if the code contains an unterminated literal — indicating
 * the LLM output was truncated mid-string or mid-comment.
 */
export function hasUnterminatedLiteral(code: string): boolean {
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // Single-line comment — skip to end of line
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }

    // Multi-line comment — skip to */
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      if (i >= code.length) return true;
      i += 2;
      continue;
    }

    // Single/double-quoted string
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") i++;
        i++;
      }
      if (i >= code.length) return true;
      i++;
      continue;
    }

    // Template literal
    if (ch === "`") {
      i++;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") i++;
        i++;
      }
      if (i >= code.length) return true;
      i++;
      continue;
    }

    i++;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="extract-code" --testNamePattern="hasUnterminatedLiteral"`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat(extract-code): add hasUnterminatedLiteral — detects unclosed strings and comments"
```

---

### Task 3: Wire into `extractMultiFileCodePartial` + integration tests

**Files:**
- Modify: `lib/extract-code.ts:276-295`
- Modify: `__tests__/extract-code.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add these test cases inside the existing `describe("extractMultiFileCodePartial", ...)` block in `__tests__/extract-code.test.ts`, after the last existing test (the `deduplicates double default export` test, around line 400):

```typescript
  it("marks file with unterminated string as failed", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
      "// === FILE: /B.js ===",
      "import { X } from 'lucide",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, ["/A.js", "/B.js"]);
    expect(result.ok["/A.js"]).toContain("return 1");
    expect(result.ok["/B.js"]).toBeUndefined();
    expect(result.failed).toContain("/B.js");
  });

  it("marks file with unbalanced parens as failed", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export default function App() { return null; }",
      "// === FILE: /B.js ===",
      "export default function Broken(",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, ["/A.js", "/B.js"]);
    expect(result.ok["/A.js"]).toBeDefined();
    expect(result.failed).toContain("/B.js");
  });

  it("marks file with unterminated multi-line comment as failed", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
      "// === FILE: /B.js ===",
      "/* TODO: implement this",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, ["/A.js", "/B.js"]);
    expect(result.ok["/A.js"]).toBeDefined();
    expect(result.failed).toContain("/B.js");
  });

  it("passes file with balanced delimiters and closed strings", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "import { X } from 'react';",
      "export default function App() { return [1, 2, 3].map((x) => x); }",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, ["/A.js"]);
    expect(result.ok["/A.js"]).toBeDefined();
    expect(result.failed).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="extract-code" --testNamePattern="marks file with unterminated"`
Expected: FAIL — the unterminated string and comment tests should fail because `extractMultiFileCodePartial` doesn't call `hasUnterminatedLiteral` yet. The unbalanced parens test should also fail because the old `isBracesBalanced` didn't check parens.

Note: if Task 1 is already done, the parens test might pass (since `isDelimitersBalanced` now checks parens). The string/comment tests will still fail.

- [ ] **Step 3: Add `hasUnterminatedLiteral` check to `extractMultiFileCodePartial`**

In `lib/extract-code.ts`, find the `extractMultiFileCodePartial` function. Locate the existing delimiter check inside the `for` loop (around line 283):

```typescript
    if (!isDelimitersBalanced(code)) {
      failed.push(path);
      continue;
    }
```

Add the `hasUnterminatedLiteral` check immediately after:

```typescript
    if (!isDelimitersBalanced(code)) {
      failed.push(path);
      continue;
    }
    if (hasUnterminatedLiteral(code)) {
      failed.push(path);
      continue;
    }
```

- [ ] **Step 4: Run full test suite to verify all pass**

Run: `npm test -- --testPathPatterns="extract-code"`
Expected: ALL PASS (all new + all existing tests)

- [ ] **Step 5: Commit**

```bash
git add lib/extract-code.ts __tests__/extract-code.test.ts
git commit -m "feat(extract-code): wire hasUnterminatedLiteral into extractMultiFileCodePartial"
```

---

### Task 4: Type extension + retry hint update

**Files:**
- Modify: `lib/types.ts:153-157`
- Modify: `lib/generate-prompts.ts:251-265`
- Modify: `components/workspace/chat-area.tsx:653-660`

- [ ] **Step 1: Add `"string_truncated"` to `AttemptReason`**

In `lib/types.ts`, find the `AttemptReason` type (line 153):

```typescript
export type AttemptReason =
  | "initial"
  | "parse_failed"
  | "http_error"
  | "per_file_fallback";
```

Change to:

```typescript
export type AttemptReason =
  | "initial"
  | "parse_failed"
  | "string_truncated"
  | "http_error"
  | "per_file_fallback";
```

- [ ] **Step 2: Update retry hint reason string in `chat-area.tsx`**

In `components/workspace/chat-area.tsx`, find line 657:

```typescript
                            reason: "parse_failed",
```

Change to:

```typescript
                            reason: "输出不完整（字符串/括号截断或代码结构不完整）",
```

- [ ] **Step 3: Update retry instruction wording in `generate-prompts.ts`**

In `lib/generate-prompts.ts`, find the retry block (line 257):

```typescript
4. 最后一个文件的大括号必须平衡
```

Change to:

```typescript
4. 确保所有字符串闭合、所有括号/方括号/花括号配对、注释块完整
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | grep -v "generate-route-model"`
Expected: No new type errors (only pre-existing `generate-route-model.test.ts` errors)

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/generate-prompts.ts components/workspace/chat-area.tsx
git commit -m "feat: add string_truncated AttemptReason + update retry hint for truncation coverage"
```

---

### Task 5: Final verification

**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run build**

Run: `npm run build 2>&1 | tail -5`
Expected: `✓ Compiled successfully` (no type errors)

- [ ] **Step 3: Verify coverage on new code**

Run: `npm run test:coverage -- --testPathPatterns="extract-code" 2>&1 | grep -A5 "extract-code"`
Expected: `extract-code.ts` coverage stays ≥ 80%
