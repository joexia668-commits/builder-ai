import type {
  PipelineState,
  Complexity,
  PmOutput,
  DecomposerOutput,
  ScaffoldData,
} from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveComplexity(pm: PmOutput): Complexity {
  if (pm.complexity) return pm.complexity;
  if (pm.modules.length > 3) return "complex";
  if (pm.features.length > 5) return "complex";
  return "simple";
}

function flattenGenerateOrder(order: readonly (readonly string[])[]): string[] {
  const result: string[] = [];
  for (const layer of order) {
    for (const name of layer) result.push(name);
  }
  return result;
}

// ─── Public interface ─────────────────────────────────────────────────────────

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

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPipelineController(
  options: PipelineControllerOptions
): PipelineController {
  const { onStateChange } = options;

  // State
  let state: PipelineState = "IDLE";
  let complexity: Complexity | null = null;
  let pmOutput: PmOutput | null = null;
  let decomposerOutput: DecomposerOutput | null = null;
  let moduleQueue: string[] = [];
  let completedModules: string[] = [];
  let failedModules: string[] = [];
  let allFiles: Record<string, string> = {};

  function transition(next: PipelineState, message: string): void {
    state = next;
    onStateChange(next, message);
  }

  function mergeFiles(incoming: Record<string, string>): void {
    allFiles = { ...allFiles, ...incoming };
  }

  // Advance through the module queue; return the next module name or null if
  // the queue is exhausted (which moves state to POST_PROCESSING).
  function advanceModuleQueue(): string | null {
    if (moduleQueue.length === 0) {
      transition("POST_PROCESSING", "All modules processed, running post-processing");
      return null;
    }
    const next = moduleQueue[0];
    transition("MODULE_FILLING", `Filling module: ${next}`);
    return next;
  }

  return {
    // ── Getters ──────────────────────────────────────────────────────────────

    getState: () => state,
    getComplexity: () => complexity,
    getPmOutput: () => pmOutput,
    getDecomposerOutput: () => decomposerOutput,
    getCurrentModule: () => moduleQueue[0] ?? null,
    getModuleQueue: () => moduleQueue,
    getCompletedModules: () => completedModules,
    getFailedModules: () => failedModules,
    getAllFiles: () => ({ ...allFiles }),

    // ── Event handlers ────────────────────────────────────────────────────────

    start(prompt: string): void {
      if (state !== "IDLE") return;
      transition("CLASSIFYING", `Classifying prompt: ${prompt}`);
    },

    onPmComplete(pm: PmOutput): void {
      if (state !== "CLASSIFYING") return;
      pmOutput = pm;
      complexity = resolveComplexity(pm);
      if (complexity === "complex") {
        transition("DECOMPOSING", "PM classified as complex — decomposing into modules");
      } else {
        transition("ARCHITECTING", "PM classified as simple — proceeding to architecture");
      }
    },

    onDecomposerComplete(output: DecomposerOutput): void {
      if (state !== "DECOMPOSING") return;
      decomposerOutput = output;
      moduleQueue = flattenGenerateOrder(output.generateOrder);
      transition("SKELETON", "Decomposer complete — generating skeleton");
    },

    onDecomposerFailed(): void {
      if (state !== "DECOMPOSING") return;
      // Fallback: treat as simple and run the full architect pipeline
      complexity = "simple";
      transition("ARCHITECTING", "Decomposer failed — falling back to simple architecture path");
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onArchitectComplete(scaffold: ScaffoldData): void {
      if (state !== "ARCHITECTING") return;
      transition("ENGINEERING", "Architecture complete — generating code");
    },

    onSkeletonComplete(files: Record<string, string>): void {
      if (state !== "SKELETON") return;
      mergeFiles(files);
      advanceModuleQueue();
    },

    onEngineerComplete(files: Record<string, string>): void {
      if (state !== "ENGINEERING") return;
      mergeFiles(files);
      transition("POST_PROCESSING", "Engineering complete — running post-processing");
    },

    onModuleComplete(moduleName: string, files: Record<string, string>): void {
      if (state !== "MODULE_FILLING") return;
      // Remove from queue
      moduleQueue = moduleQueue.filter((m) => m !== moduleName);
      completedModules = [...completedModules, moduleName];
      mergeFiles(files);
      advanceModuleQueue();
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onModuleFailed(moduleName: string, reason: string): void {
      if (state !== "MODULE_FILLING") return;
      moduleQueue = moduleQueue.filter((m) => m !== moduleName);
      failedModules = [...failedModules, moduleName];
      // Continue regardless — either move to the next module or post-processing
      advanceModuleQueue();
    },

    onPostProcessingComplete(files: Record<string, string>): void {
      if (state !== "POST_PROCESSING") return;
      mergeFiles(files);
      transition("COMPLETE", "Post-processing complete — generation finished");
    },

    onError(message: string): void {
      transition("ERROR", `Error: ${message}`);
    },
  };
}
