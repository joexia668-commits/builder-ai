import type { ChangedFiles } from "@/lib/types";

/**
 * Unified reader for Version records.
 * New versions have `files` (Record<string, string>).
 * Old versions only have `code` (string) — wrapped as { "/App.js": code }.
 */
export function getVersionFiles(
  version: { code: string; files?: Record<string, string> | null }
): Record<string, string> {
  if (version.files) return version.files as Record<string, string>;
  return { "/App.js": version.code };
}

/**
 * Compute file-level diff between two version snapshots.
 * Stores full content of added/modified files (not line-level diff),
 * because LLM-generated code typically rewrites entire files.
 */
export function computeChangedFiles(
  prevFiles: Record<string, string> | null,
  newFiles: Record<string, string>
): ChangedFiles {
  const prev = prevFiles ?? {};
  const added: Record<string, string> = {};
  const modified: Record<string, string> = {};
  const removed: string[] = [];

  for (const [path, content] of Object.entries(newFiles)) {
    if (!(path in prev)) {
      added[path] = content;
    } else if (prev[path] !== content) {
      modified[path] = content;
    }
  }

  for (const path of Object.keys(prev)) {
    if (!(path in newFiles)) {
      removed.push(path);
    }
  }

  return { added, modified, removed };
}
