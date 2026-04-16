import { fixDynamicLocalImports } from "@/lib/extract-code";

describe("fixDynamicLocalImports", () => {
  it("converts destructured dynamic import to static import", () => {
    const files: Record<string, string> = {
      "/Settings.jsx": [
        'import { useState } from "react";',
        "export default function Settings() {",
        "  async function reset() {",
        '    const { supabase } = await import("/supabaseClient.js");',
        '    await supabase.from("DynamicAppData").delete();',
        "  }",
        "  return <button onClick={reset}>Reset</button>;",
        "}",
      ].join("\n"),
    };
    const fixes = fixDynamicLocalImports(files);
    expect(fixes.length).toBeGreaterThan(0);
    expect(files["/Settings.jsx"]).toContain('import { supabase } from "/supabaseClient.js"');
    expect(files["/Settings.jsx"]).not.toContain("await import");
  });

  it("converts module-level dynamic import to namespace import", () => {
    const files: Record<string, string> = {
      "/Shop.jsx": [
        'import { useState } from "react";',
        "export default function Shop() {",
        '  const module = await import("/game/itemData.js");',
        "  const items = module.ITEMS;",
        "}",
      ].join("\n"),
    };
    fixDynamicLocalImports(files);
    expect(files["/Shop.jsx"]).toContain('import * as module from "/game/itemData.js"');
    expect(files["/Shop.jsx"]).not.toContain("await import");
  });

  it("handles multiple dynamic imports in one file", () => {
    const files: Record<string, string> = {
      "/View.jsx": [
        'import { useState } from "react";',
        '  const { supabase } = await import("/supabaseClient.js");',
        '  const { ITEMS } = await import("/game/itemData.js");',
      ].join("\n"),
    };
    fixDynamicLocalImports(files);
    expect(files["/View.jsx"]).toContain('import { supabase } from "/supabaseClient.js"');
    expect(files["/View.jsx"]).toContain('import { ITEMS } from "/game/itemData.js"');
    expect(files["/View.jsx"]).not.toContain("await import");
  });

  it("does not duplicate static import if already present", () => {
    const files: Record<string, string> = {
      "/App.jsx": [
        'import { supabase } from "/supabaseClient.js";',
        "async function reset() {",
        '  const { supabase } = await import("/supabaseClient.js");',
        "}",
      ].join("\n"),
    };
    fixDynamicLocalImports(files);
    const matches = files["/App.jsx"].match(/import.*supabaseClient/g);
    expect(matches).toHaveLength(1);
  });

  it("does nothing when no dynamic import exists", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'import { supabase } from "/supabaseClient.js";\nexport default function App() {}',
    };
    const fixes = fixDynamicLocalImports(files);
    expect(fixes).toHaveLength(0);
  });

  it("handles relative path imports", () => {
    const files: Record<string, string> = {
      "/views/Shop.jsx": 'const { ITEMS } = await import("./data.js");',
    };
    fixDynamicLocalImports(files);
    expect(files["/views/Shop.jsx"]).toContain('import { ITEMS } from "./data.js"');
  });

  it("does not touch npm package dynamic imports", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'const mod = await import("lodash");',
    };
    fixDynamicLocalImports(files);
    expect(files["/App.jsx"]).toContain('await import("lodash")');
  });
});
