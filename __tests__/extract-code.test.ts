/**
 * TDD tests for extractReactCode utility
 *
 * Engineer agent must output pure React code (no markdown fences per PRD).
 * This utility handles the fallback case where fences slip through.
 */

import { extractReactCode, extractMultiFileCode, findMissingLocalImports, findMissingLocalImportsWithNames, extractMultiFileCodePartial, deduplicateDefaultExport, isDelimitersBalanced, hasUnterminatedLiteral, extractFileExports, extractFileImports, checkImportExportConsistency } from "@/lib/extract-code";

describe("extractReactCode", () => {
  it("extracts code from ```jsx fences", () => {
    const input = "Here is the app:\n```jsx\nexport default function App() {}\n```";
    expect(extractReactCode(input)).toBe("export default function App() {}");
  });

  it("extracts code from ```js fences", () => {
    const input = "```js\nexport default function App() { return <div>Hello</div>; }\n```";
    expect(extractReactCode(input)).toBe("export default function App() { return <div>Hello</div>; }");
  });

  it("extracts code from ``` fences (no language tag)", () => {
    const input = "```\nexport default function App() { return <div/> }\n```";
    expect(extractReactCode(input)).toBe("export default function App() { return <div/> }");
  });

  it("returns raw content when no fences present (pure code output)", () => {
    const pure = "export default function App() {\n  return <div>Hello</div>;\n}";
    expect(extractReactCode(pure)).toBe(pure);
  });

  it("trims leading/trailing whitespace from extracted code", () => {
    const input = "```jsx\n\n  export default function App() {}\n\n```";
    expect(extractReactCode(input)).toBe("export default function App() {}");
  });

  it("handles tsx fence", () => {
    const input = "```tsx\nexport default function App(): JSX.Element { return <></> }\n```";
    expect(extractReactCode(input)).toBe("export default function App(): JSX.Element { return <></> }");
  });

  // Layer 2: head location — no fence, starts from import/export default
  it("extracts from import head when no fence present", () => {
    const input = "Here is your app:\nimport { useState } from 'react';\nexport default function App() { return <div/> }";
    const result = extractReactCode(input);
    expect(result).toMatch(/^import/);
    expect(result).not.toContain("Here is your app:");
  });

  it("extracts from export default head when no import and no fence", () => {
    const input = "Here is your app:\nexport default function App() {\n  return <div>Hello</div>;\n}";
    const result = extractReactCode(input);
    expect(result).toMatch(/^export default/);
    expect(result).not.toContain("Here is your app:");
  });

  // Layer 3: tail truncation — strips trailing explanation after last }
  it("truncates trailing explanation text after last closing brace", () => {
    const code = "export default function App() {\n  return <div>Hello</div>;\n}";
    const input = `${code}\n\nThis component uses React hooks and Tailwind CSS for styling.`;
    const result = extractReactCode(input);
    expect(result).toBe(code);
    expect(result).not.toContain("This component uses");
  });

  it("adds export default when missing after extraction", () => {
    const input = "function App() {\n  return <div/>\n}";
    const result = extractReactCode(input);
    expect(result).toContain("export default");
  });

  it("handles LLM preamble + fence + postamble (fence wins)", () => {
    const input = "Here's the code:\n```jsx\nexport default function App() { return <p>Hi</p>; }\n```\nFeel free to customize!";
    expect(extractReactCode(input)).toBe("export default function App() { return <p>Hi</p>; }");
  });

  // EC-L0-01: Layer 0 — annotated fence ```jsx filename=App.jsx (EPIC 5 Step 4)
  // EC-L0-01: Layer 0 — annotated fence ```jsx filename=App.jsx
  it("EC-L0-01: extracts code from ```jsx filename=App.jsx annotated fence", () => {
    const input = "```jsx filename=App.jsx\nexport default function App() { return <div>Hello</div>; }\n```";
    expect(extractReactCode(input)).toBe("export default function App() { return <div>Hello</div>; }");
  });

  // EC-L0-02: Layer 0 — annotated fence with tsx
  it("EC-L0-02: extracts code from ```tsx filename=App.tsx annotated fence", () => {
    const input = "```tsx filename=App.tsx\nexport default function App(): JSX.Element { return <main/>; }\n```";
    expect(extractReactCode(input)).toBe("export default function App(): JSX.Element { return <main/>; }");
  });

  // EC-L0-03: Layer 0 — annotated fence with multiple annotation tokens
  // EC-L0-03: Layer 0 — annotated fence with multiple spaces/extra annotations
  it("EC-L0-03: extracts code from fence with extra annotation tokens", () => {
    const input = "```jsx title=\"App\" filename=App.jsx\nexport default function App() { return <span/>; }\n```";
    expect(extractReactCode(input)).toBe("export default function App() { return <span/>; }");
  });

  // EC-L0-04: Layer 0 wins over Layer 1 — annotated fence takes priority
  // EC-L0-04: Layer 0 wins over Layer 1 — annotated fence takes priority over plain fence
  it("EC-L0-04: annotated fence (Layer 0) takes priority over plain fence (Layer 1)", () => {
    const input = "```jsx filename=App.jsx\nexport default function First() {}\n```\n```jsx\nexport default function Second() {}\n```";
    const result = extractReactCode(input);
    expect(result).toContain("First");
    expect(result).not.toContain("Second");
  });

  // Completeness validation — truncated code returns null
  it("returns null for truncated code with unbalanced braces", () => {
    // Simulates LLM stopping mid-JSX before closing the component function
    const truncated =
      'export default function App() {\n  return (\n    <div className="container">\n      <h1 className="ml-3 text';
    expect(extractReactCode(truncated)).toBeNull();
  });

  it("returns null for code missing closing brace of component body", () => {
    const truncated =
      "export default function App() {\n  const [items, setItems] = useState([]);\n  return (\n    <ul>\n      {items.map(i => <li key={i}>{i}</li>)}\n    </ul>\n  );";
    // Opening braces: 3 (function, useState arg, map arrow), Closing: 1 (map) — unbalanced
    expect(extractReactCode(truncated)).toBeNull();
  });

  it("returns string (not null) for complete valid code", () => {
    const complete =
      "export default function App() {\n  return <div>Hello</div>;\n}";
    expect(extractReactCode(complete)).not.toBeNull();
    expect(typeof extractReactCode(complete)).toBe("string");
  });

  it("returns string (not null) when export default is auto-appended for balanced code", () => {
    // No explicit export default, but braces are balanced — auto-append makes it complete
    const noExport = "function App() {\n  return <div/>\n}";
    const result = extractReactCode(noExport);
    expect(result).not.toBeNull();
    expect(result).toContain("export default");
  });
});

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

