# Architecture Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade BuilderAI from a small React component generator to a modular pipeline that generates complex apps (multi-page SaaS, playable games) via single user input with progressive delivery.

**Architecture:** A programmatic PipelineController state machine orchestrates 4 agents (PM, Decomposer, Architect, Engineer). Complex projects are auto-decomposed into modules generated sequentially. WebContainer replaces Sandpack for preview. Progressive delivery shows a skeleton in ~30s, then fills modules incrementally via Vite HMR.

**Tech Stack:** Next.js 14, TypeScript, @webcontainer/api, Vite, Phaser.js (game scenes), zustand (generated apps' state management)

**Branch:** `feat/modular-pipeline` — all work here. **NEVER merge to main automatically.** Human approval required.

**Spec:** `docs/superpowers/specs/2026-04-15-architecture-evolution-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `lib/pipeline-controller.ts` | State machine: IDLE → CLASSIFYING → DECOMPOSING → SKELETON → MODULE_FILLING → POST_PROCESSING → COMPLETE. Pure logic, no React. |
| `lib/decomposer.ts` | Decomposer agent: context builder, system prompt, output parser, validation. |
| `lib/container-runtime.ts` | WebContainer lifecycle: boot, mount files, npm install, dev server, teardown. Client-side only. |
| `__tests__/pipeline-controller.test.ts` | Unit tests for state machine transitions and edge cases. |
| `__tests__/decomposer.test.ts` | Unit tests for Decomposer output parsing and validation. |
| `__tests__/container-runtime.test.ts` | Unit tests for file tree conversion and mount logic (WebContainer API mocked). |

### Modified Files

| File | What Changes |
|------|-------------|
| `lib/types.ts` | Add PipelineState, DecomposerOutput, ModuleDefinition, new SSE event types, complexity field on PmOutput |
| `lib/generate-prompts.ts` | Add getDecomposerSystemPrompt(), game-engine engineer prompts, update PM prompt for complexity |
| `lib/agent-context.ts` | Add buildDecomposerContext(), buildModuleArchitectContext(), buildSkeletonArchitectContext() |
| `lib/scene-classifier.ts` | Add game-engine, game-canvas scene types and keywords |
| `lib/scene-rules.ts` | Add Phaser.js and Canvas game rules for architect + engineer |
| `lib/extract-code.ts` | Make checkDisallowedImports() scene-aware: allow phaser for games, recharts for dashboards |
| `lib/intent-classifier.ts` | No change to classifyIntent — complexity is determined by PM output, not intent classifier |
| `app/api/generate/handler.ts` | Add "decomposer" agent routing, new SSE event emission (pipeline_state, skeleton_ready, module_*) |
| `components/workspace/chat-area.tsx` | Replace inline orchestration with PipelineController. Consume new SSE events. |
| `components/preview/preview-frame.tsx` | Replace Sandpack with WebContainer iframe |
| `components/agent/agent-status-bar.tsx` | Add module-level progress (module name, index/total) |
| `components/preview/activity-panel.tsx` | Show module-granularity logs |
| `lib/generation-session.ts` | Add pipelineState, currentModule, moduleProgress fields to GenerationSession |
| `lib/sandpack-config.ts` | Delete (replaced by container-runtime.ts) |

---

## Phase 1: Pipeline Orchestration Refactor

### Task 1: Add New Types to lib/types.ts

**Files:**
- Modify: `lib/types.ts`
- Test: `__tests__/pipeline-controller.test.ts` (created in Task 2, types verified there)

- [ ] **Step 1: Add PipelineState enum and module types**

Add after the existing `Scene` type definition (around line 30):

```typescript
// --- Pipeline Controller types ---

export type PipelineState =
  | "IDLE"
  | "CLASSIFYING"
  | "ARCHITECTING"
  | "ENGINEERING"
  | "DECOMPOSING"
  | "SKELETON"
  | "MODULE_FILLING"
  | "POST_PROCESSING"
  | "COMPLETE"
  | "ERROR";

export interface ModuleInterface {
  readonly exports: string[];
  readonly consumes: string[];
  readonly stateContract: string;
}

export interface ModuleDefinition {
  readonly name: string;
  readonly description: string;
  readonly estimatedFiles: number;
  readonly deps: readonly string[];
  readonly interface: ModuleInterface;
}

export interface SkeletonDefinition {
  readonly description: string;
  readonly files: readonly string[];
  readonly sharedTypes: string;
}

export interface DecomposerOutput {
  readonly skeleton: SkeletonDefinition;
  readonly modules: readonly ModuleDefinition[];
  readonly generateOrder: readonly (readonly string[])[];
}

export type Complexity = "simple" | "complex";
```

- [ ] **Step 2: Extend PmOutput with complexity**

Modify the existing `PmOutput` interface:

```typescript
export interface PmOutput {
  readonly intent: string;
  readonly features: readonly string[];
  readonly persistence: string;
  readonly modules: readonly { readonly name: string; readonly description: string }[];
  readonly dataModel?: readonly { readonly name: string; readonly fields: readonly string[] }[];
  readonly complexity?: Complexity;  // NEW
  readonly gameType?: string;        // NEW: "platformer" | "puzzle" | "shooter" | "card" | "simple2d"
}
```

- [ ] **Step 3: Add new SSE event types**

Extend the existing `SSEEventType` type:

```typescript
export type SSEEventType =
  | "thinking" | "chunk" | "code_chunk" | "code_complete"
  | "files_complete" | "partial_files_complete"
  | "reset" | "done" | "error"
  | "file_start" | "file_chunk" | "file_end"
  // NEW pipeline events
  | "pipeline_state" | "skeleton_ready"
  | "module_start" | "module_complete" | "module_failed";
```

Extend `SSEEvent` interface — add after existing fields:

```typescript
export interface SSEEvent {
  // ... existing fields ...
  state?: PipelineState;           // NEW: for pipeline_state
  module?: string;                 // NEW: for module_start/complete/failed
  index?: number;                  // NEW: module index (0-based)
  total?: number;                  // NEW: total modules
  dependencies?: Record<string, string>; // NEW: for skeleton_ready
  summary?: { total: number; succeeded: number; failed: number }; // NEW: for done
}
```

- [ ] **Step 4: Add AgentRole "decomposer"**

```typescript
export type AgentRole = "pm" | "architect" | "engineer" | "decomposer";
```

Add to AGENTS record:

```typescript
export const AGENTS: Record<AgentRole, Agent> = {
  // ... existing pm, architect, engineer ...
  decomposer: {
    id: "decomposer",
    name: "Decomposer",
    avatar: "🧩",
    role: "decomposer",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    description: "模块拆解器",
  },
};
```

Update AGENT_ORDER:

```typescript
export const AGENT_ORDER: AgentRole[] = ["pm", "decomposer", "architect", "engineer"];
```

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add pipeline controller types, decomposer agent role, and new SSE events"
```

---

### Task 2: Build PipelineController State Machine

**Files:**
- Create: `lib/pipeline-controller.ts`
- Create: `__tests__/pipeline-controller.test.ts`

- [ ] **Step 1: Write failing tests for state machine transitions**

```typescript
// __tests__/pipeline-controller.test.ts
import {
  createPipelineController,
  type PipelineController,
} from "@/lib/pipeline-controller";
import type { PmOutput, DecomposerOutput, ScaffoldData } from "@/lib/types";

describe("PipelineController", () => {
  let ctrl: PipelineController;
  const onStateChange = jest.fn();

  beforeEach(() => {
    ctrl = createPipelineController({ onStateChange });
    onStateChange.mockClear();
  });

  it("starts in IDLE state", () => {
    expect(ctrl.getState()).toBe("IDLE");
  });

  it("transitions IDLE → CLASSIFYING on start", () => {
    ctrl.start("build a todo app");
    expect(ctrl.getState()).toBe("CLASSIFYING");
    expect(onStateChange).toHaveBeenCalledWith("CLASSIFYING", "正在分析需求...");
  });

  describe("simple path", () => {
    beforeEach(() => ctrl.start("build a todo app"));

    it("transitions CLASSIFYING → ARCHITECTING on simple PM result", () => {
      const pm: PmOutput = {
        intent: "todo app",
        features: ["add", "delete", "toggle"],
        persistence: "localStorage",
        modules: [{ name: "todo", description: "todo list" }],
        complexity: "simple",
      };
      ctrl.onPmComplete(pm);
      expect(ctrl.getState()).toBe("ARCHITECTING");
    });

    it("transitions ARCHITECTING → ENGINEERING on scaffold", () => {
      const pm: PmOutput = {
        intent: "todo",
        features: ["add"],
        persistence: "none",
        modules: [{ name: "todo", description: "list" }],
        complexity: "simple",
      };
      ctrl.onPmComplete(pm);
      ctrl.onArchitectComplete({} as ScaffoldData);
      expect(ctrl.getState()).toBe("ENGINEERING");
    });

    it("transitions ENGINEERING → POST_PROCESSING → COMPLETE", () => {
      const pm: PmOutput = {
        intent: "todo",
        features: ["add"],
        persistence: "none",
        modules: [{ name: "todo", description: "list" }],
        complexity: "simple",
      };
      ctrl.onPmComplete(pm);
      ctrl.onArchitectComplete({} as ScaffoldData);
      ctrl.onEngineerComplete({ "/App.js": "code" });
      expect(ctrl.getState()).toBe("POST_PROCESSING");
      ctrl.onPostProcessingComplete({ "/App.js": "code" });
      expect(ctrl.getState()).toBe("COMPLETE");
    });
  });

  describe("complex path", () => {
    const complexPm: PmOutput = {
      intent: "ecommerce admin",
      features: ["products", "orders", "dashboard", "users", "settings", "analytics"],
      persistence: "supabase",
      modules: [
        { name: "products", description: "product management" },
        { name: "orders", description: "order list" },
        { name: "dashboard", description: "data dashboard" },
        { name: "users", description: "user management" },
      ],
      complexity: "complex",
    };

    beforeEach(() => ctrl.start("build ecommerce admin"));

    it("transitions CLASSIFYING → DECOMPOSING on complex PM result", () => {
      ctrl.onPmComplete(complexPm);
      expect(ctrl.getState()).toBe("DECOMPOSING");
    });

    it("transitions DECOMPOSING → SKELETON on decomposer output", () => {
      ctrl.onPmComplete(complexPm);
      const decomposed: DecomposerOutput = {
        skeleton: { description: "app shell", files: ["/App.js"], sharedTypes: "" },
        modules: [
          { name: "products", description: "...", estimatedFiles: 4, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        ],
        generateOrder: [["products"]],
      };
      ctrl.onDecomposerComplete(decomposed);
      expect(ctrl.getState()).toBe("SKELETON");
    });

    it("transitions SKELETON → MODULE_FILLING → POST_PROCESSING → COMPLETE", () => {
      ctrl.onPmComplete(complexPm);
      const decomposed: DecomposerOutput = {
        skeleton: { description: "shell", files: ["/App.js"], sharedTypes: "" },
        modules: [
          { name: "products", description: "...", estimatedFiles: 3, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
          { name: "orders", description: "...", estimatedFiles: 3, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        ],
        generateOrder: [["products", "orders"]],
      };
      ctrl.onDecomposerComplete(decomposed);

      ctrl.onSkeletonComplete({ "/App.js": "code" });
      expect(ctrl.getState()).toBe("MODULE_FILLING");
      expect(ctrl.getCurrentModule()).toBe("products");

      ctrl.onModuleComplete("products", { "/ProductList.js": "code" });
      expect(ctrl.getCurrentModule()).toBe("orders");

      ctrl.onModuleComplete("orders", { "/OrderTable.js": "code" });
      expect(ctrl.getState()).toBe("POST_PROCESSING");

      ctrl.onPostProcessingComplete({});
      expect(ctrl.getState()).toBe("COMPLETE");
    });
  });

  describe("error handling", () => {
    it("transitions to ERROR on failure", () => {
      ctrl.start("test");
      ctrl.onError("PM failed");
      expect(ctrl.getState()).toBe("ERROR");
    });

    it("Decomposer failure falls back to simple path", () => {
      ctrl.start("test");
      const complexPm: PmOutput = {
        intent: "complex",
        features: ["a", "b", "c", "d", "e", "f"],
        persistence: "none",
        modules: [
          { name: "a", description: "" },
          { name: "b", description: "" },
          { name: "c", description: "" },
          { name: "d", description: "" },
        ],
        complexity: "complex",
      };
      ctrl.onPmComplete(complexPm);
      expect(ctrl.getState()).toBe("DECOMPOSING");
      ctrl.onDecomposerFailed();
      expect(ctrl.getState()).toBe("ARCHITECTING");
    });

    it("single module failure skips to next module", () => {
      ctrl.start("test");
      const pm: PmOutput = {
        intent: "complex",
        features: ["a", "b", "c", "d", "e", "f"],
        persistence: "none",
        modules: [{ name: "a", description: "" }, { name: "b", description: "" }, { name: "c", description: "" }, { name: "d", description: "" }],
        complexity: "complex",
      };
      ctrl.onPmComplete(pm);
      const decomposed: DecomposerOutput = {
        skeleton: { description: "", files: ["/App.js"], sharedTypes: "" },
        modules: [
          { name: "mod1", description: "", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
          { name: "mod2", description: "", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        ],
        generateOrder: [["mod1", "mod2"]],
      };
      ctrl.onDecomposerComplete(decomposed);
      ctrl.onSkeletonComplete({ "/App.js": "code" });

      ctrl.onModuleFailed("mod1", "parse_failed");
      expect(ctrl.getCurrentModule()).toBe("mod2");
      expect(ctrl.getState()).toBe("MODULE_FILLING");
    });
  });

  describe("complexity detection", () => {
    it("auto-detects complex when modules > 3", () => {
      ctrl.start("test");
      const pm: PmOutput = {
        intent: "big app",
        features: ["a", "b"],
        persistence: "none",
        modules: [{ name: "a", description: "" }, { name: "b", description: "" }, { name: "c", description: "" }, { name: "d", description: "" }],
        // no explicit complexity — controller should infer
      };
      ctrl.onPmComplete(pm);
      expect(ctrl.getState()).toBe("DECOMPOSING");
    });

    it("auto-detects complex when features > 5", () => {
      ctrl.start("test");
      const pm: PmOutput = {
        intent: "feature-rich",
        features: ["a", "b", "c", "d", "e", "f"],
        persistence: "none",
        modules: [{ name: "main", description: "" }],
      };
      ctrl.onPmComplete(pm);
      expect(ctrl.getState()).toBe("DECOMPOSING");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="pipeline-controller"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PipelineController**

```typescript
// lib/pipeline-controller.ts
import type {
  PipelineState,
  PmOutput,
  DecomposerOutput,
  ModuleDefinition,
  ScaffoldData,
  Complexity,
} from "./types";

export interface PipelineControllerOptions {
  onStateChange: (state: PipelineState, message: string) => void;
}

export interface PipelineController {
  getState(): PipelineState;
  getComplexity(): Complexity | null;
  getPmOutput(): PmOutput | null;
  getDecomposerOutput(): DecomposerOutput | null;
  getCurrentModule(): string | null;
  getModuleQueue(): readonly string[];
  getCompletedModules(): readonly string[];
  getFailedModules(): readonly string[];
  getAllFiles(): Record<string, string>;

  start(prompt: string): void;
  onPmComplete(pm: PmOutput): void;
  onDecomposerComplete(output: DecomposerOutput): void;
  onDecomposerFailed(): void;
  onArchitectComplete(scaffold: ScaffoldData): void;
  onSkeletonComplete(files: Record<string, string>): void;
  onEngineerComplete(files: Record<string, string>): void;
  onModuleComplete(moduleName: string, files: Record<string, string>): void;
  onModuleFailed(moduleName: string, reason: string): void;
  onPostProcessingComplete(files: Record<string, string>): void;
  onError(message: string): void;
}

function resolveComplexity(pm: PmOutput): Complexity {
  if (pm.complexity) return pm.complexity;
  if (pm.modules.length > 3) return "complex";
  if (pm.features.length > 5) return "complex";
  return "simple";
}

function flattenGenerateOrder(order: readonly (readonly string[])[]): string[] {
  const result: string[] = [];
  for (const layer of order) {
    for (const name of layer) {
      result.push(name);
    }
  }
  return result;
}

export function createPipelineController(
  opts: PipelineControllerOptions
): PipelineController {
  let state: PipelineState = "IDLE";
  let complexity: Complexity | null = null;
  let pmOutput: PmOutput | null = null;
  let decomposerOutput: DecomposerOutput | null = null;
  let moduleQueue: string[] = [];
  let completedModules: string[] = [];
  let failedModules: string[] = [];
  let allFiles: Record<string, string> = {};

  function transition(next: PipelineState, message: string) {
    state = next;
    opts.onStateChange(next, message);
  }

  return {
    getState: () => state,
    getComplexity: () => complexity,
    getPmOutput: () => pmOutput,
    getDecomposerOutput: () => decomposerOutput,
    getCurrentModule: () => moduleQueue[0] ?? null,
    getModuleQueue: () => moduleQueue,
    getCompletedModules: () => completedModules,
    getFailedModules: () => failedModules,
    getAllFiles: () => ({ ...allFiles }),

    start(prompt: string) {
      allFiles = {};
      moduleQueue = [];
      completedModules = [];
      failedModules = [];
      pmOutput = null;
      decomposerOutput = null;
      complexity = null;
      transition("CLASSIFYING", "正在分析需求...");
    },

    onPmComplete(pm: PmOutput) {
      pmOutput = pm;
      complexity = resolveComplexity(pm);
      if (complexity === "complex") {
        transition("DECOMPOSING", "正在拆解模块...");
      } else {
        transition("ARCHITECTING", "正在规划架构...");
      }
    },

    onDecomposerComplete(output: DecomposerOutput) {
      decomposerOutput = output;
      moduleQueue = flattenGenerateOrder(output.generateOrder);
      transition("SKELETON", "正在生成应用骨架...");
    },

    onDecomposerFailed() {
      complexity = "simple";
      transition("ARCHITECTING", "模块拆解失败，降级为简单模式...");
    },

    onArchitectComplete(_scaffold: ScaffoldData) {
      transition("ENGINEERING", "正在生成代码...");
    },

    onSkeletonComplete(files: Record<string, string>) {
      Object.assign(allFiles, files);
      if (moduleQueue.length === 0) {
        transition("POST_PROCESSING", "正在检查代码一致性...");
      } else {
        const first = moduleQueue[0];
        transition("MODULE_FILLING", `正在生成模块: ${first}...`);
      }
    },

    onEngineerComplete(files: Record<string, string>) {
      Object.assign(allFiles, files);
      transition("POST_PROCESSING", "正在检查代码一致性...");
    },

    onModuleComplete(moduleName: string, files: Record<string, string>) {
      Object.assign(allFiles, files);
      completedModules.push(moduleName);
      moduleQueue = moduleQueue.filter((m) => m !== moduleName);
      if (moduleQueue.length === 0) {
        transition("POST_PROCESSING", "正在检查代码一致性...");
      } else {
        const next = moduleQueue[0];
        transition("MODULE_FILLING", `正在生成模块: ${next}...`);
      }
    },

    onModuleFailed(moduleName: string, _reason: string) {
      failedModules.push(moduleName);
      moduleQueue = moduleQueue.filter((m) => m !== moduleName);
      if (moduleQueue.length === 0) {
        transition("POST_PROCESSING", "正在检查代码一致性...");
      } else {
        const next = moduleQueue[0];
        transition("MODULE_FILLING", `正在生成模块: ${next}...`);
      }
    },

    onPostProcessingComplete(files: Record<string, string>) {
      Object.assign(allFiles, files);
      transition("COMPLETE", "生成完成");
    },

    onError(message: string) {
      transition("ERROR", message);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="pipeline-controller"`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline-controller.ts __tests__/pipeline-controller.test.ts
git commit -m "feat: add PipelineController state machine with full test coverage"
```

---

### Task 3: Build Decomposer Agent

**Files:**
- Create: `lib/decomposer.ts`
- Create: `__tests__/decomposer.test.ts`
- Modify: `lib/generate-prompts.ts`
- Modify: `lib/agent-context.ts`

- [ ] **Step 1: Write failing tests for Decomposer output parsing**

```typescript
// __tests__/decomposer.test.ts
import { parseDecomposerOutput, validateDecomposerOutput } from "@/lib/decomposer";
import type { DecomposerOutput } from "@/lib/types";

describe("parseDecomposerOutput", () => {
  it("parses valid JSON output", () => {
    const raw = JSON.stringify({
      skeleton: {
        description: "app shell",
        files: ["/App.js", "/types.ts"],
        sharedTypes: "type Product = { id: string; name: string; }",
      },
      modules: [
        {
          name: "product-management",
          description: "product CRUD",
          estimatedFiles: 4,
          deps: [],
          interface: { exports: ["ProductList"], consumes: ["Product"], stateContract: "products: Product[]" },
        },
      ],
      generateOrder: [["product-management"]],
    });
    const result = parseDecomposerOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.skeleton.files).toEqual(["/App.js", "/types.ts"]);
    expect(result!.modules).toHaveLength(1);
    expect(result!.modules[0].name).toBe("product-management");
  });

  it("parses JSON wrapped in markdown fence", () => {
    const raw = "```json\n" + JSON.stringify({
      skeleton: { description: "", files: ["/App.js"], sharedTypes: "" },
      modules: [],
      generateOrder: [],
    }) + "\n```";
    const result = parseDecomposerOutput(raw);
    expect(result).not.toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseDecomposerOutput("not json")).toBeNull();
  });

  it("returns null for missing skeleton", () => {
    const raw = JSON.stringify({ modules: [], generateOrder: [] });
    expect(parseDecomposerOutput(raw)).toBeNull();
  });
});

