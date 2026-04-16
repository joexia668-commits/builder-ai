import { breakModuleCycles, topologicalSortModules } from "@/lib/module-topo-sort";
import type { ModuleDefinition } from "@/lib/types";

function makeMod(name: string, deps: string[] = []): ModuleDefinition {
  return {
    name,
    description: `${name} module`,
    estimatedFiles: 2,
    deps,
    interface: { exports: [], consumes: [], stateContract: "" },
  };
}

describe("topologicalSortModules", () => {
  it("MTS-01: linear chain produces correct layer order", () => {
    const modules = [makeMod("a"), makeMod("b", ["a"]), makeMod("c", ["b"])];
    const order = topologicalSortModules(modules);
    expect(order).toEqual([["a"], ["b"], ["c"]]);
  });

  it("MTS-02: independent modules go in one layer", () => {
    const modules = [makeMod("a"), makeMod("b"), makeMod("c")];
    const order = topologicalSortModules(modules);
    expect(order).toHaveLength(1);
    expect(order[0].sort()).toEqual(["a", "b", "c"]);
  });

  it("MTS-03: diamond dependency", () => {
    const modules = [
      makeMod("a"),
      makeMod("b", ["a"]),
      makeMod("c", ["a"]),
      makeMod("d", ["b", "c"]),
    ];
    const order = topologicalSortModules(modules);
    expect(order[0]).toEqual(["a"]);
    expect(order[1].sort()).toEqual(["b", "c"]);
    expect(order[2]).toEqual(["d"]);
  });

  it("MTS-04: empty modules returns empty array", () => {
    expect(topologicalSortModules([])).toEqual([]);
  });

  it("MTS-05: single module returns single layer", () => {
    const order = topologicalSortModules([makeMod("only")]);
    expect(order).toEqual([["only"]]);
  });

  it("MTS-06: phantom deps in modules are ignored", () => {
    const modules = [makeMod("a", ["nonexistent"]), makeMod("b", ["a"])];
    const order = topologicalSortModules(modules);
    expect(order).toEqual([["a"], ["b"]]);
  });
});

describe("breakModuleCycles", () => {
  it("BMC-01: no cycle returns unchanged modules", () => {
    const modules = [makeMod("a"), makeMod("b", ["a"])];
    const warnings: string[] = [];
    const result = breakModuleCycles(modules, warnings);
    expect(result).toEqual(modules);
    expect(warnings).toHaveLength(0);
  });

  it("BMC-02: simple A→B→A cycle is broken", () => {
    const modules = [makeMod("a", ["b"]), makeMod("b", ["a"])];
    const warnings: string[] = [];
    const result = breakModuleCycles(modules, warnings);
    expect(warnings.length).toBeGreaterThan(0);
    const order = topologicalSortModules(result);
    expect(order.flat().sort()).toEqual(["a", "b"]);
  });

  it("BMC-03: triangle A→B→C→A cycle is broken", () => {
    const modules = [
      makeMod("a", ["c"]),
      makeMod("b", ["a"]),
      makeMod("c", ["b"]),
    ];
    const warnings: string[] = [];
    const result = breakModuleCycles(modules, warnings);
    expect(warnings.length).toBeGreaterThan(0);
    const order = topologicalSortModules(result);
    expect(order.flat().sort()).toEqual(["a", "b", "c"]);
  });

  it("BMC-04: self-referencing dep is removed", () => {
    const modules = [makeMod("a", ["a"])];
    const warnings: string[] = [];
    const result = breakModuleCycles(modules, warnings);
    expect(result[0].deps).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
