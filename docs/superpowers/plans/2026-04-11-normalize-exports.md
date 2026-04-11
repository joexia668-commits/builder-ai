# Normalize Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle import-analysis-based `patchExportMismatches` function with a proactive `normalizeExports` function that ensures every AI-generated file exposes both named and default exports, eliminating the "Element type is invalid: got undefined" preview error.

**Architecture:** `normalizeExports` inspects each file's *own* exports in isolation — no cross-file import parsing. For every file it appends any missing export style (`export { default as X }` or `export default FirstNamed`) so that both `import X from` and `import { X } from` always resolve to a valid value. The stub injection layer (`findMissingLocalImportsWithNames`) and the prompt-level dual-export rule are left unchanged as complementary defences.

**Tech Stack:** TypeScript, Jest, `lib/sandpack-config.ts`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `__tests__/sandpack-config.test.ts` | Modify | Add 6 new tests for `normalizeExports` behaviour |
| `lib/sandpack-config.ts` | Modify | Replace `patchExportMismatches` with `normalizeExports` |

---

### Task 1: Write the 6 failing tests for `normalizeExports`

**Files:**
- Modify: `__tests__/sandpack-config.test.ts`

The new tests exercise `normalizeExports` behaviour indirectly through `buildSandpackConfig` (same pattern as existing tests). Add a new `describe` block at the bottom of the file.

- [ ] **Step 1: Add the failing test block**

Append this entire block to `__tests__/sandpack-config.test.ts` (after the closing `});` of the existing `describe`):

