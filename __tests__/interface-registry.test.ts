import { createInterfaceRegistry } from "@/lib/interface-registry";
import type { DecomposerOutput } from "@/lib/types";

const TEST_OUTPUT: DecomposerOutput = {
  skeleton: { description: "skel", files: ["/App.js"], sharedTypes: "" },
  modules: [
    {
      name: "auth",
      description: "auth module",
      estimatedFiles: 2,
      deps: [],
      interface: {
        exports: ["User", "login", "AuthProvider"],
        consumes: [],
        stateContract: "AuthContext",
      },
    },
    {
      name: "dashboard",
      description: "dashboard module",
      estimatedFiles: 3,
      deps: ["auth"],
      interface: {
        exports: ["DashboardView"],
        consumes: ["User", "login"],
        stateContract: "",
      },
    },
  ],
  generateOrder: [["auth"], ["dashboard"]],
};

describe("createInterfaceRegistry", () => {
  it("IR-01: initializes all modules as pending", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    expect(registry.getStatus("auth")).toBe("pending");
    expect(registry.getStatus("dashboard")).toBe("pending");
  });

  it("IR-02: getContract returns declared exports", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const contract = registry.getContract("auth");
    expect(contract.declared.exports).toEqual(["User", "login", "AuthProvider"]);
    expect(contract.actual).toBeNull();
  });

  it("IR-03: registerActual extracts exports from code", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.registerActual("auth", {
      "/auth/types.ts": "export interface User { id: string; }",
      "/auth/context.tsx": "export function login() {}\nexport function AuthProvider() {}",
    });
    const exports = registry.getActualExports("auth");
    expect(exports.map((e) => e.name).sort()).toEqual(["AuthProvider", "User", "login"]);
  });

  it("IR-04: verifyContract — all declared exports present → satisfied", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.registerActual("auth", {
      "/auth/types.ts": "export interface User { id: string; }",
      "/auth/context.tsx": "export function login() {}\nexport function AuthProvider() {}",
    });
    const result = registry.verifyContract("auth");
    expect(result.satisfied).toBe(true);
    expect(result.missingExports).toEqual([]);
  });

  it("IR-05: verifyContract — missing export detected", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.registerActual("auth", {
      "/auth/types.ts": "export interface User { id: string; }",
    });
    const result = registry.verifyContract("auth");
    expect(result.satisfied).toBe(false);
    expect(result.missingExports.sort()).toEqual(["AuthProvider", "login"]);
  });

  it("IR-06: verifyContract — extra exports reported but still satisfied", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.registerActual("auth", {
      "/auth/index.ts":
        "export interface User {}\nexport function login() {}\nexport function AuthProvider() {}\nexport function extra() {}",
    });
    const result = registry.verifyContract("auth");
    expect(result.satisfied).toBe(true);
    expect(result.extraExports).toEqual(["extra"]);
  });

  it("IR-07: markCompleted changes status", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.markCompleted("auth");
    expect(registry.getStatus("auth")).toBe("completed");
  });

  it("IR-08: markFailed records reason", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.markFailed("auth", "timeout");
    expect(registry.getStatus("auth")).toBe("failed");
    expect(registry.getContract("auth").failureReason).toBe("timeout");
  });

  it("IR-09: markDegraded records stubbed exports", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.markDegraded("auth", ["login"]);
    expect(registry.getStatus("auth")).toBe("degraded");
    expect(registry.getContract("auth").degradedExports).toEqual(["login"]);
  });

  it("IR-10: getConsumers finds downstream modules", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    const consumers = registry.getConsumers("auth", TEST_OUTPUT.modules);
    expect(consumers).toEqual(["dashboard"]);
  });

  it("IR-11: toContextSummary includes module status and exports", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    registry.registerActual("auth", {
      "/auth/index.ts": "export function login() {}\nexport interface User {}\nexport function AuthProvider() {}",
    });
    registry.markCompleted("auth");
    const summary = registry.toContextSummary();
    expect(summary).toContain("auth");
    expect(summary).toContain("completed");
    expect(summary).toContain("login");
    expect(summary).toContain("User");
  });

  it("IR-12: getContract throws for unknown module", () => {
    const registry = createInterfaceRegistry(TEST_OUTPUT);
    expect(() => registry.getContract("nonexistent")).toThrow();
  });
});
