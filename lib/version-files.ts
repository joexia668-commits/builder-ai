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