```typescript
describe("normalizeExports (via buildSandpackConfig)", () => {
  it("adds named re-export when file has only export default function", () => {
    const files = {
      "/App.js": `import Btn from '/Btn.jsx'\nexport default function App() { return null; }`,
      "/Btn.jsx": `export default function Btn() { return <button />; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toContain("export { default as Btn }");
  });

  it("adds default export when file has only a named export", () => {
    const files = {
      "/App.js": `import Btn from '/Btn.jsx'\nexport default function App() { return null; }`,
      "/Btn.jsx": `export function Btn() { return <button />; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toContain("export default Btn");
  });

  it("does not modify a file that already has both named and default exports", () => {
    const original = `export function Btn() { return <button />; }\nexport default Btn;`;
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/Btn.jsx": original,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toBe(original);
  });

  it("adds named re-export for identifier-style default export (export default X;)", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/Btn.jsx": `const Btn = () => null;\nexport default Btn;`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toContain("export { default as Btn }");
  });

  it("adds default using first named export when multiple named exports exist and no default", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/utils.js": `export function formatNum(n) { return n; }\nexport function clamp(n) { return n; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/utils.js"].code).toContain("export default formatNum");
  });

  it("does not add named re-export for anonymous default arrow function", () => {
    const original = `export default () => null;`;
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/Btn.jsx": original,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toBe(original);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they all fail**

```bash
npm test -- --testPathPatterns="sandpack-config"
```

Expected: 6 new tests FAIL. The existing 5 tests should still pass. Failure messages will vary — some will say "expected string not to contain X", some will show the code doesn't contain the expected export. Any failure proves the tests are testing real behaviour not yet implemented.

If any new test already passes, the existing `patchExportMismatches` happens to cover that case — note it but continue.

- [ ] **Step 3: Commit the failing tests**

```bash
git add __tests__/sandpack-config.test.ts
git commit -m "test: add failing tests for normalizeExports behaviour"
```

---

### Task 2: Implement `normalizeExports` and replace `patchExportMismatches`

**Files:**
- Modify: `lib/sandpack-config.ts`

Replace lines 11–99 (the JSDoc comment + `patchExportMismatches` function body) with the new `normalizeExports` function. The call site on line 147 changes from `patchExportMismatches` to `normalizeExports`.

- [ ] **Step 1: Replace the `patchExportMismatches` function**

In `lib/sandpack-config.ts`, replace the entire block from the JSDoc comment on line 11 through the closing `}` of `patchExportMismatches` on line 99 with:

```typescript
/**
 * Ensure every AI-generated file exposes both a default export and at least one
 * named export, so that both `import X from` and `import { X } from` always
 * resolve to a valid value in Sandpack.
 *
 * Works file-by-file without cross-file import analysis — immune to import
 * style variations that caused the previous regex-based patcher to silently skip.
 *
 * Rules applied per file:
 *   • Has `export default function/class X` or `export default X` but no same-named
 *     named export → append `export { default as X };`
 *   • Has named exports but no default export → append `export default FirstNamed;`
 *   • Already has both, or default is anonymous → no change
 */
function normalizeExports(
  files: Record<string, string>
): Record<string, string> {
  const result = { ...files };

  for (const [path, code] of Object.entries(files)) {
    const additions: string[] = [];

    // 1. Detect default export name (null for anonymous defaults)
    const defaultFnMatch = code.match(
      /export\s+default\s+(?:async\s+)?(?:function|class)\s+([a-zA-Z_$][\w$]*)/
    );
    const defaultIdMatch = !defaultFnMatch
      ? code.match(/export\s+default\s+([a-zA-Z_$][\w$]*)/)
      : null;
    const defaultName = defaultFnMatch?.[1] ?? defaultIdMatch?.[1];
    const hasDefault = /export\s+default\b/.test(code);

    // 2. Collect all named exports from this file
    const namedSet = new Set<string>();
    for (const m of Array.from(
      code.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z_$][\w$]*)/g)
    )) {
      if (m[1] !== "default") namedSet.add(m[1]);
    }
    for (const m of Array.from(code.matchAll(/export\s*\{([^}]+)\}/g))) {
      for (const token of m[1].split(",")) {
        const parts = token.trim().split(/\s+as\s+/);
        const exported = (parts[1] ?? parts[0]).trim();
        if (exported && exported !== "default" && /^[a-zA-Z_$][\w$]*$/.test(exported))
          namedSet.add(exported);
      }
    }

    // 3. Bidirectional normalization
    // Default with a name but no matching named export → add named re-export
    if (defaultName && !namedSet.has(defaultName)) {
      additions.push(`export { default as ${defaultName} };`);
    }
    // Named exports exist but no default → promote first named to default
    if (!hasDefault && namedSet.size > 0) {
      const first = Array.from(namedSet)[0];
      additions.push(`export default ${first};`);
    }

    if (additions.length > 0) {
      result[path] = code + "\n// [builder-ai: export normalization]\n" + additions.join("\n");
    }
  }

  return result;
}
```

- [ ] **Step 2: Update the call site**

On the line that currently reads:

```typescript
    userFiles = patchExportMismatches(userFiles);
```

Change it to:

```typescript
    userFiles = normalizeExports(userFiles);
```

The comment above it ("Fix default-vs-named export mismatches…") should become:

```typescript
  // Normalize exports: ensure every file exposes both named and default export
  // styles so any import form resolves to a valid component, not undefined.
  if (typeof input !== "string") {
    userFiles = normalizeExports(userFiles);
  }
```

- [ ] **Step 3: Run the full sandpack-config test suite**

```bash
npm test -- --testPathPatterns="sandpack-config"
```

Expected: All 11 tests pass (5 existing + 6 new). If any test fails, check whether the regex in `normalizeExports` is matching the test input correctly. Common pitfall: the `defaultIdMatch` regex `export\s+default\s+([a-zA-Z_$][\w$]*)` will also match `export default function` by capturing `function` as the name — ensure the `!defaultFnMatch` guard is in place.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: All tests pass. Zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/sandpack-config.ts __tests__/sandpack-config.test.ts
git commit -m "fix: replace patchExportMismatches with proactive normalizeExports

Reactive import-analysis approach had regex gaps that caused
'Element type is invalid: got undefined' on every multi-file
generation. New normalizeExports inspects each file's own exports
in isolation and appends missing export styles bidirectionally,
eliminating the cross-file import parsing dependency."
```

---

## Verification

After both tasks are complete:

1. Start the dev server: `npm run dev:clean`
2. Create a new project and prompt: `做一个计算器`
3. Wait for generation to complete
4. Confirm the preview renders without "Element type is invalid" errors
5. Repeat with: `做一个待办清单`
6. Confirm both work
