/**
 * TDD tests for extractReactCode utility
 *
 * Engineer agent must output pure React code (no markdown fences per PRD).
 * This utility handles the fallback case where fences slip through.
 */

import { extractReactCode, extractMultiFileCode, findMissingLocalImports } from "@/lib/extract-code";

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
