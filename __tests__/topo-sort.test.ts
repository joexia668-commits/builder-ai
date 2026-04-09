import { topologicalSort } from "@/lib/topo-sort";

describe("topologicalSort", () => {
  it("returns single layer for files with no deps", () => {
    const files = [
      { path: "/utils/format.js", deps: [] },
      { path: "/hooks/useAuth.js", deps: [] },
    ];
    const layers = topologicalSort(files);
    expect(layers).toEqual([["/utils/format.js", "/hooks/useAuth.js"]]);
  });

  it("sorts files into correct dependency layers", () => {
    const files = [
      { path: "/App.js", deps: ["/components/Header.js"] },
      { path: "/components/Header.js", deps: ["/hooks/useAuth.js"] },
      { path: "/hooks/useAuth.js", deps: [] },
    ];
    const layers = topologicalSort(files);
    expect(layers).toEqual([
      ["/hooks/useAuth.js"],
      ["/components/Header.js"],
      ["/App.js"],
    ]);
  });

  it("groups independent files in the same layer", () => {
    const files = [
      { path: "/App.js", deps: ["/components/A.js", "/components/B.js"] },
      { path: "/components/A.js", deps: ["/hooks/useX.js"] },
      { path: "/components/B.js", deps: ["/hooks/useX.js"] },
      { path: "/hooks/useX.js", deps: [] },
    ];
    const layers = topologicalSort(files);
    expect(layers[0]).toEqual(["/hooks/useX.js"]);
    expect(layers[1]).toEqual(expect.arrayContaining(["/components/A.js", "/components/B.js"]));
    expect(layers[1]).toHaveLength(2);
    expect(layers[2]).toEqual(["/App.js"]);
  });

  it("throws on circular dependency", () => {
    const files = [
      { path: "/a.js", deps: ["/b.js"] },
      { path: "/b.js", deps: ["/a.js"] },
    ];
    expect(() => topologicalSort(files)).toThrow("Circular dependency");
  });

  it("returns empty array for empty input", () => {
    expect(topologicalSort([])).toEqual([]);
  });

  it("ignores deps that point to files not in the list (external deps)", () => {
    const files = [
      { path: "/App.js", deps: ["/supabaseClient.js"] },
    ];
    const layers = topologicalSort(files);
    expect(layers).toEqual([["/App.js"]]);
  });
});
