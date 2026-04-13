import { validateScaffold } from "@/lib/validate-scaffold";
import type { ScaffoldData } from "@/lib/types";

function makeScaffold(
  files: Array<{ path: string; deps: string[]; hints?: string }>
): ScaffoldData {
  return {
    files: files.map((f) => ({
      path: f.path,
      description: "test",
      exports: ["default"],
      deps: f.deps,
      hints: f.hints ?? "",
    })),
    sharedTypes: "",
    designNotes: "",
  };
}

describe("validateScaffold", () => {
  describe("Rule 4: self-reference removal", () => {
    it("removes self-referencing dep", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/a.js", "/b.js"] },
        { path: "/b.js", deps: [] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.deps).toEqual(["/b.js"]);
      expect(warnings).toContainEqual(expect.stringContaining("自引用"));
    });

    it("does not modify files without self-reference", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"] },
        { path: "/b.js", deps: [] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      expect(scaffold.files).toEqual(input.files);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("Rule 1: phantom deps removal", () => {
    it("removes dep pointing to non-existent file", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/ghost.js"] },
        { path: "/b.js", deps: [] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.deps).toEqual([]);
      expect(warnings).toContainEqual(expect.stringContaining("幽灵依赖"));
    });

    it("preserves dep pointing to existing file", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"] },
        { path: "/b.js", deps: [] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.deps).toEqual(["/b.js"]);
      expect(warnings).toHaveLength(0);
    });

    it("preserves whitelisted dep /supabaseClient.js", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/supabaseClient.js"] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.deps).toEqual(["/supabaseClient.js"]);
      expect(warnings).toHaveLength(0);
    });
  });
});
