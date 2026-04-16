import type { ModuleDefinition } from "@/lib/types";

export function breakModuleCycles(
  modules: readonly ModuleDefinition[],
  warnings: string[]
): ModuleDefinition[] {
  const nameSet = new Set(modules.map((m) => m.name));

  // Step 0: remove self-references
  let current: ModuleDefinition[] = modules.map((m) => {
    const cleaned = m.deps.filter((d) => d !== m.name);
    if (cleaned.length < m.deps.length) {
      warnings.push(`移除模块自引用: ${m.name}`);
      return { ...m, deps: cleaned };
    }
    return { ...m, deps: [...m.deps] };
  });

  // Step 1: iteratively find and break cycles
  for (let i = 0; i < current.length; i++) {
    const cycle = findOneCycle(current, nameSet);
    if (!cycle) break;

    const inDeg = computeInDegrees(current, nameSet);
    let bestIdx = 0;
    let bestWeight = -Infinity;

    for (let j = 0; j < cycle.length - 1; j++) {
      const src = cycle[j];
      const tgt = cycle[j + 1];
      const weight = (inDeg.get(src) ?? 0) - (inDeg.get(tgt) ?? 0);
      if (weight > bestWeight) {
        bestWeight = weight;
        bestIdx = j;
      }
    }

    const removeSrc = cycle[bestIdx];
    const removeTgt = cycle[bestIdx + 1];
    warnings.push(`断开模块循环依赖: ${removeSrc} → ${removeTgt}`);
    current = current.map((m) =>
      m.name === removeSrc
        ? { ...m, deps: m.deps.filter((d) => d !== removeTgt) }
        : m
    );
  }

  return current;
}

export function topologicalSortModules(
  modules: readonly ModuleDefinition[]
): string[][] {
  if (modules.length === 0) return [];

  const nameSet = new Set(modules.map((m) => m.name));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const m of modules) {
    inDegree.set(m.name, 0);
    dependents.set(m.name, []);
  }

  for (const m of modules) {
    for (const dep of m.deps) {
      if (!nameSet.has(dep)) continue;
      inDegree.set(m.name, (inDegree.get(m.name) ?? 0) + 1);
      dependents.get(dep)!.push(m.name);
    }
  }

  const layers: string[][] = [];
  let remaining = modules.length;
  let currentLayer = modules
    .filter((m) => inDegree.get(m.name) === 0)
    .map((m) => m.name);

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    remaining -= currentLayer.length;
    const nextLayer: string[] = [];
    for (const name of currentLayer) {
      for (const dep of dependents.get(name) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) nextLayer.push(dep);
      }
    }
    currentLayer = nextLayer;
  }

  if (remaining > 0) {
    const stuck = modules
      .filter((m) => !layers.flat().includes(m.name))
      .map((m) => m.name);
    layers.push(stuck);
  }

  return layers;
}

function computeInDegrees(
  modules: readonly ModuleDefinition[],
  nameSet: Set<string>
): Map<string, number> {
  const inDeg = new Map<string, number>();
  for (const m of modules) inDeg.set(m.name, 0);
  for (const m of modules) {
    for (const d of m.deps) {
      if (nameSet.has(d)) inDeg.set(d, (inDeg.get(d) ?? 0) + 1);
    }
  }
  return inDeg;
}

function findOneCycle(
  modules: readonly ModuleDefinition[],
  nameSet: Set<string>
): string[] | null {
  const adj = new Map<string, readonly string[]>();
  for (const m of modules) {
    adj.set(m.name, m.deps.filter((d) => nameSet.has(d)));
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of Array.from(nameSet)) color.set(name, WHITE);
  const parent = new Map<string, string | null>();

  for (const start of Array.from(nameSet)) {
    if (color.get(start) !== WHITE) continue;
    const stack: string[] = [start];
    while (stack.length > 0) {
      const u = stack[stack.length - 1];
      if (color.get(u) === WHITE) {
        color.set(u, GRAY);
        for (const v of adj.get(u) ?? []) {
          if (color.get(v) === WHITE) {
            parent.set(v, u);
            stack.push(v);
          } else if (color.get(v) === GRAY) {
            const cycle: string[] = [v];
            let cur = u;
            while (cur !== v) {
              cycle.push(cur);
              cur = parent.get(cur)!;
            }
            cycle.push(v);
            cycle.reverse();
            return cycle;
          }
        }
      } else {
        stack.pop();
        color.set(u, BLACK);
      }
    }
  }
  return null;
}
