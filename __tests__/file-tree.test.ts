import { buildFileTree } from "@/lib/file-tree";
import type { TreeNode } from "@/lib/file-tree";

describe("buildFileTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("returns flat file nodes for root-level files", () => {
    const result = buildFileTree(["/App.js", "/index.css"]);
    expect(result).toEqual([
      { kind: "file", name: "App.js", path: "/App.js" },
      { kind: "file", name: "index.css", path: "/index.css" },
    ]);
  });

  it("App.js sorts first among root-level files", () => {
    const result = buildFileTree(["/index.css", "/App.js", "/utils.js"]);
    expect(result[0]).toEqual({ kind: "file", name: "App.js", path: "/App.js" });
  });

  it("groups files under directory nodes", () => {
    const result = buildFileTree(["/components/Button.js", "/App.js"]);
    const dir = result.find((n): n is Extract<TreeNode, { kind: "dir" }> => n.kind === "dir" && n.name === "components");
    expect(dir).toBeDefined();
    expect(dir!.children).toEqual([
      { kind: "file", name: "Button.js", path: "/components/Button.js" },
    ]);
  });

  it("directories sort before files at each level", () => {
    const result = buildFileTree(["/App.js", "/components/Button.js"]);
    expect(result[0].kind).toBe("dir");
    expect(result[1].kind).toBe("file");
  });

  it("handles deeply nested paths", () => {
    const result = buildFileTree(["/a/b/c/Deep.js"]);
    const a = result.find((n) => n.kind === "dir" && n.name === "a") as Extract<TreeNode, { kind: "dir" }>;
    const b = a.children.find((n) => n.kind === "dir" && n.name === "b") as Extract<TreeNode, { kind: "dir" }>;
    const c = b.children.find((n) => n.kind === "dir" && n.name === "c") as Extract<TreeNode, { kind: "dir" }>;
    expect(c.children).toEqual([
      { kind: "file", name: "Deep.js", path: "/a/b/c/Deep.js" },
    ]);
  });

  it("merges multiple files in the same directory", () => {
    const result = buildFileTree(["/components/A.js", "/components/B.js"]);
    const dir = result.find((n) => n.kind === "dir" && n.name === "components") as Extract<TreeNode, { kind: "dir" }>;
    expect(dir.children).toHaveLength(2);
    const names = dir.children.map((n) => n.name);
    expect(names).toContain("A.js");
    expect(names).toContain("B.js");
  });
});