describe("findMissingLocalImportsWithNames", () => {
  it("returns named exports for missing named imports", () => {
    const files = {
      "/App.js": `import { AuthForm, LoginButton } from '/components/auth.js'\nexport default function App() { return null; }`,
    };
    const result = findMissingLocalImportsWithNames(files);
    expect(result.size).toBe(1);
    const names = result.get("/components/auth.js");
    expect(names).toBeDefined();
    expect(names!.has("AuthForm")).toBe(true);
    expect(names!.has("LoginButton")).toBe(true);
  });

  it("uses original export name for renamed imports (Foo as Bar → Foo)", () => {
    const files = {
      "/App.js": `import { Foo as Bar } from '/utils/foo.js'`,
    };
    const result = findMissingLocalImportsWithNames(files);
    const names = result.get("/utils/foo.js");
    expect(names!.has("Foo")).toBe(true);
    expect(names!.has("Bar")).toBe(false);
  });

  it("tracks default-only import path with empty named exports set", () => {
    const files = {
      "/App.js": `import MyComponent from '/components/my.js'`,
    };
    const result = findMissingLocalImportsWithNames(files);
    expect(result.has("/components/my.js")).toBe(true);
    expect(result.get("/components/my.js")!.size).toBe(0);
  });

  it("merges named exports from multiple files importing the same path", () => {
    const files = {
      "/A.js": `import { Foo } from '/utils/shared.js'`,
      "/B.js": `import { Bar } from '/utils/shared.js'`,
    };
    const result = findMissingLocalImportsWithNames(files);
    const names = result.get("/utils/shared.js");
    expect(names!.has("Foo")).toBe(true);
    expect(names!.has("Bar")).toBe(true);
  });

  it("whitelists /supabaseClient.js", () => {
    const files = {
      "/App.js": `import { supabase } from '/supabaseClient.js'`,
    };
    expect(findMissingLocalImportsWithNames(files).size).toBe(0);
  });

  it("does not flag present paths as missing", () => {
    const files = {
      "/App.js": `import { foo } from '/utils/helpers.js'`,
      "/utils/helpers.js": `export const foo = () => null;`,
    };
    expect(findMissingLocalImportsWithNames(files).size).toBe(0);
  });

  it("returns empty map for empty files", () => {
    expect(findMissingLocalImportsWithNames({}).size).toBe(0);
  });
});

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

