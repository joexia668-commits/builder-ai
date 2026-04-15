import type { DecomposerOutput, ModuleDefinition } from "@/lib/types";
export { buildDecomposerContext } from "@/lib/agent-context";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) from raw LLM output.
 */
function stripFences(raw: string): string {
  const fenceMatch = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  return fenceMatch ? fenceMatch[1].trim() : raw.trim();
}

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty input");
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(stripFences(trimmed));
    } catch {
      // Try to extract JSON object from mixed content
      const jsonMatch = trimmed.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      throw new Error("No valid JSON found");
    }
  }
}

function isModuleDefinition(val: unknown): val is ModuleDefinition {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim() === "") return false;
  if (typeof obj.description !== "string") return false;
  if (typeof obj.estimatedFiles !== "number") return false;
  if (!Array.isArray(obj.deps)) return false;
  if (typeof obj.interface !== "object" || obj.interface === null) return false;
  const iface = obj.interface as Record<string, unknown>;
  if (!Array.isArray(iface.exports)) return false;
  if (!Array.isArray(iface.consumes)) return false;
  if (typeof iface.stateContract !== "string") return false;
  return true;
}

function isDecomposerOutput(val: unknown): val is DecomposerOutput {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;

  // Validate skeleton
  if (typeof obj.skeleton !== "object" || obj.skeleton === null) return false;
  const skeleton = obj.skeleton as Record<string, unknown>;
  if (typeof skeleton.description !== "string") return false;
  if (!Array.isArray(skeleton.files)) return false;
  if (typeof skeleton.sharedTypes !== "string") return false;

  // Validate modules
  if (!Array.isArray(obj.modules)) return false;
  if (!obj.modules.every(isModuleDefinition)) return false;

  // Validate generateOrder
  if (!Array.isArray(obj.generateOrder)) return false;
  for (const layer of obj.generateOrder) {
    if (!Array.isArray(layer)) return false;
    if (!layer.every((item) => typeof item === "string")) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Parses LLM output (may be wrapped in markdown fences) into a DecomposerOutput.
 * Returns null if parsing fails or required fields are missing.
 */
export function parseDecomposerOutput(raw: string): DecomposerOutput | null {
  try {
    const parsed = tryParseJson(raw);
    if (!isDecomposerOutput(parsed)) return null;
    return parsed as DecomposerOutput;
  } catch {
    return null;
  }
}

/**
 * Validates and cleans a DecomposerOutput:
 * - Clamps modules to max 5
 * - Clamps estimatedFiles per module to max 8
 * - Removes phantom deps (deps referencing non-existent module names)
 * - Filters generateOrder to only include valid module names
 */
export function validateDecomposerOutput(output: DecomposerOutput): DecomposerOutput {
  const MAX_MODULES = 5;
  const MAX_FILES_PER_MODULE = 8;

  // Clamp modules to max 5
  const clampedModules = output.modules.slice(0, MAX_MODULES);
  const validModuleNames = new Set(clampedModules.map((m) => m.name));

  // Clamp estimatedFiles and remove phantom deps
  const cleanedModules: ModuleDefinition[] = clampedModules.map((m) => ({
    ...m,
    estimatedFiles: Math.min(m.estimatedFiles, MAX_FILES_PER_MODULE),
    deps: m.deps.filter((dep) => validModuleNames.has(dep)),
  }));

  // Filter generateOrder to only include valid module names; remove empty layers
  const cleanedOrder = output.generateOrder
    .map((layer) => layer.filter((name) => validModuleNames.has(name)))
    .filter((layer) => layer.length > 0);

  return {
    skeleton: output.skeleton,
    modules: cleanedModules,
    generateOrder: cleanedOrder,
  };
}

