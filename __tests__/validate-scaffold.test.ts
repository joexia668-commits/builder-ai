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

  describe("Rule 2: hints path cleaning", () => {
    it("replaces phantom path in hints with inline note", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: [], hints: "使用 /utils/format.js 格式化" },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.hints).not.toContain("/utils/format.js");
      expect(fileA.hints).toContain("(在当前文件内实现)");
      expect(warnings).toContainEqual(expect.stringContaining("hints 引用了不存在的文件"));
    });

    it("preserves hints referencing existing files", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"], hints: "引用 /b.js 的 helper" },
        { path: "/b.js", deps: [] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.hints).toContain("/b.js");
      expect(warnings).toHaveLength(0);
    });

    it("leaves hints without paths unchanged", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: [], hints: "实现基本 CRUD 功能" },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.hints).toBe("实现基本 CRUD 功能");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("Rule 3: cycle detection & breaking", () => {
    it("breaks direct cycle A↔B using reverse-flow heuristic", () => {
      // /a.js has in-degree 3 (from /c.js, /d.js, /e.js)
      // /b.js has in-degree 1 (from /a.js)
      // cycle: /a.js → /b.js → /a.js
      // reverse-flow edge: /a.js(inDeg=3) → /b.js(inDeg=1), weight=2 ← highest, remove this
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"] },
        { path: "/b.js", deps: ["/a.js"] },
        { path: "/c.js", deps: ["/a.js"] },
        { path: "/d.js", deps: ["/a.js"] },
        { path: "/e.js", deps: ["/a.js"] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      const fileB = scaffold.files.find((f) => f.path === "/b.js")!;
      // /a.js is foundational (high in-degree), should not depend on /b.js
      expect(fileA.deps).not.toContain("/b.js");
      // /b.js → /a.js is preserved (high-level depends on base)
      expect(fileB.deps).toContain("/a.js");
      expect(warnings).toContainEqual(expect.stringContaining("断开循环依赖"));
    });

    it("breaks three-node cycle", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"] },
        { path: "/b.js", deps: ["/c.js"] },
        { path: "/c.js", deps: ["/a.js"] },
        { path: "/d.js", deps: ["/a.js"] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      // After breaking, topologicalSort should succeed
      const { topologicalSort } = require("@/lib/topo-sort");
      expect(() => topologicalSort(scaffold.files)).not.toThrow();
      expect(warnings).toContainEqual(expect.stringContaining("断开循环依赖"));
    });

    it("uses deps-length tiebreaker when in-degrees are equal", () => {
      // a→b, b→a — both in-degree 1 (from each other)
      // /a.js has more deps total → it's "higher-level"
      // so /a.js → /b.js should be removed
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js", "/c.js", "/d.js"] },
        { path: "/b.js", deps: ["/a.js"] },
        { path: "/c.js", deps: [] },
        { path: "/d.js", deps: [] },
      ]);
      const { scaffold } = validateScaffold(input);
      const fileA = scaffold.files.find((f) => f.path === "/a.js")!;
      expect(fileA.deps).not.toContain("/b.js");
    });

    it("does not modify acyclic graph", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"] },
        { path: "/b.js", deps: ["/c.js"] },
        { path: "/c.js", deps: [] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      expect(scaffold.files).toEqual(input.files);
      expect(warnings).toHaveLength(0);
    });

    it("resolves multiple independent cycles", () => {
      const input = makeScaffold([
        { path: "/a.js", deps: ["/b.js"] },
        { path: "/b.js", deps: ["/a.js"] },
        { path: "/c.js", deps: ["/d.js"] },
        { path: "/d.js", deps: ["/c.js"] },
      ]);
      const { scaffold, warnings } = validateScaffold(input);
      const { topologicalSort } = require("@/lib/topo-sort");
      expect(() => topologicalSort(scaffold.files)).not.toThrow();
      const cycleWarnings = warnings.filter((w) => w.includes("断开循环依赖"));
      expect(cycleWarnings.length).toBeGreaterThanOrEqual(2);
    });
  });
});
