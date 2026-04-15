import { createPipelineController } from "@/lib/pipeline-controller";
import type {
  PmOutput,
  DecomposerOutput,
  ScaffoldData,
} from "@/lib/types";

// Minimal valid PmOutput for simple path
const simplePm: PmOutput = {
  intent: "Build a todo app",
  features: ["add task", "delete task", "mark complete"],
  persistence: "none",
  modules: [],
  complexity: "simple",
};

// PmOutput that triggers complexity via module count
const complexPmByModules: PmOutput = {
  intent: "Build a complex app",
  features: ["f1", "f2"],
  persistence: "none",
  modules: ["auth", "dashboard", "settings", "profile"],
};

// PmOutput that triggers complexity via feature count
const complexPmByFeatures: PmOutput = {
  intent: "Build a feature-rich app",
  features: ["f1", "f2", "f3", "f4", "f5", "f6"],
  persistence: "none",
  modules: [],
};

// PmOutput explicitly marked complex
const explicitComplexPm: PmOutput = {
  intent: "Build a complex app",
  features: ["f1", "f2"],
  persistence: "none",
  modules: ["auth", "dashboard"],
  complexity: "complex",
};

const decomposerOutput: DecomposerOutput = {
  skeleton: {
    description: "App skeleton",
    files: ["/App.js", "/index.js"],
    sharedTypes: "type ID = string;",
  },
  modules: [
    {
      name: "auth",
      description: "Auth module",
      estimatedFiles: 2,
      deps: [],
      interface: { exports: ["AuthProvider"], consumes: [], stateContract: "" },
    },
    {
      name: "dashboard",
      description: "Dashboard module",
      estimatedFiles: 3,
      deps: ["auth"],
      interface: { exports: ["Dashboard"], consumes: ["AuthProvider"], stateContract: "" },
    },
  ],
  generateOrder: [["auth"], ["dashboard"]],
};

const minimalScaffold: ScaffoldData = {
  files: [{ path: "/App.js", description: "root", exports: ["App"], deps: [], hints: "" }],
  sharedTypes: "",
  designNotes: "",
};

function makeController() {
  const events: Array<{ state: string; message: string }> = [];
  const ctrl = createPipelineController({
    onStateChange: (state, message) => events.push({ state, message }),
  });
  return { ctrl, events };
}

// ─── Test 1: starts in IDLE ───────────────────────────────────────────────────

test("starts in IDLE state", () => {
  const { ctrl } = makeController();
  expect(ctrl.getState()).toBe("IDLE");
});

// ─── Test 2: IDLE → CLASSIFYING on start() ────────────────────────────────────

test("transitions IDLE → CLASSIFYING on start()", () => {
  const { ctrl, events } = makeController();
  ctrl.start("Build me a todo app");
  expect(ctrl.getState()).toBe("CLASSIFYING");
  expect(events.length).toBeGreaterThan(0);
  expect(events[0].state).toBe("CLASSIFYING");
});

// ─── Test 3: Simple path ──────────────────────────────────────────────────────

test("simple path: CLASSIFYING → ARCHITECTING → ENGINEERING → POST_PROCESSING → COMPLETE", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  expect(ctrl.getState()).toBe("CLASSIFYING");

  ctrl.onPmComplete(simplePm);
  expect(ctrl.getState()).toBe("ARCHITECTING");
  expect(ctrl.getComplexity()).toBe("simple");

  ctrl.onArchitectComplete(minimalScaffold);
  expect(ctrl.getState()).toBe("ENGINEERING");

  ctrl.onEngineerComplete({ "/App.js": "code" });
  expect(ctrl.getState()).toBe("POST_PROCESSING");

  ctrl.onPostProcessingComplete({ "/App.js": "final code" });
  expect(ctrl.getState()).toBe("COMPLETE");
  expect(ctrl.getAllFiles()).toEqual({ "/App.js": "final code" });
});

// ─── Test 4: Complex path ─────────────────────────────────────────────────────

test("complex path: CLASSIFYING → DECOMPOSING → SKELETON → MODULE_FILLING → POST_PROCESSING → COMPLETE", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");

  ctrl.onPmComplete(explicitComplexPm);
  expect(ctrl.getState()).toBe("DECOMPOSING");
  expect(ctrl.getComplexity()).toBe("complex");

  ctrl.onDecomposerComplete(decomposerOutput);
  expect(ctrl.getState()).toBe("SKELETON");

  ctrl.onSkeletonComplete({ "/App.js": "skeleton code", "/index.js": "index" });
  expect(ctrl.getState()).toBe("MODULE_FILLING");
  expect(ctrl.getModuleQueue().length).toBeGreaterThan(0);

  // Complete first module
  const firstModule = ctrl.getCurrentModule()!;
  expect(firstModule).toBeTruthy();
  ctrl.onModuleComplete(firstModule, { "/auth/index.js": "auth code" });

  if (ctrl.getModuleQueue().length > 0) {
    expect(ctrl.getState()).toBe("MODULE_FILLING");
    const secondModule = ctrl.getCurrentModule()!;
    ctrl.onModuleComplete(secondModule, { "/dashboard/index.js": "dashboard code" });
  }

  expect(ctrl.getState()).toBe("POST_PROCESSING");

  ctrl.onPostProcessingComplete({ "/App.js": "final", "/index.js": "index", "/auth/index.js": "auth", "/dashboard/index.js": "dashboard" });
  expect(ctrl.getState()).toBe("COMPLETE");
});

// ─── Test 5: Decomposer failure fallback ──────────────────────────────────────

