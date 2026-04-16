import type { DecomposerOutput, ExecutionPlan } from "@/lib/types";
import type { InterfaceRegistry } from "@/lib/interface-registry";

export function createExecutionPlan(output: DecomposerOutput): ExecutionPlan {
  return {
    original: output,
    modules: output.modules.map((m) => ({ ...m, deps: [...m.deps] })),
    pending: output.generateOrder.flat(),
    executing: null,
    completed: [],
    failed: [],
    skipped: [],
    revisions: [],
  };
}

export function planNext(
  plan: ExecutionPlan,
  registry: InterfaceRegistry
): string | null {
  for (let i = 0; i < plan.pending.length; i++) {
    const name = plan.pending[i];
    const mod = plan.modules.find((m) => m.name === name);
    if (!mod) continue;

    const depsOk = mod.deps.every((dep) => {
      const isKnown = plan.modules.some((m) => m.name === dep);
      if (!isKnown) return true;
      const status = registry.getStatus(dep);
      return status === "completed" || status === "degraded";
    });

    if (depsOk) {
      plan.pending.splice(i, 1);
      plan.executing = name;
      return name;
    }
  }
  return null;
}

export function planComplete(plan: ExecutionPlan, moduleName: string): void {
  plan.pending = plan.pending.filter((n) => n !== moduleName);
  plan.executing = plan.executing === moduleName ? null : plan.executing;
  if (!plan.completed.includes(moduleName)) {
    plan.completed.push(moduleName);
  }
}

export function planSkipCascade(
  plan: ExecutionPlan,
  moduleName: string,
  reason: string,
  registry: InterfaceRegistry
): string[] {
  const cascaded: string[] = [];

  function skipOne(name: string, skipReason: string): void {
    plan.pending = plan.pending.filter((n) => n !== name);
    if (plan.executing === name) plan.executing = null;
    plan.skipped.push({ name, reason: skipReason });
  }

  skipOne(moduleName, reason);

  const queue = [moduleName];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const mod of plan.modules) {
      if (!plan.pending.includes(mod.name)) continue;
      if (mod.deps.includes(current)) {
        const cascadeReason = `依赖 ${current} 被跳过`;
        skipOne(mod.name, cascadeReason);
        cascaded.push(mod.name);
        queue.push(mod.name);
      }
    }
  }

  return cascaded;
}

export function planSummary(plan: ExecutionPlan): {
  completed: string[];
  degraded: string[];
  skipped: string[];
  failed: string[];
  revisions: typeof plan.revisions;
} {
  return {
    completed: [...plan.completed],
    degraded: [],
    skipped: plan.skipped.map((s) => s.name),
    failed: plan.failed.map((f) => f.name),
    revisions: [...plan.revisions],
  };
}
