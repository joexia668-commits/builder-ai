/**
 * Topological sort that groups files into execution layers.
 * Files within a layer have no interdependencies and can be processed in parallel.
 * Layers are ordered so that all dependencies of layer N are in layers 0..N-1.
 *
 * @param files - Array of { path, deps } where deps are paths of other project files
 * @returns Array of layers, each layer is an array of file paths
 * @throws Error if circular dependency is detected
 */
export function topologicalSort(
  files: ReadonlyArray<{ readonly path: string; readonly deps: readonly string[] }>
): string[][] {
  if (files.length === 0) return [];

  const pathSet = new Set(files.map((f) => f.path));

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const f of files) {
    inDegree.set(f.path, 0);
    dependents.set(f.path, []);
  }

  for (const f of files) {
    for (const dep of f.deps) {
      if (!pathSet.has(dep)) continue;
      inDegree.set(f.path, (inDegree.get(f.path) ?? 0) + 1);
      dependents.get(dep)!.push(f.path);
    }
  }

  const layers: string[][] = [];
  let remaining = files.length;

  let currentLayer = files
    .filter((f) => inDegree.get(f.path) === 0)
    .map((f) => f.path);

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    remaining -= currentLayer.length;

    const nextLayer: string[] = [];
    for (const path of currentLayer) {
      for (const dependent of dependents.get(path) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) nextLayer.push(dependent);
      }
    }
    currentLayer = nextLayer;
  }

  if (remaining > 0) {
    throw new Error("Circular dependency detected in scaffold file graph");
  }

  return layers;
}
