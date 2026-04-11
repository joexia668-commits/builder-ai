import type { PmOutput, ArchOutput, ScaffoldData, ScaffoldFile } from "@/lib/types";

// Strip markdown code fences (```json ... ``` or ``` ... ```) from raw LLM output.
function stripFences(raw: string): string {
  const fenceMatch = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/m);
  return fenceMatch ? fenceMatch[1].trim() : raw.trim();
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(stripFences(trimmed));
    } catch {
      // Try to extract JSON object from mixed content (e.g., "<thinking>...</thinking>\n{...}")
      const jsonMatch = trimmed.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      throw new Error("No valid JSON found");
    }
  }
}

function isPmOutput(val: unknown): val is PmOutput {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;

  if (typeof obj.intent !== "string" || obj.intent.trim() === "") return false;
  if (!Array.isArray(obj.features) || obj.features.length === 0) return false;
  if (!obj.features.every((f) => typeof f === "string")) return false;
  if (!["none", "localStorage", "supabase"].includes(obj.persistence as string)) return false;
  if (!Array.isArray(obj.modules)) return false;
  if (!obj.modules.every((m) => typeof m === "string")) return false;

  if (obj.dataModel !== undefined) {
    if (!Array.isArray(obj.dataModel)) return false;
    if (!obj.dataModel.every((d) => typeof d === "string")) return false;
  }

  return true;
}

function isArchOutput(val: unknown): val is ArchOutput {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;

  if (!Array.isArray(obj.components) || obj.components.length === 0) return false;
  if (!obj.components.every((c) => typeof c === "string")) return false;
  if (typeof obj.state !== "string" || obj.state.trim() === "") return false;

  if (obj.storage !== undefined && typeof obj.storage !== "string") return false;
  if (obj.icons !== undefined) {
    if (!Array.isArray(obj.icons)) return false;
    if (!obj.icons.every((i) => typeof i === "string")) return false;
  }

  return true;
}

export function extractPmOutput(raw: string): PmOutput | null {
  try {
    const parsed = parseJson(raw);
    if (!isPmOutput(parsed)) return null;
    return Object.freeze({ ...parsed }) as PmOutput;
  } catch {
    return null;
  }
}

export function extractArchOutput(raw: string): ArchOutput | null {
  try {
    const parsed = parseJson(raw);
    if (!isArchOutput(parsed)) return null;
    return Object.freeze({ ...parsed }) as ArchOutput;
  } catch {
    return null;
  }
}

function isScaffoldFile(val: unknown): val is ScaffoldFile {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj.path !== "string" || obj.path.trim() === "") return false;
  if (typeof obj.description !== "string") return false;
  if (!Array.isArray(obj.exports)) return false;
  if (!Array.isArray(obj.deps)) return false;
  if (typeof obj.hints !== "string") return false;
  return true;
}

function isScaffoldData(val: unknown): val is ScaffoldData {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (!Array.isArray(obj.files) || obj.files.length === 0) return false;
  if (!obj.files.every(isScaffoldFile)) return false;
  if (typeof obj.sharedTypes !== "string") return false;
  if (typeof obj.designNotes !== "string") return false;
  return true;
}

export function extractScaffold(raw: string): ScaffoldData | null {
  try {
    const parsed = parseJson(raw);
    if (!isScaffoldData(parsed)) return null;
    return parsed as ScaffoldData;
  } catch {
    return null;
  }
}

/**
 * Locate `"files": [ ... ]` in raw text and return a parseable array span.
 *
 * Walks the text with JSON string-literal awareness and tracks bracket depth.
 * Two success modes:
 *   1. Array closes normally — return the full `[...]` slice
 *   2. Input is truncated — synthesize a closing `]` at the end of the last
 *      fully-completed top-level object `}` (depth 1→depth 0 inside array),
 *      dropping any partial tail element.
 *
 * Returns null if we cannot locate the opening `[` or not even one top-level
 * element was fully written before truncation.
 */
function locateFilesArrayText(raw: string): string | null {
  const keyRe = /"files"\s*:\s*\[/g;
  const keyMatch = keyRe.exec(raw);
  if (!keyMatch) return null;

  const start = keyRe.lastIndex - 1; // position of `[`
  // Depth semantics: 0 = before `[`, 1 = inside array between elements,
  // 2 = inside a top-level file object, >2 = nested.
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteElementEnd = -1; // index of the last `}` where depth went 2→1

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[" || ch === "{") {
      depth++;
    } else if (ch === "]" || ch === "}") {
      const wasDepth = depth;
      depth--;
      if (depth === 0 && ch === "]") {
        // Array closed cleanly
        return raw.slice(start, i + 1);
      }
      if (wasDepth === 2 && ch === "}" && depth === 1) {
        // A top-level file object just completed
        lastCompleteElementEnd = i;
      }
    }
  }

  // Truncated: synthesize a closing `]` after the last complete element.
  if (lastCompleteElementEnd > start) {
    return raw.slice(start, lastCompleteElementEnd + 1) + "]";
  }
  return null;
}

/**
 * Salvage path: if strict JSON.parse fails (typically because the tail of
 * the scaffold — sharedTypes / designNotes / closing `}` — was truncated by
 * a stream abort), try to recover just the `files` array. Returns a
 * ScaffoldData with empty sharedTypes / designNotes if at least one valid
 * file entry can be parsed.
 */
function salvageScaffold(raw: string): ScaffoldData | null {
  const arrayText = locateFilesArrayText(raw);
  if (!arrayText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every(isScaffoldFile)) return null;

  return {
    files: parsed as ScaffoldFile[],
    sharedTypes: "",
    designNotes: "",
  };
}

export function extractScaffoldFromTwoPhase(raw: string): ScaffoldData | null {
  const outputMatch = raw.match(/<output>\s*([\s\S]*?)\s*<\/output>/i);
  if (outputMatch) {
    const result = extractScaffold(outputMatch[1]);
    if (result) return result;
  }
  const full = extractScaffold(raw);
  if (full) return full;

  // Strict parse failed — tail is likely truncated by stream abort.
  // Prefer searching inside the opened <output> region if present,
  // otherwise search the whole raw body.
  const salvageSource = raw.match(/<output>\s*([\s\S]*)/i)?.[1] ?? raw;
  return salvageScaffold(salvageSource);
}