describe("extractMultiFileCodePartial", () => {
  const expected = ["/A.js", "/B.js", "/C.js"];

  it("returns ok={3}, failed=[], truncatedTail=null when all files are valid", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
      "// === FILE: /B.js ===",
      "export const B = () => { return 2 }",
      "// === FILE: /C.js ===",
      "export const C = () => { return 3 }",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, expected);
    expect(Object.keys(result.ok)).toEqual(["/A.js", "/B.js", "/C.js"]);
    expect(result.failed).toEqual([]);
    expect(result.truncatedTail).toBeNull();
  });

  it("returns partial ok + failed when one file has unbalanced braces", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
      "// === FILE: /B.js ===",
      "export const B = () => { return 2 }",
      "// === FILE: /C.js ===",
      "export const C = () => { if (true) { return 3 ",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, expected);
    expect(result.ok["/A.js"]).toContain("return 1");
    expect(result.ok["/B.js"]).toContain("return 2");
    expect(result.ok["/C.js"]).toBeUndefined();
    expect(result.failed).toEqual(["/C.js"]);
    expect(result.truncatedTail).not.toBeNull();
    expect(result.truncatedTail!.length).toBeLessThanOrEqual(200);
    expect(result.truncatedTail).toContain("return 3");
  });

  it("reports missing files in failed[] without affecting present ones", () => {
    const raw = [
      "// === FILE: /A.js ===",
      "export const A = () => { return 1 }",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, expected);
    expect(Object.keys(result.ok)).toEqual(["/A.js"]);
    expect([...result.failed].sort()).toEqual(["/B.js", "/C.js"]);
    expect(result.truncatedTail).not.toBeNull();
  });

  it("returns ok={}, failed=all, truncatedTail set when no markers present", () => {
    const raw = "just some nonsense output from the model";
    const result = extractMultiFileCodePartial(raw, expected);
    expect(result.ok).toEqual({});
    expect([...result.failed].sort()).toEqual(["/A.js", "/B.js", "/C.js"]);
    expect(result.truncatedTail).toBe("just some nonsense output from the model");
  });

  it("returns ok={}, failed=[], truncatedTail=null when expectedFiles is empty", () => {
    const result = extractMultiFileCodePartial("anything", []);
    expect(result.ok).toEqual({});
    expect(result.failed).toEqual([]);
    expect(result.truncatedTail).toBeNull();
  });

  it("deduplicates double default export in a file — keeps only the last one", () => {
    const raw = [
      "// === FILE: /utils/dataHelpers.js ===",
      "export function filterStudentsByClass(students, className) {",
      "  return students.filter(s => s.className === className);",
      "}",
      "export default filterStudentsByClass;",
      "export function validateStudent(student) {",
      "  return student.name.length > 0;",
      "}",
      "export default filterStudentsByClass;",
    ].join("\n");
    const result = extractMultiFileCodePartial(raw, ["/utils/dataHelpers.js"]);
    expect(result.failed).toEqual([]);
    const code = result.ok["/utils/dataHelpers.js"];
    const defaultCount = (code.match(/^export default /gm) ?? []).length;
    expect(defaultCount).toBe(1);
    // The last occurrence is preserved
    expect(code.endsWith("export default filterStudentsByClass;")).toBe(true);
  });

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
});

