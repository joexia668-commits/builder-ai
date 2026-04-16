import type {
  ModuleDefinition,
  ExecutionPlan,
  PlanRevision,
} from "@/lib/types";
import type { InterfaceRegistry } from "@/lib/interface-registry";
import {
  planNext,
  planComplete,
  planSkipCascade,
} from "@/lib/execution-plan";

export interface ModuleProgress {
  total: number;
  completed: string[];
  failed: string[];
  skipped: string[];
  current: string | null;
}

export interface OrchestratorCallbacks {
  executeModule: (
    module: ModuleDefinition,
    registry: InterfaceRegistry,
    plan: ExecutionPlan,
    skeletonFiles: Record<string, string>,
    allModuleFiles: Record<string, string>
  ) => Promise<Record<string, string>>;

  onModuleComplete: (moduleName: string, files: Record<string, string>) => void;
  onModuleFailed: (moduleName: string, reason: string) => void;
  onModuleSkipped: (moduleName: string, reason: string) => void;
  onPlanRevised: (revision: PlanRevision) => void;
  onProgress: (progress: ModuleProgress) => void;

  patchMissingExports: (
    moduleName: string,
    missing: readonly string[],
    files: Record<string, string>
  ) => Promise<Record<string, string> | null>;

  generateStub: (
    moduleName: string,
    exports: readonly string[]
  ) => Record<string, string>;

  signal: AbortSignal;
}

export interface OrchestratorResult {
  files: Record<string, string>;
  plan: ExecutionPlan;
  registry: InterfaceRegistry;
}

const RETRYABLE_PATTERNS = ["timeout", "network", "ECONNRESET", "503", "429"];

function isRetryableError(reason: string): boolean {
  return RETRYABLE_PATTERNS.some((p) => reason.toLowerCase().includes(p.toLowerCase()));
}

function buildProgress(plan: ExecutionPlan): ModuleProgress {
  return {
    total: plan.modules.length,
    completed: [...plan.completed],
    failed: plan.failed.map((f) => f.name),
    skipped: plan.skipped.map((s) => s.name),
    current: plan.executing,
  };
}

export function createModuleOrchestrator(
  plan: ExecutionPlan,
  registry: InterfaceRegistry,
  callbacks: OrchestratorCallbacks,
  skeletonFiles: Record<string, string> = {},
  initialFiles: Record<string, string> = {}
): { run: () => Promise<OrchestratorResult> } {
  const allModuleFiles: Record<string, string> = { ...initialFiles };

  async function run(): Promise<OrchestratorResult> {
    while (plan.pending.length > 0) {
      if (callbacks.signal.aborted) throw new DOMException("Aborted", "AbortError");

      const moduleName = planNext(plan, registry);
      if (moduleName === null) break;

      const moduleDef = plan.modules.find((m) => m.name === moduleName);
      if (!moduleDef) continue;

      callbacks.onProgress(buildProgress(plan));

      try {
        const files = await callbacks.executeModule(
          moduleDef, registry, plan, skeletonFiles, allModuleFiles
        );
        Object.assign(allModuleFiles, files);

        registry.registerActual(moduleName, files);
        const verification = registry.verifyContract(moduleName);

        if (verification.satisfied) {
          planComplete(plan, moduleName);
          registry.markCompleted(moduleName);
          callbacks.onModuleComplete(moduleName, files);
        } else if (verification.missingExports.length <= 2) {
          const patched = await callbacks.patchMissingExports(
            moduleName, verification.missingExports, files
          );
          if (patched) {
            Object.assign(allModuleFiles, patched);
            registry.registerActual(moduleName, { ...files, ...patched });
            const reVerify = registry.verifyContract(moduleName);
            if (reVerify.satisfied) {
              planComplete(plan, moduleName);
              registry.markCompleted(moduleName);
              callbacks.onModuleComplete(moduleName, { ...files, ...patched });
            } else {
              registry.markDegraded(moduleName, [...reVerify.missingExports]);
              planComplete(plan, moduleName);
              callbacks.onModuleComplete(moduleName, { ...files, ...patched });
            }
          } else {
            registry.markDegraded(moduleName, [...verification.missingExports]);
            planComplete(plan, moduleName);
            callbacks.onModuleComplete(moduleName, files);
          }
        } else {
          handleModuleFailure(plan, moduleName, "contract_violation", registry, callbacks, allModuleFiles);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        const reason = err instanceof Error ? err.message : "unknown";
        handleModuleFailure(plan, moduleName, reason, registry, callbacks, allModuleFiles);
      }
    }

    return { files: allModuleFiles, plan, registry };
  }

  return { run };
}

function handleModuleFailure(
  plan: ExecutionPlan,
  moduleName: string,
  reason: string,
  registry: InterfaceRegistry,
  callbacks: OrchestratorCallbacks,
  allModuleFiles: Record<string, string>
): void {
  const existingFail = plan.failed.find((f) => f.name === moduleName);
  const attempt = existingFail ? existingFail.attempt + 1 : 1;

  if (attempt < 2 && isRetryableError(reason)) {
    plan.pending.push(moduleName);
    plan.executing = null;
    const revision: PlanRevision = {
      type: "retry",
      description: `${moduleName} ${reason}，排队重试`,
      timestamp: Date.now(),
      affected: [moduleName],
    };
    plan.revisions.push(revision);
    plan.failed.push({ name: moduleName, reason, attempt });
    callbacks.onPlanRevised(revision);
    return;
  }

  plan.failed.push({ name: moduleName, reason, attempt });
  plan.executing = null;
  plan.pending = plan.pending.filter((n) => n !== moduleName);
  registry.markFailed(moduleName, reason);
  callbacks.onModuleFailed(moduleName, reason);

  const consumers = registry.getConsumers(moduleName, plan.modules);
  const failedExports = registry.getContract(moduleName).declared.exports;

  for (const consumerName of consumers) {
    if (!plan.pending.includes(consumerName)) continue;

    const consumer = plan.modules.find((m) => m.name === consumerName);
    if (!consumer) continue;

    const overlap = consumer.interface.consumes.filter((c) => failedExports.includes(c));
    const ratio = consumer.interface.consumes.length > 0
      ? overlap.length / consumer.interface.consumes.length
      : 0;

    if (ratio > 0.5) {
      const cascaded = planSkipCascade(plan, consumerName, `核心依赖 ${moduleName} 失败`);
      const revision: PlanRevision = {
        type: "skip_cascade",
        description: `${moduleName} 失败 → ${[consumerName, ...cascaded].join(", ")} 级联跳过`,
        timestamp: Date.now(),
        affected: [consumerName, ...cascaded],
      };
      plan.revisions.push(revision);
      callbacks.onPlanRevised(revision);
      for (const s of [consumerName, ...cascaded]) {
        callbacks.onModuleSkipped(s, `核心依赖 ${moduleName} 失败`);
      }
    } else {
      const stubFiles = callbacks.generateStub(moduleName, failedExports);
      Object.assign(allModuleFiles, stubFiles);
      registry.markDegraded(moduleName, [...failedExports]);
      const revision: PlanRevision = {
        type: "stub",
        description: `${moduleName} 降级为 stub，${consumerName} 继续`,
        timestamp: Date.now(),
        affected: [moduleName, consumerName],
      };
      plan.revisions.push(revision);
      callbacks.onPlanRevised(revision);
    }
  }
}
