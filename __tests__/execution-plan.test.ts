import {
  createExecutionPlan,
  planNext,
  planComplete,
  planSkipCascade,
  planSummary,
} from "@/lib/execution-plan";
import { createInterfaceRegistry } from "@/lib/interface-registry";
import type { DecomposerOutput } from "@/lib/types";

const TEST_OUTPUT: DecomposerOutput = {
  skeleton: { description: "skel", files: ["/App.js"], sharedTypes: "" },
  modules: [
    {
      name: "auth", description: "auth", estimatedFiles: 2, deps: [],
      interface: { exports: ["User", "login"], consumes: [], stateContract: "" },
    },
    {
      name: "ui", description: "ui components", estimatedFiles: 3, deps: ["auth"],
      interface: { exports: ["Button"], consumes: ["User"], stateContract: "" },
    },
    {
      name: "api", description: "api layer", estimatedFiles: 2, deps: ["auth"],
      interface: { exports: ["fetchData"], consumes: ["login"], stateContract: "" },
    },
  ],
  generateOrder: [["auth"], ["ui", "api"]],
};

describe("createExecutionPlan", () => {
  it("EP-01: initializes with all modules pending", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    expect(plan.pending).toEqual(["auth", "ui", "api"]);
    expect(plan.completed).toEqual([]);
    expect(plan.failed).toEqual([]);
    expect(plan.executing).toBeNull();
  });

  it("EP-02: preserves original DecomposerOutput", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    expect(plan.original).toBe(TEST_OUTPUT);
  });
});

describe("planNext", () => {
  it("EP-03: returns first module with no unmet deps", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const next = planNext(plan, registry);
    expect(next).toBe("auth");
  });

  it("EP-04: returns null when all pending have unmet deps", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    plan.pending = ["ui", "api"];
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const next = planNext(plan, registry);
    expect(next).toBeNull();
  });

  it("EP-05: after completing auth, ui and api become available", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    planNext(plan, registry);
    planComplete(plan, "auth");
    registry.markCompleted("auth");
    const next = planNext(plan, registry);
    expect(["ui", "api"]).toContain(next);
  });
});

describe("planComplete", () => {
  it("EP-06: moves module from pending to completed", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    planComplete(plan, "auth");
    expect(plan.pending).not.toContain("auth");
    expect(plan.completed).toContain("auth");
    expect(plan.executing).toBeNull();
  });
});

describe("planSkipCascade", () => {
  it("EP-07: skips module and its downstream dependents", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const cascaded = planSkipCascade(plan, "ui", "auth failed");
    expect(plan.skipped.map((s) => s.name)).toContain("ui");
    expect(plan.pending).not.toContain("ui");
  });
});

describe("planSummary", () => {
  it("EP-08: returns correct summary", () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    planComplete(plan, "auth");
    const summary = planSummary(plan);
    expect(summary.completed).toContain("auth");
    expect(summary.failed).toEqual([]);
  });
});
