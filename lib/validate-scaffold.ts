import type { ScaffoldData, ScaffoldFile, ScaffoldValidationResult } from "@/lib/types";

const WHITELISTED_DEPS = new Set(["/supabaseClient.js"]);

export function validateScaffold(raw: ScaffoldData): ScaffoldValidationResult {
  const warnings: string[] = [];
  let files: readonly ScaffoldFile[] = raw.files;

  // Rule 4: remove self-references (before in-degree calculation)
  files = files.map((f) => {
    const selfDeps = f.deps.filter((d) => d === f.path);
    if (selfDeps.length === 0) return f;
    warnings.push(`移除自引用: ${f.path}`);
    return { ...f, deps: f.deps.filter((d) => d !== f.path) };
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

  return {
    scaffold: { ...raw, files },
    warnings,
  };
}