describe("deduplicateDefaultExport", () => {
  it("returns code unchanged when there is only one default export", () => {
    const code = "export function foo() {}\nexport default foo;";
    expect(deduplicateDefaultExport(code)).toBe(code);
  });

  it("removes earlier duplicate bare re-export lines, keeps last", () => {
    const code = [
      "export function foo() {}",
      "export default foo;",
      "export function bar() {}",
      "export default foo;",
    ].join("\n");
    const result = deduplicateDefaultExport(code);
    const count = (result.match(/^export default /gm) ?? []).length;
    expect(count).toBe(1);
    expect(result).toContain("export function foo");
    expect(result).toContain("export function bar");
  });

  it("does not touch export default function declarations", () => {
    const code = "export default function App() { return null; }";
    expect(deduplicateDefaultExport(code)).toBe(code);
  });

  it("returns code unchanged when no default export present", () => {
    const code = "export function foo() {}";
    expect(deduplicateDefaultExport(code)).toBe(code);
  });
});

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

  it("returns false when close appears before matching open", () => {
    expect(isDelimitersBalanced(")(")).toBe(false);
  });
});

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

  it("returns true for string truncated at newline (followed by more code)", () => {
    expect(hasUnterminatedLiteral("import { X } from 'lucide\nconst foo = 'bar';")).toBe(true);
  });
});

describe("extractFileExports", () => {
  it("returns named export from function declaration", () => {
    const result = extractFileExports("export function Foo() {}");
    expect(result.named.has("Foo")).toBe(true);
    expect(result.hasDefault).toBe(false);
  });

  it("returns named export from const declaration", () => {
    const result = extractFileExports("export const BAR = 42;");
    expect(result.named.has("BAR")).toBe(true);
  });

  it("returns named export from class declaration", () => {
    const result = extractFileExports("export class MyClass {}");
    expect(result.named.has("MyClass")).toBe(true);
  });

  it("returns named export from export { Foo }", () => {
    const result = extractFileExports("function Foo() {}\nexport { Foo };");
    expect(result.named.has("Foo")).toBe(true);
  });

  it("returns external name from export { Foo as Bar }", () => {
    const result = extractFileExports("export { internalFoo as Bar };");
    expect(result.named.has("Bar")).toBe(true);
    expect(result.named.has("internalFoo")).toBe(false);
  });

  it("detects export default function", () => {
    const result = extractFileExports("export default function App() {}");
    expect(result.hasDefault).toBe(true);
  });

  it("detects export default identifier", () => {
    const result = extractFileExports("function App() {}\nexport default App;");
    expect(result.hasDefault).toBe(true);
  });

  it("skips export type { Foo }", () => {
    const result = extractFileExports("export type { Foo };");
    expect(result.named.has("Foo")).toBe(false);
    expect(result.hasDefault).toBe(false);
  });

  it("returns both named and default for typical component file", () => {
    const code = "export function Button() {}\nexport default Button;";
    const result = extractFileExports(code);
    expect(result.named.has("Button")).toBe(true);
    expect(result.hasDefault).toBe(true);
  });
});