test("DECOMPOSING → ARCHITECTING on decomposer failure", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(explicitComplexPm);
  expect(ctrl.getState()).toBe("DECOMPOSING");

  ctrl.onDecomposerFailed();
  expect(ctrl.getState()).toBe("ARCHITECTING");
});

// ─── Test 6: Module failure skips to next module ──────────────────────────────

test("module failure skips to next module", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(explicitComplexPm);
  ctrl.onDecomposerComplete(decomposerOutput);
  ctrl.onSkeletonComplete({ "/App.js": "skeleton" });

  const firstModule = ctrl.getCurrentModule()!;
  ctrl.onModuleFailed(firstModule, "generation error");

  expect(ctrl.getFailedModules()).toContain(firstModule);
  expect(ctrl.getState()).toBe("MODULE_FILLING"); // still filling, next module queued
  expect(ctrl.getCurrentModule()).toBe("dashboard"); // moved to next
});

// ─── Test 7: All modules failed → POST_PROCESSING ─────────────────────────────

test("all modules failed → goes to POST_PROCESSING", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(explicitComplexPm);
  ctrl.onDecomposerComplete(decomposerOutput);
  ctrl.onSkeletonComplete({ "/App.js": "skeleton" });

  ctrl.onModuleFailed("auth", "error");
  ctrl.onModuleFailed("dashboard", "error");

  expect(ctrl.getState()).toBe("POST_PROCESSING");
  expect(ctrl.getFailedModules()).toEqual(["auth", "dashboard"]);
  expect(ctrl.getCompletedModules()).toEqual([]);
});

// ─── Test 8: Auto-detect complex when modules.length > 3 ─────────────────────

test("auto-detects complex when modules.length > 3", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(complexPmByModules);
  expect(ctrl.getComplexity()).toBe("complex");
  expect(ctrl.getState()).toBe("DECOMPOSING");
});

// ─── Test 9: Auto-detect complex when features.length > 5 ────────────────────

test("auto-detects complex when features.length > 5", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(complexPmByFeatures);
  expect(ctrl.getComplexity()).toBe("complex");
  expect(ctrl.getState()).toBe("DECOMPOSING");
});

// ─── Test 10: Error from any state ────────────────────────────────────────────

test("onError() transitions to ERROR from any state", () => {
  const states = ["CLASSIFYING", "ARCHITECTING", "ENGINEERING", "DECOMPOSING"] as const;

  // Test from CLASSIFYING
  {
    const { ctrl } = makeController();
    ctrl.start("prompt");
    ctrl.onError("something went wrong");
    expect(ctrl.getState()).toBe("ERROR");
  }

  // Test from ARCHITECTING
  {
    const { ctrl } = makeController();
    ctrl.start("prompt");
    ctrl.onPmComplete(simplePm);
    ctrl.onError("architect failed");
    expect(ctrl.getState()).toBe("ERROR");
  }

  // Test from DECOMPOSING
  {
    const { ctrl } = makeController();
    ctrl.start("prompt");
    ctrl.onPmComplete(explicitComplexPm);
    ctrl.onError("decomposer error");
    expect(ctrl.getState()).toBe("ERROR");
  }

  // Test from MODULE_FILLING
  {
    const { ctrl } = makeController();
    ctrl.start("prompt");
    ctrl.onPmComplete(explicitComplexPm);
    ctrl.onDecomposerComplete(decomposerOutput);
    ctrl.onSkeletonComplete({ "/App.js": "skeleton" });
    ctrl.onError("module fill error");
    expect(ctrl.getState()).toBe("ERROR");
  }
});

// ─── Additional: getters return correct initial values ────────────────────────

test("initial getter values", () => {
  const { ctrl } = makeController();
  expect(ctrl.getComplexity()).toBeNull();
  expect(ctrl.getPmOutput()).toBeNull();
  expect(ctrl.getDecomposerOutput()).toBeNull();
  expect(ctrl.getCurrentModule()).toBeNull();
  expect(ctrl.getModuleQueue()).toEqual([]);
  expect(ctrl.getCompletedModules()).toEqual([]);
  expect(ctrl.getFailedModules()).toEqual([]);
  expect(ctrl.getAllFiles()).toEqual({});
});

// ─── Additional: files accumulate across modules ──────────────────────────────

test("files accumulate across module completions", () => {
  const { ctrl } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(explicitComplexPm);
  ctrl.onDecomposerComplete(decomposerOutput);
  ctrl.onSkeletonComplete({ "/App.js": "skeleton" });

  ctrl.onModuleComplete("auth", { "/auth/index.js": "auth" });
  ctrl.onModuleComplete("dashboard", { "/dashboard/index.js": "dash" });

  const files = ctrl.getAllFiles();
  expect(files["/App.js"]).toBe("skeleton");
  expect(files["/auth/index.js"]).toBe("auth");
  expect(files["/dashboard/index.js"]).toBe("dash");
});

// ─── Additional: onStateChange callback fires on each transition ──────────────

test("onStateChange callback fires on transitions", () => {
  const { ctrl, events } = makeController();
  ctrl.start("prompt");
  ctrl.onPmComplete(simplePm);
  ctrl.onArchitectComplete(minimalScaffold);
  ctrl.onEngineerComplete({ "/App.js": "code" });
  ctrl.onPostProcessingComplete({ "/App.js": "final" });

  const states = events.map((e) => e.state);
  expect(states).toContain("CLASSIFYING");
  expect(states).toContain("ARCHITECTING");
  expect(states).toContain("ENGINEERING");
  expect(states).toContain("POST_PROCESSING");
  expect(states).toContain("COMPLETE");
});
