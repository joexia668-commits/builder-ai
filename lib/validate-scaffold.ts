import type { ScaffoldData, ScaffoldFile, ScaffoldValidationResult } from "@/lib/types";
import { BLOCKED_PACKAGES } from "@/lib/extract-code";

// /supabaseClient.js is a virtual file injected by buildSandpackConfig at runtime —
// it is never part of the Architect scaffold but is always available to generated code.
const WHITELISTED_DEPS = new Set(["/supabaseClient.js"]);

function computeInDegrees(
  files: readonly ScaffoldFile[]
): Map<string, number> {
  const pathSet = new Set(files.map((f) => f.path));
  const inDeg = new Map<string, number>();
  for (const f of files) inDeg.set(f.path, 0);
  for (const f of files) {
    for (const d of f.deps) {
      if (pathSet.has(d)) inDeg.set(d, (inDeg.get(d) ?? 0) + 1);
    }
  }
  return inDeg;
}

function findOneCycle(files: readonly ScaffoldFile[]): string[] | null {
  const pathSet = new Set(files.map((f) => f.path));
  const adj = new Map<string, readonly string[]>();
  for (const f of files) {
    adj.set(f.path, f.deps.filter((d) => pathSet.has(d)));
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const p of Array.from(pathSet)) color.set(p, WHITE);
  const parent = new Map<string, string | null>();

  for (const start of Array.from(pathSet)) {
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
            // Found cycle — reconstruct
            const cycle: string[] = [v];
            let cur: string = u;
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

function breakCycles(
  files: readonly ScaffoldFile[],
  warnings: string[]
): readonly ScaffoldFile[] {
  let current = files;
  // Safety bound: at most N iterations
  for (let i = 0; i < current.length; i++) {
    const cycle = findOneCycle(current);
    if (!cycle) break;

    const inDeg = computeInDegrees(current);
    // cycle is [v, ..., v] — edges are consecutive pairs
    let bestIdx = 0;
    let bestWeight = -Infinity;
    const fileMap = new Map(current.map((f) => [f.path, f]));

    for (let j = 0; j < cycle.length - 1; j++) {
      const src = cycle[j];
      const tgt = cycle[j + 1];
      const weight = (inDeg.get(src) ?? 0) - (inDeg.get(tgt) ?? 0);
      const srcDepsLen = fileMap.get(src)?.deps.length ?? 0;
      const bestSrc = cycle[bestIdx];
      const bestSrcDepsLen = fileMap.get(bestSrc)?.deps.length ?? 0;
      if (
        weight > bestWeight ||
        (weight === bestWeight && srcDepsLen > bestSrcDepsLen)
      ) {
        bestWeight = weight;
        bestIdx = j;
      }
    }

    const removeSrc = cycle[bestIdx];
    const removeTgt = cycle[bestIdx + 1];
    warnings.push(`断开循环依赖: ${removeSrc} → ${removeTgt}`);
    current = current.map((f) =>
      f.path === removeSrc
        ? { ...f, deps: f.deps.filter((d) => d !== removeTgt) }
        : f
    );
  }
  return current;
}

/**
 * Validate and repair a ScaffoldData before topological sort and code generation.
 *
 * Rules run in order:
 *   4. Self-references removed (prevents in-degree inflation)
 *   1. Phantom deps removed (deps pointing to files not in the scaffold)
 *   2. Phantom hints path references replaced with inline note
 *   3. Cycles broken via reverse-flow heuristic (high-in-degree → low-in-degree edge removed)
 *
 * Returns a new ScaffoldData (immutable) plus a warnings list describing every change made.
 * If no issues are found, returns the original scaffold unchanged and an empty warnings array.
 */
export function validateScaffold(raw: ScaffoldData): ScaffoldValidationResult {
  const warnings: string[] = [];
  let files: readonly ScaffoldFile[] = raw.files;

  // Rule 4: remove self-references (before in-degree calculation)
  files = files.map((f) => {
    const cleanedDeps = f.deps.filter((d) => d !== f.path);
    if (cleanedDeps.length === f.deps.length) return f;
    warnings.push(`移除自引用: ${f.path}`);
    return { ...f, deps: cleanedDeps };
  });

  // Rule 1: remove phantom deps
  const allPaths = new Set(files.map((f) => f.path));
  files = files.map((f) => {
    const validDeps = f.deps.filter(
      (d) => allPaths.has(d) || WHITELISTED_DEPS.has(d)
    );
    const removed = f.deps.filter(
      (d) => !allPaths.has(d) && !WHITELISTED_DEPS.has(d)
    );
    if (removed.length === 0) return f;
    for (const d of removed) {
      warnings.push(`移除幽灵依赖: ${f.path} → ${d}`);
    }
    return { ...f, deps: validDeps };
  });

  // Rule 2: clean hints path references
  const HINTS_PATH_RE = /\/[\w\-\/]+\.(js|jsx|ts|tsx)/g;
  files = files.map((f) => {
    const phantomPaths: string[] = [];
    const cleanedHints = f.hints.replace(HINTS_PATH_RE, (match) => {
      if (allPaths.has(match) || WHITELISTED_DEPS.has(match)) return match;
      phantomPaths.push(match);
      return "(在当前文件内实现)";
    });
    if (phantomPaths.length === 0) return f;
    for (const p of phantomPaths) {
      warnings.push(`hints 引用了不存在的文件: ${p}`);
    }
    return { ...f, hints: cleanedHints };
  });

  // Rule 3: detect and break cycles (reverse-flow heuristic)
  files = breakCycles(files, warnings);

  // Rule 5: validate removeFiles — entries must not also appear in files array
  let removeFiles = raw.removeFiles;
  if (removeFiles && removeFiles.length > 0) {
    const scaffoldPaths = new Set(files.map((f) => f.path));
    const conflicting = removeFiles.filter((p) => scaffoldPaths.has(p));
    if (conflicting.length > 0) {
      for (const p of conflicting) {
        warnings.push(`removeFiles 与 scaffold files 冲突: ${p}（已从 removeFiles 移除）`);
      }
      removeFiles = removeFiles.filter((p) => !scaffoldPaths.has(p));
    }
  }

  // Rule 6: clamp maxLines to [50, 500]
  files = files.map((f) => {
    if (f.maxLines === undefined) return f;
    if (f.maxLines < 50) {
      warnings.push(`maxLines 过小: ${f.path} (${f.maxLines} → 50)`);
      return { ...f, maxLines: 50 };
    }
    if (f.maxLines > 500) {
      warnings.push(`maxLines 过大: ${f.path} (${f.maxLines} → 500)`);
      return { ...f, maxLines: 500 };
    }
    return f;
  });

  // Rule 7: strip blacklisted dependencies
  let dependencies = raw.dependencies;
  if (dependencies) {
    const cleaned: Record<string, string> = {};
    for (const [pkg, ver] of Object.entries(dependencies)) {
      const basePkg = pkg.startsWith("@")
        ? pkg.split("/").slice(0, 2).join("/")
        : pkg.split("/")[0];
      if (BLOCKED_PACKAGES.has(basePkg)) {
        warnings.push(`移除黑名单依赖: ${pkg}`);
      } else {
        cleaned[pkg] = ver;
      }
    }
    dependencies = Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  return {
    scaffold: {
      ...raw,
      files,
      ...(removeFiles !== undefined ? { removeFiles } : {}),
      ...(dependencies !== undefined ? { dependencies } : {}),
    },
    warnings,
  };
}
