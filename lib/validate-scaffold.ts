import type { ScaffoldData, ScaffoldFile, ScaffoldValidationResult } from "@/lib/types";

// /supabaseClient.js is a virtual file injected by buildSandpackConfig at runtime —
// it is never part of the Architect scaffold but is always available to generated code.
const WHITELISTED_DEPS = new Set(["/supabaseClient.js"]);

/**
 * Validate and repair a ScaffoldData before topological sort and code generation.
 *
 * Rules run in order:
 *   4. Self-references removed (prevents in-degree inflation)
 *   1. Phantom deps removed (deps pointing to files not in the scaffold)
 *   2. Phantom hints path references replaced with inline note
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

  return {
    scaffold: { ...raw, files },
    warnings,
  };
}
