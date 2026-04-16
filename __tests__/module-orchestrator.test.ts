import { createModuleOrchestrator } from "@/lib/module-orchestrator";
import { createExecutionPlan } from "@/lib/execution-plan";
import { createInterfaceRegistry } from "@/lib/interface-registry";
import type { DecomposerOutput, ModuleDefinition } from "@/lib/types";

const TEST_OUTPUT: DecomposerOutput = {
  skeleton: { description: "skel", files: ["/App.js"], sharedTypes: "" },
  modules: [
    {
      name: "auth", description: "auth", estimatedFiles: 2, deps: [],
      interface: { exports: ["User", "login"], consumes: [], stateContract: "" },
    },
    {
      name: "ui", description: "ui", estimatedFiles: 3, deps: ["auth"],
      interface: { exports: ["Button"], consumes: ["User"], stateContract: "" },
    },
  ],
  generateOrder: [["auth"], ["ui"]],
};

function makeCallbacks(overrides: Partial<Record<string, unknown>> = {}) {
  const log: string[] = [];
  return {
    log,
    callbacks: {
      executeModule: overrides.executeModule ?? (async (mod: ModuleDefinition) => {
        log.push(`execute:${mod.name}`);
        if (mod.name === "auth") {
          return {
            "/auth/types.ts": "export interface User { id: string; }",
            "/auth/index.ts": "export function login() {}",
          };
        }
        return { "/ui/Button.tsx": "export function Button() {}" };
      }),
      onModuleComplete: (name: string) => { log.push(`complete:${name}`); },
      onModuleFailed: (name: string, reason: string) => { log.push(`failed:${name}:${reason}`); },
      onModuleSkipped: (name: string) => { log.push(`skipped:${name}`); },
      onPlanRevised: () => { log.push("revised"); },
      onProgress: () => {},
      patchMissingExports: async () => null,
      generateStub: (name: string, exports: readonly string[]) => {
        const code = exports.map((e) => `export const ${e} = {};`).join("\n");
        return { [`/${name}/index.js`]: code };
      },
      signal: new AbortController().signal,
    },
  };
}

describe("createModuleOrchestrator", () => {
  it("MO-01: happy path — executes all modules in order", async () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const { log, callbacks } = makeCallbacks();

    const orch = createModuleOrchestrator(plan, registry, callbacks as never);
    const result = await orch.run();

    expect(log).toContain("execute:auth");
    expect(log).toContain("complete:auth");
    expect(log).toContain("execute:ui");
    expect(log).toContain("complete:ui");
    expect(log.indexOf("execute:auth")).toBeLessThan(log.indexOf("execute:ui"));
    expect(Object.keys(result.files).length).toBeGreaterThan(0);
  });

  it("MO-02: module failure triggers skip cascade for heavy dependents", async () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const { log, callbacks } = makeCallbacks({
      executeModule: async (mod: ModuleDefinition) => {
        if (mod.name === "auth") throw new Error("timeout");
        return { "/ui/Button.tsx": "export function Button() {}" };
      },
    });

    const orch = createModuleOrchestrator(plan, registry, callbacks as never);
    await orch.run();

    expect(log).toContain("failed:auth:timeout");
    // ui depends on auth with ratio 1.0 (User is 100% of its consumes) → skip
    expect(log).toContain("skipped:ui");
  });

  it("MO-03: contract verification — missing exports triggers degraded", async () => {
    const plan = createExecutionPlan(TEST_OUTPUT);
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const { log, callbacks } = makeCallbacks({
      executeModule: async (mod: ModuleDefinition) => {
        if (mod.name === "auth") {
          // Only exports User, missing login (1 missing ≤ 2 → degrade, not fail)
          return { "/auth/types.ts": "export interface User {}" };
        }
        return { "/ui/Button.tsx": "export function Button() {}" };
      },
    });

    const orch = createModuleOrchestrator(plan, registry, callbacks as never);
    await orch.run();

    // auth should be degraded (missing login, ≤ 2 missing)
    expect(registry.getStatus("auth")).toBe("degraded");
    // ui should still execute since auth is degraded (not failed)
    expect(log).toContain("complete:ui");
  });
});
