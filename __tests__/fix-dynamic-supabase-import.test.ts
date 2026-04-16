import { fixDynamicSupabaseImport } from "@/lib/extract-code";

describe("fixDynamicSupabaseImport", () => {
  it("converts dynamic import to static import", () => {
    const files: Record<string, string> = {
      "/Settings.jsx": [
        'import { useState } from "react";',
        "export default function Settings() {",
        "  async function reset() {",
        '    const { supabase } = await import("/supabaseClient.js");',
        '    await supabase.from("DynamicAppData").delete().eq("appId", "123");',
        "  }",
        "  return <button onClick={reset}>Reset</button>;",
        "}",
      ].join("\n"),
    };
    const count = fixDynamicSupabaseImport(files);
    expect(count).toBe(1);
    expect(files["/Settings.jsx"]).toContain('import { supabase } from "/supabaseClient.js"');
    expect(files["/Settings.jsx"]).not.toContain("await import");
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
    fixDynamicSupabaseImport(files);
    const matches = files["/App.jsx"].match(/import.*supabaseClient/g);
    expect(matches).toHaveLength(1);
  });

  it("does nothing when no dynamic import exists", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'import { supabase } from "/supabaseClient.js";\nexport default function App() {}',
    };
    const count = fixDynamicSupabaseImport(files);
    expect(count).toBe(0);
  });

  it("handles single-quoted paths", () => {
    const files: Record<string, string> = {
      "/View.jsx": "const { supabase } = await import('/supabaseClient.js');",
    };
    fixDynamicSupabaseImport(files);
    expect(files["/View.jsx"]).toContain('import { supabase } from "/supabaseClient.js"');
    expect(files["/View.jsx"]).not.toContain("await import");
  });
});