describe("validateDecomposerOutput", () => {
  const validOutput: DecomposerOutput = {
    skeleton: { description: "shell", files: ["/App.js"], sharedTypes: "" },
    modules: [
      { name: "mod1", description: "first", estimatedFiles: 3, deps: [], interface: { exports: ["A"], consumes: [], stateContract: "" } },
      { name: "mod2", description: "second", estimatedFiles: 4, deps: ["mod1"], interface: { exports: ["B"], consumes: ["A"], stateContract: "" } },
    ],
    generateOrder: [["mod1"], ["mod2"]],
  };

  it("accepts valid output", () => {
    expect(validateDecomposerOutput(validOutput)).toEqual(validOutput);
  });

  it("clamps modules to max 5", () => {
    const tooMany: DecomposerOutput = {
      ...validOutput,
      modules: Array.from({ length: 7 }, (_, i) => ({
        name: `mod${i}`, description: "", estimatedFiles: 2, deps: [],
        interface: { exports: [], consumes: [], stateContract: "" },
      })),
      generateOrder: [Array.from({ length: 7 }, (_, i) => `mod${i}`)],
    };
    const result = validateDecomposerOutput(tooMany);
    expect(result.modules.length).toBeLessThanOrEqual(5);
  });

  it("clamps estimatedFiles to max 8", () => {
    const bigModule: DecomposerOutput = {
      ...validOutput,
      modules: [
        { name: "big", description: "", estimatedFiles: 15, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
      ],
      generateOrder: [["big"]],
    };
    const result = validateDecomposerOutput(bigModule);
    expect(result.modules[0].estimatedFiles).toBe(8);
  });

  it("removes phantom deps from modules", () => {
    const phantomDep: DecomposerOutput = {
      ...validOutput,
      modules: [
        { name: "mod1", description: "", estimatedFiles: 3, deps: ["nonexistent"], interface: { exports: [], consumes: [], stateContract: "" } },
      ],
      generateOrder: [["mod1"]],
    };
    const result = validateDecomposerOutput(phantomDep);
    expect(result.modules[0].deps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="decomposer"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Decomposer module**

```typescript
// lib/decomposer.ts
import type { DecomposerOutput, ModuleDefinition, PmOutput, Scene } from "./types";
import { extractJson } from "./extract-json";

const MAX_MODULES = 5;
const MAX_FILES_PER_MODULE = 8;

export function parseDecomposerOutput(raw: string): DecomposerOutput | null {
  const json = extractJson(raw);
  if (!json) return null;

  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    if (!parsed.skeleton || !Array.isArray(parsed.skeleton.files)) return null;
    if (!Array.isArray(parsed.modules)) return null;
    if (!Array.isArray(parsed.generateOrder)) return null;
    return parsed as DecomposerOutput;
  } catch {
    return null;
  }
}

export function validateDecomposerOutput(output: DecomposerOutput): DecomposerOutput {
  const moduleNames = new Set(output.modules.map((m) => m.name));

  // Clamp modules to MAX_MODULES
  let modules = output.modules.slice(0, MAX_MODULES);

  // Clamp estimatedFiles and remove phantom deps
  modules = modules.map((m) => ({
    ...m,
    estimatedFiles: Math.min(m.estimatedFiles, MAX_FILES_PER_MODULE),
    deps: m.deps.filter((d) => moduleNames.has(d)),
  }));

  const validNames = new Set(modules.map((m) => m.name));

  // Filter generateOrder to only include valid module names
  const generateOrder = output.generateOrder
    .map((layer) => layer.filter((name) => validNames.has(name)))
    .filter((layer) => layer.length > 0);

  return {
    skeleton: output.skeleton,
    modules,
    generateOrder,
  };
}

export function buildDecomposerContext(
  pmOutput: PmOutput,
  existingFiles: string[],
  sceneTypes: Scene[]
): string {
  const parts: string[] = [];

  parts.push("## PM 产品需求文档\n");
  parts.push(`意图: ${pmOutput.intent}`);
  parts.push(`功能: ${pmOutput.features.join(", ")}`);
  parts.push(`持久化: ${pmOutput.persistence}`);
  parts.push(`模块: ${pmOutput.modules.map((m) => `${m.name}(${m.description})`).join(", ")}`);
  if (pmOutput.dataModel?.length) {
    parts.push(`数据模型: ${pmOutput.dataModel.map((d) => `${d.name}{${d.fields.join(",")}}`).join(", ")}`);
  }
  if (pmOutput.gameType) {
    parts.push(`游戏类型: ${pmOutput.gameType}`);
  }

  if (existingFiles.length > 0) {
    parts.push("\n## 已有文件");
    parts.push(existingFiles.join("\n"));
  }

  if (sceneTypes.length > 0 && sceneTypes[0] !== "general") {
    parts.push(`\n## 场景类型: ${sceneTypes.join(", ")}`);
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Add Decomposer system prompt to generate-prompts.ts**

Add this function to `lib/generate-prompts.ts`:

```typescript
export function getDecomposerSystemPrompt(): string {
  return `你是一个项目模块拆解专家。根据 PM 的产品需求文档，将项目拆解为可独立生成的模块。

## 输出格式（严格 JSON）

{
  "skeleton": {
    "description": "骨架描述（路由、布局、共享类型）",
    "files": ["/App.js", "/types.ts", "/Layout.js"],
    "sharedTypes": "完整的 TypeScript 类型定义代码"
  },
  "modules": [
    {
      "name": "模块名（kebab-case）",
      "description": "模块功能描述（50字以内）",
      "estimatedFiles": 3,
      "deps": ["依赖的其他模块名"],
      "interface": {
        "exports": ["导出的组件/函数名"],
        "consumes": ["消费的外部类型/组件"],
        "stateContract": "本模块的状态结构描述"
      }
    }
  ],
  "generateOrder": [["无依赖模块"], ["依赖第一层的模块"]]
}

## 规则

1. 模块数量 ≤ 5，每模块文件数 ≤ 8
2. skeleton 包含真实代码骨架：路由配置、布局组件、共享类型定义
3. 模块间通过 props + shared types 通信，不用事件总线
4. generateOrder 是二维数组：同一层可并行生成，层间串行
5. deps 只能引用同 modules 数组内的其他模块名
6. 每个模块必须是独立可渲染的（挂载到骨架后即可预览）
7. skeleton 的 sharedTypes 包含所有模块共用的类型定义`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="decomposer"`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/decomposer.ts __tests__/decomposer.test.ts lib/generate-prompts.ts
git commit -m "feat: add Decomposer agent with context builder, output parser, and system prompt"
```

---

### Task 4: Add Decomposer to API Handler

**Files:**
- Modify: `app/api/generate/handler.ts`

- [ ] **Step 1: Add decomposer agent routing in createHandler**

In `handler.ts`, find the user content construction section (where PM, Architect, Engineer prompts are built). Add a new branch for decomposer:

```typescript
// After the architect branch, add:
case "decomposer": {
  userContent = `请根据以下产品需求文档拆解项目模块：\n\n${context}`;
  jsonMode = true;
  break;
}
```

In the system prompt section, add:

```typescript
import { getDecomposerSystemPrompt } from "@/lib/generate-prompts";

// In the switch for system prompts:
case "decomposer":
  systemPrompt = getDecomposerSystemPrompt();
  break;
```

In the response extraction section (after streaming completes), add:

```typescript
case "decomposer": {
  // Decomposer returns raw JSON — no extraction needed, client parses it
  emitSSE(writer, { type: "code_complete", code: fullContent });
  break;
}
```

- [ ] **Step 2: Add new SSE event emission helper**

Add a helper function at the top of `handler.ts` for emitting pipeline events:

```typescript
function emitPipelineEvent(
  writer: WritableStreamDefaultWriter,
  event: SSEEvent
) {
  emitSSE(writer, event);
}
```

This is used by chat-area.tsx when it needs to relay pipeline state changes through the SSE stream. The handler itself doesn't emit pipeline_state events — those come from the client-side PipelineController.

- [ ] **Step 3: Commit**

```bash
git add app/api/generate/handler.ts
git commit -m "feat: add decomposer agent routing to SSE handler"
```

---

### Task 5: Update PM Prompt for Complexity Detection

**Files:**
- Modify: `lib/generate-prompts.ts`

- [ ] **Step 1: Update PM system prompt to output complexity and gameType**

Find the PM system prompt in `getSystemPrompt()` (the case for `agent === "pm"`). Add these fields to the output format specification:

```typescript
// In the PM prompt JSON output format section, add after dataModel:
// "complexity": "simple 或 complex（modules > 3 或 features > 5 时为 complex）",
// "gameType": "如果是游戏项目: platformer | puzzle | shooter | card | simple2d，否则省略"
```

The PM prompt instructs the LLM to self-evaluate complexity. The PipelineController also independently verifies this (Task 2's `resolveComplexity`), so even if the LLM gets it wrong, the controller catches it.

- [ ] **Step 2: Commit**

```bash
git add lib/generate-prompts.ts
git commit -m "feat: update PM prompt to output complexity and gameType fields"
```

---

### Task 6: Extend GenerationSession for Pipeline State

**Files:**
- Modify: `lib/generation-session.ts`

- [ ] **Step 1: Add pipeline fields to GenerationSession**

Add to the `GenerationSession` interface:

```typescript
export interface GenerationSession {
  // ... existing fields ...
  pipelineState: PipelineState;         // NEW
  currentModule: string | null;          // NEW
  moduleProgress: {                      // NEW
    total: number;
    completed: string[];
    failed: string[];
    current: string | null;
  } | null;
}
```

Update `EMPTY_SESSION` default:

```typescript
export const EMPTY_SESSION: GenerationSession = {
  // ... existing defaults ...
  pipelineState: "IDLE",
  currentModule: null,
  moduleProgress: null,
};
```

Update `resetSession()` to reset these fields.

- [ ] **Step 2: Commit**

```bash
git add lib/generation-session.ts
git commit -m "feat: add pipeline state and module progress to GenerationSession"
```

---

### Task 7: Integrate PipelineController into chat-area.tsx

**Files:**
- Modify: `components/workspace/chat-area.tsx`

This is the largest task. The goal is to replace the inline orchestration in `handleSendMessage` with PipelineController, while keeping the existing simple/direct paths working.

- [ ] **Step 1: Import PipelineController and create instance**

At the top of chat-area.tsx, add:

```typescript
import { createPipelineController } from "@/lib/pipeline-controller";
import { parseDecomposerOutput, validateDecomposerOutput, buildDecomposerContext } from "@/lib/decomposer";
```

Inside the component, create the controller in a ref:

```typescript
const pipelineRef = useRef<ReturnType<typeof createPipelineController> | null>(null);
```

- [ ] **Step 2: Refactor handleSendMessage — CLASSIFYING phase**

In the existing `handleSendMessage`, after intent classification and before the PM call, initialize the pipeline:

```typescript
// After classifyIntent() call:
const pipeline = createPipelineController({
  onStateChange: (state, message) => {
    updateSession(projectId, {
      pipelineState: state,
      transitionText: message,
    });
  },
});
pipelineRef.current = pipeline;
pipeline.start(prompt);
```

The PM call remains the same. After PM completes and `extractPmOutput()` succeeds, feed it to the pipeline:

```typescript
// After extractPmOutput() succeeds:
pipeline.onPmComplete(parsedPm);
const complexity = pipeline.getComplexity();
```

- [ ] **Step 3: Add DECOMPOSING branch after PM**

After `pipeline.onPmComplete(parsedPm)`, add the new complex path:

```typescript
if (complexity === "complex") {
  // --- DECOMPOSING ---
  const decomposerContext = buildDecomposerContext(
    parsedPm,
    Object.keys(currentFiles),
    scenes
  );

  const decomposerResponse = await fetchSSE("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: "decomposer",
      prompt: prompt,
      context: decomposerContext,
      projectId,
      modelId: selectedModel,
    }),
    signal: abortController.signal,
  });

  // Read full SSE response
  const decomposerRaw = await readFullSSEResponse(decomposerResponse);
  const decomposed = parseDecomposerOutput(decomposerRaw);

  if (!decomposed) {
    // Fallback to simple path
    pipeline.onDecomposerFailed();
  } else {
    const validated = validateDecomposerOutput(decomposed);
    pipeline.onDecomposerComplete(validated);

    // --- SKELETON ---
    // Build skeleton architect context using only skeleton files
    // Call Architect with skeleton-only scope
    // Call Engineer for skeleton files
    // pipeline.onSkeletonComplete(skeletonFiles)

    // --- MODULE_FILLING ---
    // Loop through moduleQueue
    for (const moduleName of pipeline.getModuleQueue()) {
      try {
        updateSession(projectId, {
          currentModule: moduleName,
          moduleProgress: {
            total: validated.modules.length,
            completed: [...pipeline.getCompletedModules()],
            failed: [...pipeline.getFailedModules()],
            current: moduleName,
          },
        });

        // Call Architect for this module
        // Call Engineer for this module's files
        // pipeline.onModuleComplete(moduleName, moduleFiles)
      } catch (err) {
        pipeline.onModuleFailed(moduleName, String(err));
      }
    }
  }
}
// else: existing simple path continues unchanged
```

Note: The skeleton and module Architect/Engineer calls reuse the same `fetchSSE` + `readEngineerSSE` + `runLayerWithFallback` patterns already in chat-area.tsx. The key difference is scope — each call receives only the relevant module's files, not the entire project.

- [ ] **Step 4: Add module-scoped Architect context builder**

Add to `lib/agent-context.ts`:

```typescript
export function buildModuleArchitectContext(
  pmOutput: PmOutput,
  module: ModuleDefinition,
  skeletonFiles: Record<string, string>,
  completedModuleFiles: Record<string, string>,
  sceneTypes: Scene[]
): string {
  const parts: string[] = [];

  parts.push("## 项目 PRD（摘要）");
  parts.push(`意图: ${pmOutput.intent}`);
  parts.push(`持久化: ${pmOutput.persistence}`);

  parts.push("\n## 当前模块");
  parts.push(`名称: ${module.name}`);
  parts.push(`描述: ${module.description}`);
  parts.push(`预计文件数: ${module.estimatedFiles}`);
  parts.push(`导出: ${module.interface.exports.join(", ")}`);
  parts.push(`消费: ${module.interface.consumes.join(", ")}`);
  parts.push(`状态契约: ${module.interface.stateContract}`);

  parts.push("\n## 骨架文件（已完成）");
  for (const [path, code] of Object.entries(skeletonFiles)) {
    parts.push(`// === ${path} ===\n${code}`);
  }

  if (Object.keys(completedModuleFiles).length > 0) {
    parts.push("\n## 已完成模块的导出签名");
    for (const [path, code] of Object.entries(completedModuleFiles)) {
      // Only include export signatures, not full code
      const exports = code.match(/^export\s+.+$/gm);
      if (exports) {
        parts.push(`// ${path}: ${exports.join("; ")}`);
      }
    }
  }

  return parts.join("\n");
}

export function buildSkeletonArchitectContext(
  pmOutput: PmOutput,
  skeleton: SkeletonDefinition,
  existingFiles: Record<string, string>,
  sceneTypes: Scene[]
): string {
  const parts: string[] = [];

  parts.push("## 项目 PRD");
  parts.push(`意图: ${pmOutput.intent}`);
  parts.push(`功能: ${pmOutput.features.join(", ")}`);
  parts.push(`持久化: ${pmOutput.persistence}`);

  parts.push("\n## 骨架要求");
  parts.push(`描述: ${skeleton.description}`);
  parts.push(`文件: ${skeleton.files.join(", ")}`);
  parts.push(`共享类型:\n${skeleton.sharedTypes}`);

  parts.push("\n## 注意");
  parts.push("只生成骨架文件，功能模块留空（用 placeholder 组件）");

  return parts.join("\n");
}
```

- [ ] **Step 5: Verify simple path still works**

Run: `npm run dev:clean`
Test: Create a simple project (e.g., "做一个计算器") — should work exactly as before.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/chat-area.tsx lib/agent-context.ts
git commit -m "feat: integrate PipelineController into chat-area with Decomposer and module-filling loop"
```

---

### Task 8: Update Agent Status Bar for Module Progress

**Files:**
- Modify: `components/agent/agent-status-bar.tsx`
- Modify: `components/preview/activity-panel.tsx`

- [ ] **Step 1: Add module progress display to agent-status-bar.tsx**

After the existing engineer progress section, add module progress:

```typescript
// Inside the engineer card section, after the existing layer progress:
{session.moduleProgress && (
  <div className="mt-1 text-xs text-zinc-400">
    <span>模块 {session.moduleProgress.completed.length + 1}/{session.moduleProgress.total}</span>
    {session.currentModule && (
      <span className="ml-2 text-violet-400">{session.currentModule}</span>
    )}
  </div>
)}
```

- [ ] **Step 2: Add pipeline state indicator**

Add a pipeline state badge above the agent cards when in complex mode:

```typescript
{session.pipelineState && session.pipelineState !== "IDLE" && (
  <div className="mb-2 text-xs text-zinc-400">
    {session.transitionText}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add components/agent/agent-status-bar.tsx components/preview/activity-panel.tsx
git commit -m "feat: add module progress display to agent status bar and activity panel"
```

---

## Phase 2: WebContainer Integration

### Task 9: Install WebContainer API

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @webcontainer/api**

```bash
npm install @webcontainer/api
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @webcontainer/api dependency"
```

---

### Task 10: Build Container Runtime

**Files:**
- Create: `lib/container-runtime.ts`
- Create: `__tests__/container-runtime.test.ts`

- [ ] **Step 1: Write failing tests for file tree conversion**

```typescript
// __tests__/container-runtime.test.ts
import { filesToWebContainerTree, createViteConfig, createPackageJson } from "@/lib/container-runtime";

describe("filesToWebContainerTree", () => {
  it("converts flat file map to WebContainer directory tree", () => {
    const files = {
      "/App.js": "export default function App() { return <div/>; }",
      "/components/Header.js": "export function Header() { return <h1/>; }",
      "/types.ts": "export type User = { id: string };",
    };
    const tree = filesToWebContainerTree(files);

    expect(tree["App.js"]).toEqual({
      file: { contents: files["/App.js"] },
    });
    expect(tree["components"]).toBeDefined();
    expect((tree["components"] as any).directory["Header.js"]).toEqual({
      file: { contents: files["/components/Header.js"] },
    });
  });

  it("handles deeply nested paths", () => {
    const files = {
      "/a/b/c/deep.js": "export const x = 1;",
    };
    const tree = filesToWebContainerTree(files);
    expect((tree["a"] as any).directory["b"].directory["c"].directory["deep.js"]).toBeDefined();
  });
});

describe("createPackageJson", () => {
  it("includes base React dependencies", () => {
    const pkg = createPackageJson({});
    const parsed = JSON.parse(pkg);
    expect(parsed.dependencies.react).toBeDefined();
    expect(parsed.dependencies["react-dom"]).toBeDefined();
  });

  it("merges scaffold dependencies", () => {
    const pkg = createPackageJson({ phaser: "^3.60.0", zustand: "^4.0.0" });
    const parsed = JSON.parse(pkg);
    expect(parsed.dependencies.phaser).toBe("^3.60.0");
    expect(parsed.dependencies.zustand).toBe("^4.0.0");
  });
});

describe("createViteConfig", () => {
  it("returns valid Vite config for React", () => {
    const config = createViteConfig();
    expect(config).toContain("@vitejs/plugin-react");
    expect(config).toContain("defineConfig");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="container-runtime"`
Expected: FAIL

- [ ] **Step 3: Implement container-runtime.ts**

```typescript
// lib/container-runtime.ts
"use client";

import type { WebContainer, FileSystemTree } from "@webcontainer/api";

let containerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

export async function getContainer(): Promise<WebContainer> {
  if (containerInstance) return containerInstance;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const { WebContainer } = await import("@webcontainer/api");
    containerInstance = await WebContainer.boot();
    return containerInstance;
  })();

  return bootPromise;
}

export async function teardownContainer(): Promise<void> {
  if (containerInstance) {
    containerInstance.teardown();
    containerInstance = null;
    bootPromise = null;
  }
}

export function filesToWebContainerTree(
  files: Record<string, string>
): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [filePath, content] of Object.entries(files)) {
    const parts = filePath.replace(/^\//, "").split("/");
    let current: any = tree;

    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!current[dir]) {
        current[dir] = { directory: {} };
      }
      current = current[dir].directory;
    }

    const fileName = parts[parts.length - 1];
    current[fileName] = { file: { contents: content } };
  }

  return tree;
}

export function createPackageJson(
  scaffoldDependencies: Record<string, string>
): string {
  return JSON.stringify(
    {
      name: "generated-app",
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
        "lucide-react": "^0.300.0",
        ...scaffoldDependencies,
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.2.0",
        vite: "^5.0.0",
      },
    },
    null,
    2
  );
}

export function createViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3111,
  },
});
`;
}

export function createIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Generated App</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"><\/script>
</body>
</html>
`;
}

export function createMainJsx(entryFile: string): string {
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '${entryFile}';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

export async function mountAndStart(
  files: Record<string, string>,
  dependencies: Record<string, string> = {},
  onServerReady: (url: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const wc = await getContainer();

  // Build file tree with Vite scaffolding
  const appFiles = filesToWebContainerTree(files);
  const fullTree: FileSystemTree = {
    "package.json": { file: { contents: createPackageJson(dependencies) } },
    "vite.config.js": { file: { contents: createViteConfig() } },
    "index.html": { file: { contents: createIndexHtml() } },
    src: {
      directory: {
        "main.jsx": { file: { contents: createMainJsx("./App") } },
        ...appFiles,
      },
    },
  };

  await wc.mount(fullTree);

  // npm install
  const installProcess = await wc.spawn("npm", ["install"]);
  const installExitCode = await installProcess.exit;
  if (installExitCode !== 0) {
    onError("npm install failed");
    return;
  }

  // Start dev server
  await wc.spawn("npm", ["run", "dev"]);

  wc.on("server-ready", (_port, url) => {
    onServerReady(url);
  });
}

export async function mountIncremental(
  files: Record<string, string>
): Promise<void> {
  const wc = await getContainer();
  const tree = filesToWebContainerTree(files);

  // Mount under src/ directory
  const srcTree: FileSystemTree = {
    src: { directory: tree },
  };

  await wc.mount(srcTree);
  // Vite HMR auto-detects changes
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="container-runtime"`
Expected: ALL PASS (the WebContainer-dependent functions are not tested directly — only pure utility functions)

- [ ] **Step 5: Commit**

```bash
git add lib/container-runtime.ts __tests__/container-runtime.test.ts
git commit -m "feat: add WebContainer runtime with file tree conversion, Vite scaffolding, and mount/start lifecycle"
```

---

### Task 11: Replace Sandpack with WebContainer in Preview

**Files:**
- Modify: `components/preview/preview-frame.tsx`
- Delete: `lib/sandpack-config.ts` (after preview-frame is updated)

- [ ] **Step 1: Rewrite preview-frame.tsx**

```typescript
// components/preview/preview-frame.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface PreviewFrameProps {
  readonly files: Record<string, string>;
  readonly projectId: string;
  readonly scaffoldDependencies?: Record<string, string>;
}

export function PreviewFrame({
  files,
  projectId,
  scaffoldDependencies,
}: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"booting" | "installing" | "starting" | "ready" | "error">("booting");
  const [error, setError] = useState<string | null>(null);
  const isFirstMount = useRef(true);
  const prevFilesRef = useRef<string>("");

  const startContainer = useCallback(async () => {
    const { mountAndStart } = await import("@/lib/container-runtime");

    setStatus("installing");
    await mountAndStart(
      files,
      scaffoldDependencies ?? {},
      (url) => {
        setPreviewUrl(url);
        setStatus("ready");
      },
      (err) => {
        setError(err);
        setStatus("error");
      }
    );
  }, []); // intentionally stable — files/deps passed at call time

  // Boot + initial mount
  useEffect(() => {
    if (!files || Object.keys(files).length === 0) return;

    const init = async () => {
      const { getContainer } = await import("@/lib/container-runtime");
      setStatus("booting");
      await getContainer(); // pre-boot
      await startContainer();
      isFirstMount.current = false;
    };

    init().catch((err) => {
      setError(String(err));
      setStatus("error");
    });

    return () => {
      // Cleanup on unmount
      import("@/lib/container-runtime").then(({ teardownContainer }) => {
        teardownContainer();
      });
    };
  }, [projectId]); // re-mount on project change

  // Incremental updates
  useEffect(() => {
    if (isFirstMount.current) return;
    if (status !== "ready") return;

    const filesKey = JSON.stringify(files);
    if (filesKey === prevFilesRef.current) return;
    prevFilesRef.current = filesKey;

    import("@/lib/container-runtime").then(({ mountIncremental }) => {
      mountIncremental(files);
    });
  }, [files, status]);

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-red-400">
        <div className="text-center">
          <p className="text-sm">预览加载失败</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
          <button
            onClick={() => startContainer()}
            className="mt-3 rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="text-center">
          <div className="mb-2 text-lg">
            {status === "booting" && "⏳ 启动预览环境..."}
            {status === "installing" && "📦 安装依赖..."}
            {status === "starting" && "🚀 启动开发服务器..."}
          </div>
          <p className="text-xs text-zinc-600">首次加载可能需要 10-15 秒</p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={previewUrl}
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      title="Preview"
    />
  );
}
```

- [ ] **Step 2: Update imports in preview-panel.tsx**

Find where `PreviewFrame` is imported in `preview-panel.tsx` and ensure it still passes `files`, `projectId`, and `scaffoldDependencies` props. The interface is the same, so no changes should be needed.

- [ ] **Step 3: Remove Sandpack dependencies from preview-panel.tsx**

Remove any Sandpack-specific imports (SandpackProvider, SandpackPreview, etc.) from preview-panel.tsx if they exist there.

- [ ] **Step 4: Delete sandpack-config.ts**

```bash
git rm lib/sandpack-config.ts
```

- [ ] **Step 5: Remove Sandpack references from chat-area.tsx**

Find `buildSandpackConfig` calls in chat-area.tsx and replace with the new pattern. The files are now passed directly to PreviewFrame — no Sandpack config needed. The container-runtime handles Vite scaffolding internally.

Replace:
```typescript
const sandpackConfig = buildSandpackConfig(mergedFiles, projectId, scaffoldDependencies);
```

With:
```typescript
// Files are passed directly to PreviewFrame component
// container-runtime.ts handles Vite scaffolding internally
setCurrentFiles(mergedFiles);
```

- [ ] **Step 6: Remove normalizeExports calls**

Search for `normalizeExports` in chat-area.tsx and remove those calls. WebContainer uses Vite which handles exports natively.

- [ ] **Step 7: Test simple project preview**

Run: `npm run dev:clean`
Test: Create a simple project, verify preview loads in WebContainer.

- [ ] **Step 8: Commit**

```bash
git add components/preview/preview-frame.tsx components/preview/preview-panel.tsx components/workspace/chat-area.tsx
git rm lib/sandpack-config.ts
git commit -m "feat: replace Sandpack with WebContainer preview, delete sandpack-config.ts"
```

---

### Task 12: Uninstall Sandpack, Update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove Sandpack dependency**

```bash
npm uninstall @codesandbox/sandpack-react @codesandbox/sandpack-themes
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Fix any remaining Sandpack import errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove Sandpack dependencies"
```

---

### Task 13: Wire Progressive Delivery in chat-area.tsx

**Files:**
- Modify: `components/workspace/chat-area.tsx`

- [ ] **Step 1: After skeleton generation, mount and start WebContainer**

In the complex path of handleSendMessage, after `pipeline.onSkeletonComplete(skeletonFiles)`:

```typescript
// Mount skeleton to WebContainer for immediate preview
import("@/lib/container-runtime").then(({ mountAndStart }) => {
  mountAndStart(
    skeletonFiles,
    scaffoldDependencies,
    (url) => {
      // PreviewFrame will pick this up via state
      updateSession(projectId, { transitionText: "骨架预览就绪" });
    },
    (err) => {
      console.error("WebContainer start failed:", err);
    }
  );
});
```

- [ ] **Step 2: After each module completes, mount incrementally**

In the module-filling loop, after `pipeline.onModuleComplete(moduleName, moduleFiles)`:

```typescript
// Incrementally mount new module files
import("@/lib/container-runtime").then(({ mountIncremental }) => {
  mountIncremental(moduleFiles);
});
```

- [ ] **Step 3: Test with a complex prompt**

Run: `npm run dev:clean`
Test: Use a complex prompt like "做一个电商管理后台，有商品管理、订单列表、数据看板、用户管理"
Verify: Skeleton appears first (~30s), then modules fill in progressively.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: wire progressive delivery — skeleton mounts first, modules mount incrementally via HMR"
```

---

## Phase 3: Game Generation + Testing

### Task 14: Add Game Scene Types and Rules

**Files:**
- Modify: `lib/scene-classifier.ts`
- Modify: `lib/scene-rules.ts`

- [ ] **Step 1: Add game-engine and game-canvas scene detection**

In `lib/scene-classifier.ts`, update `PROMPT_KEYWORDS`:

```typescript
// Add to PROMPT_KEYWORDS:
"game-engine": [
  /马里奥|mario|平台跳跃|platformer|弹幕|shooter|物理模拟|phaser/i,
],
"game-canvas": [
  /贪吃蛇|snake|俄罗斯方块|tetris|打砖块|breakout|扫雷|minesweeper|井字棋|tic.?tac/i,
],
```

Update `PM_FEATURE_KEYWORDS` and `PM_MODULE_KEYWORDS` similarly.

Update the `Scene` type in `lib/types.ts`:

```typescript
export type Scene =
  | "game" | "game-engine" | "game-canvas"
  | "dashboard" | "crud" | "multiview"
  | "animation" | "persistence" | "general";
```

- [ ] **Step 2: Add game rules to scene-rules.ts**

Add to `getEngineerSceneRules`:

```typescript
"game-engine": `## 游戏引擎规则 (Phaser.js)
- 使用 Phaser 3 框架，import Phaser from 'phaser'
- 入口文件创建 Phaser.Game 实例并挂载到 DOM 容器
- 场景用 class extends Phaser.Scene，实现 preload/create/update
- 物理引擎用 Arcade Physics (this.physics.add)
- 素材用几何图形（this.add.rectangle/circle）或 emoji（this.add.text）
- 不要在 React 组件内写游戏逻辑
- 碰撞检测用 this.physics.add.collider / overlap
- 相机跟随用 this.cameras.main.startFollow(player)
- 输入用 this.input.keyboard.createCursorKeys()`,

"game-canvas": `## 游戏规则 (Canvas 原生)
- 使用 Canvas 2D API，不引入游戏引擎
- Canvas 元素通过 useRef 获取
- 游戏循环用 requestAnimationFrame，在 useEffect 中启动
- useEffect cleanup 必须 cancelAnimationFrame
- 游戏状态用普通对象（不用 useState），通过 useRef 持有
- 只用 useState 触发 UI 重渲染（分数、游戏结束状态）
- 碰撞检测用 AABB（轴对齐包围盒）
- 输入用 addEventListener('keydown'/'keyup')，cleanup 时 removeEventListener
- 绘制用 ctx.fillRect / ctx.arc / ctx.fillText`,
```

Add to `getArchitectSceneHint`:

```typescript
"game-engine": "使用 Phaser 3 框架。场景用 Phaser.Scene 类。物理用 Arcade Physics。素材用几何图形。",
"game-canvas": "使用 Canvas 2D API。游戏循环用 requestAnimationFrame。状态用普通对象不用 React state。",
```

- [ ] **Step 3: Commit**

```bash
git add lib/scene-classifier.ts lib/scene-rules.ts lib/types.ts
git commit -m "feat: add game-engine (Phaser) and game-canvas scene types with specialized rules"
```

---

### Task 15: Relax checkDisallowedImports for Games

**Files:**
- Modify: `lib/extract-code.ts`

- [ ] **Step 1: Make checkDisallowedImports scene-aware**

Change the function signature to accept scene types:

```typescript
export function checkDisallowedImports(
  files: Record<string, string>,
  sceneTypes: Scene[] = ["general"]
): DisallowedImport[] {
  const sceneAllowList = new Set<string>();
  if (sceneTypes.includes("game-engine") || sceneTypes.includes("game")) {
    sceneAllowList.add("phaser");
  }
  if (sceneTypes.includes("dashboard")) {
    sceneAllowList.add("recharts");
  }

  // In the existing loop, skip violations that are in sceneAllowList:
  // if (BLOCKED_PACKAGES.has(pkg) && !sceneAllowList.has(pkg)) { ... }
}
```

- [ ] **Step 2: Update callers to pass sceneTypes**

In chat-area.tsx, update the `checkDisallowedImports` call to pass the current `scenes` array.

- [ ] **Step 3: Commit**

```bash
git add lib/extract-code.ts components/workspace/chat-area.tsx
git commit -m "feat: make checkDisallowedImports scene-aware — allow phaser for games, recharts for dashboards"
```

---

### Task 16: E2E Tests

**Files:**
- Create: `e2e/simple-project.spec.ts`
- Create: `e2e/complex-project.spec.ts`
- Create: `e2e/game-project.spec.ts`

- [ ] **Step 1: Write simple project regression test**

```typescript
// e2e/simple-project.spec.ts
import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, cleanupTestProjects } from "./helpers";

test.describe("Simple project generation", () => {
  test.afterAll(async ({ browser }) => {
    await cleanupTestProjects(browser);
  });

  test("generates a calculator app", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] Simple Calculator");

    // Send prompt
    const input = page.getByPlaceholder(/输入|描述|prompt/i);
    await input.fill("做一个简单的计算器");
    await input.press("Enter");

    // Wait for generation complete
    await expect(page.locator("text=生成完成").or(page.locator("iframe"))).toBeVisible({
      timeout: 120_000,
    });

    // Verify preview iframe exists
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("body")).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 2: Write complex project test**

```typescript
// e2e/complex-project.spec.ts
import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, cleanupTestProjects } from "./helpers";

test.describe("Complex project generation", () => {
  test.afterAll(async ({ browser }) => {
    await cleanupTestProjects(browser);
  });

  test("generates a multi-page admin dashboard", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] Complex Admin");

    const input = page.getByPlaceholder(/输入|描述|prompt/i);
    await input.fill("做一个电商管理后台，有商品管理、订单列表、数据看板、用户管理");
    await input.press("Enter");

    // Should see module progress
    await expect(page.locator("text=/模块.*\\d+\\/\\d+/")).toBeVisible({
      timeout: 60_000,
    });

    // Wait for completion (longer timeout for complex projects)
    await expect(page.locator("text=生成完成")).toBeVisible({
      timeout: 300_000,
    });

    // Verify preview
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("body")).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 3: Write game project test**

```typescript
// e2e/game-project.spec.ts
import { test, expect } from "@playwright/test";
import { loginAsGuest, createProjectAndNavigate, cleanupTestProjects } from "./helpers";

test.describe("Game project generation", () => {
  test.afterAll(async ({ browser }) => {
    await cleanupTestProjects(browser);
  });

  test("generates a snake game", async ({ page }) => {
    await loginAsGuest(page);
    await createProjectAndNavigate(page, "[E2E] Snake Game");

    const input = page.getByPlaceholder(/输入|描述|prompt/i);
    await input.fill("做一个贪吃蛇游戏");
    await input.press("Enter");

    await expect(page.locator("text=生成完成")).toBeVisible({
      timeout: 180_000,
    });

    // Verify canvas or Phaser container exists in preview
    const iframe = page.frameLocator("iframe");
    await expect(
      iframe.locator("canvas").or(iframe.locator("#game-container"))
    ).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 4: Run E2E tests**

```bash
npm run test:e2e -- --grep "Simple project"
npm run test:e2e -- --grep "Game project"
```

- [ ] **Step 5: Commit**

```bash
git add e2e/simple-project.spec.ts e2e/complex-project.spec.ts e2e/game-project.spec.ts
git commit -m "test: add E2E tests for simple, complex, and game project generation"
```

---

## Phase 4: Polish

### Task 17: WebContainer Performance Optimization

**Files:**
- Modify: `lib/container-runtime.ts`
- Modify: `components/preview/preview-frame.tsx`

- [ ] **Step 1: Add pre-boot on workspace page load**

In the workspace page (`app/project/[id]/page.tsx` or `components/workspace/workspace.tsx`), trigger early WebContainer boot:

```typescript
useEffect(() => {
  // Pre-boot WebContainer on workspace mount
  import("@/lib/container-runtime").then(({ getContainer }) => {
    getContainer().catch(() => {
      // Silent failure — will retry when preview needs it
    });
  });
}, []);
```

- [ ] **Step 2: Add npm cache hint**

In `container-runtime.ts`, after `wc.spawn("npm", ["install"])`, add a check for existing `node_modules`:

```typescript
// Check if node_modules already exists (cached from previous mount)
try {
  await wc.fs.readdir("/node_modules");
  // Skip install if node_modules exists and package.json hasn't changed
} catch {
  // No node_modules — run install
  const installProcess = await wc.spawn("npm", ["install"]);
  await installProcess.exit;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/container-runtime.ts components/workspace/workspace.tsx
git commit -m "perf: pre-boot WebContainer on workspace load, skip npm install when cached"
```

---

### Task 18: Error Boundary and Edge Case Handling

**Files:**
- Modify: `components/workspace/chat-area.tsx`
- Modify: `lib/pipeline-controller.ts`

- [ ] **Step 1: Add timeout for each pipeline phase**

In chat-area.tsx, add per-phase timeouts:

```typescript
const PHASE_TIMEOUTS: Record<string, number> = {
  CLASSIFYING: 60_000,    // 60s for PM
  DECOMPOSING: 30_000,    // 30s for Decomposer
  SKELETON: 90_000,       // 90s for skeleton
  MODULE_FILLING: 90_000, // 90s per module
  POST_PROCESSING: 30_000,
};
```

Wrap each phase's fetch call with `Promise.race([fetchSSE(...), timeout])`.

- [ ] **Step 2: Handle WebContainer boot failure gracefully**

In preview-frame.tsx, if WebContainer fails to boot (e.g., unsupported browser), show a meaningful message:

```typescript
if (status === "error" && error?.includes("boot")) {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-400">
      <div className="text-center">
        <p className="text-sm">预览环境不可用</p>
        <p className="mt-1 text-xs text-zinc-500">
          WebContainer 需要现代浏览器支持（Chrome 90+, Firefox 90+）
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Handle AbortController cancellation in pipeline**

When user aborts (clicks stop), ensure PipelineController transitions to IDLE:

```typescript
// In the abort handler:
pipelineRef.current?.onError("用户取消");
resetSession(projectId);
```

- [ ] **Step 4: Commit**

```bash
git add components/workspace/chat-area.tsx components/preview/preview-frame.tsx lib/pipeline-controller.ts
git commit -m "fix: add phase timeouts, WebContainer error handling, and abort support for pipeline"
```

---

### Task 19: Final Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Test simple project (regression)**

Prompt: "做一个计算器"
Verify: Works exactly as before, no module decomposition, fast preview.

- [ ] **Step 2: Test complex web app**

Prompt: "做一个电商管理后台，有商品管理、订单列表、数据看板、用户管理"
Verify: Shows module progress, skeleton appears first, modules fill in.

- [ ] **Step 3: Test game — simple (Canvas)**

Prompt: "做一个贪吃蛇游戏"
Verify: Game renders on Canvas, keyboard controls work.

- [ ] **Step 4: Test game — complex (Phaser)**

Prompt: "做一个超级马里奥风格的平台跳跃游戏"
Verify: Phaser.js game loads, player can jump and move.

- [ ] **Step 5: Test direct path (bug fix)**

On an existing project, send: "把标题颜色改成红色"
Verify: Direct path works, no pipeline decomposition.

- [ ] **Step 6: Test abort**

Start a complex generation, click abort mid-way.
Verify: Generation stops cleanly, no hanging states.

- [ ] **Step 7: Push to remote for Vercel Preview**

```bash
git push origin feat/modular-pipeline
```

Verify the Preview deployment works end-to-end.

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| Phase 1 | Tasks 1-8 | PipelineController state machine, Decomposer agent, modular orchestration in chat-area.tsx |
| Phase 2 | Tasks 9-13 | WebContainer preview, progressive delivery, Sandpack removal |
| Phase 3 | Tasks 14-16 | Game scene rules (Phaser + Canvas), scene-aware import checking, E2E tests |
| Phase 4 | Tasks 17-19 | Performance optimization, error handling, final integration testing |

**Total:** 19 tasks, ~50 commits, all on `feat/modular-pipeline` branch.

**NEVER merge to main without human approval.**
