import type { PmOutput, ArchOutput } from "@/lib/types";

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
    return JSON.parse(stripFences(trimmed));
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