describe("extractFileImports", () => {
  it("returns named imports from local path", () => {
    const result = extractFileImports("import { Foo, Bar } from '/components/Foo.js';");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/components/Foo.js");
    expect(result[0].named).toEqual(expect.arrayContaining(["Foo", "Bar"]));
    expect(result[0].hasDefault).toBe(false);
  });

  it("returns default import from local path", () => {
    const result = extractFileImports("import Foo from '/components/Foo.js';");
    expect(result).toHaveLength(1);
    expect(result[0].hasDefault).toBe(true);
    expect(result[0].named).toHaveLength(0);
  });

  it("returns both default and named for mixed import", () => {
    const result = extractFileImports("import Foo, { Bar } from '/x.js';");
    expect(result).toHaveLength(1);
    expect(result[0].hasDefault).toBe(true);
    expect(result[0].named).toContain("Bar");
  });

  it("captures external name for aliased import (import { Foo as F })", () => {
    const result = extractFileImports("import { Foo as F } from '/x.js';");
    expect(result[0].named).toContain("Foo");
    expect(result[0].named).not.toContain("F");
  });

  it("skips external packages (non-slash paths)", () => {
    const result = extractFileImports(
      "import React from 'react'; import { X } from 'lucide-react';"
    );
    expect(result).toHaveLength(0);
  });

  it("skips import type declarations", () => {
    const result = extractFileImports("import type { Foo } from '/x.js';");
    expect(result).toHaveLength(0);
  });

  it("merges multiple imports from same path into one entry", () => {
    const code = "import Foo from '/x.js';\nimport { Bar } from '/x.js';";
    const result = extractFileImports(code);
    expect(result).toHaveLength(1);
    expect(result[0].hasDefault).toBe(true);
    expect(result[0].named).toContain("Bar");
  });

  it("handles multiple different local paths", () => {
    const code = "import { A } from '/a.js';\nimport B from '/b.js';";
    const result = extractFileImports(code);
    expect(result).toHaveLength(2);
    const paths = result.map((r) => r.path);
    expect(paths).toContain("/a.js");
    expect(paths).toContain("/b.js");
  });
});

describe("checkImportExportConsistency", () => {
  it("returns empty array when all imports match exports", () => {
    const files = {
      "/App.js":
        "import { Button } from '/Button.js'; export default function App() {}",
      "/Button.js": "export function Button() {}\nexport default Button;",
    };
    expect(checkImportExportConsistency(files)).toHaveLength(0);
  });

  it("detects named import with no matching named export", () => {
    const files = {
      "/App.js": "import { Button } from '/Button.js';",
      "/Button.js": "export default function Button() {}",
    };
    const result = checkImportExportConsistency(files);
    expect(result).toHaveLength(1);
    expect(result[0].importerPath).toBe("/App.js");
    expect(result[0].exporterPath).toBe("/Button.js");
    expect(result[0].missingNamed).toContain("Button");
    expect(result[0].missingDefault).toBe(false);
  });

  it("detects default import with no matching default export", () => {
    const files = {
      "/App.js": "import Layout from '/Layout.js';",
      "/Layout.js": "export function Layout() {}",
    };
    const result = checkImportExportConsistency(files);
    expect(result).toHaveLength(1);
    expect(result[0].missingDefault).toBe(true);
    expect(result[0].missingNamed).toHaveLength(0);
  });

  it("skips files missing from the files map (handled by findMissingLocalImports)", () => {
    const files = {
      "/App.js": "import { Foo } from '/Missing.js';",
    };
    expect(checkImportExportConsistency(files)).toHaveLength(0);
  });

  it("returns multiple mismatches across different file pairs", () => {
    const files = {
      "/A.js": "import { X } from '/B.js';",
      "/B.js": "export default function X() {}",
      "/C.js": "import Y from '/D.js';",
      "/D.js": "export function Y() {}",
    };
    const result = checkImportExportConsistency(files);
    expect(result).toHaveLength(2);
  });

  it("does not report mismatches for external packages", () => {
    const files = {
      "/App.js":
        "import React from 'react'; import { useState } from 'react'; import { X } from '/X.js';",
      "/X.js": "export function X() {}\nexport default X;",
    };
    expect(checkImportExportConsistency(files)).toHaveLength(0);
  });
});
