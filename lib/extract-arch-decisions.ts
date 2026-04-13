import type { ScaffoldData, ScaffoldFile, ArchDecisions } from "@/lib/types";

/**
 * Deterministically extracts architectural decisions from a ScaffoldData.
 * Zero LLM calls — pure code analysis of the scaffold structure.
 */
export function extractArchDecisions(scaffold: ScaffoldData): ArchDecisions {
  return {
    fileCount: scaffold.files.length,
    componentTree: buildComponentTree(scaffold.files),
    stateStrategy: inferStateStrategy(scaffold.designNotes),
    persistenceSetup: inferPersistenceSetup(scaffold),
    keyDecisions: extractKeyDecisions(scaffold.designNotes),
  };
}

/**
 * Builds a human-readable tree string from the deps graph.
 * Root nodes = files that no other file imports.
 */
function buildComponentTree(files: readonly ScaffoldFile[]): string {
  const allPaths = new Set(files.map((f) => f.path));
  const imported = new Set(files.flatMap((f) => f.deps));
  const roots = files.filter((f) => !imported.has(f.path));

  if (roots.length === 0) {
    return files.map((f) => fileName(f.path)).join(", ");
  }

  const fileMap = new Map(files.map((f) => [f.path, f]));

  function buildSubtree(path: string, visited: Set<string>): string {
    const name = fileName(path);
    if (visited.has(path)) return name;
    visited.add(path);

    const file = fileMap.get(path);
    if (!file) return name;

    const children = file.deps.filter((d) => allPaths.has(d));
    if (children.length === 0) return name;

    const childStrings = children.map((c) => buildSubtree(c, new Set(visited)));
    return `${name} -> [${childStrings.join(", ")}]`;
  }

  return roots.map((r) => buildSubtree(r.path, new Set())).join(", ");
}

function fileName(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(js|jsx|ts|tsx)$/, "");
}

function inferStateStrategy(designNotes: string): string {
  const lower = designNotes.toLowerCase();
  if (lower.includes("usereducer")) return "useReducer";
  if (lower.includes("context")) return "context";
  if (lower.includes("usestate")) return "useState";
  return "unknown";
}

function inferPersistenceSetup(scaffold: ScaffoldData): string {
  const hasSupabaseDep = scaffold.files.some((f) =>
    f.deps.some((d) => d.includes("supabaseClient"))
  );
  if (hasSupabaseDep) return "supabase";

  const lower = scaffold.designNotes.toLowerCase();
  if (lower.includes("localstorage")) return "localStorage";

  return "none";
}

function extractKeyDecisions(designNotes: string): readonly string[] {
  if (!designNotes.trim()) return [];
  return designNotes
    .split(/[。.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 5);
}
