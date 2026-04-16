import type { ExportEntry } from "@/lib/types";

const EXPORT_PATTERNS: Array<{ re: RegExp; kind: ExportEntry["kind"] }> = [
  { re: /export\s+default\s+function\s+(\w+)/g, kind: "default" },
  { re: /export\s+default\s+class\s+(\w+)/g, kind: "default" },
  { re: /export\s+(?:async\s+)?function\s+(\w+)/g, kind: "function" },
  { re: /export\s+class\s+(\w+)/g, kind: "class" },
  { re: /export\s+(?:const|let|var)\s+(\w+)/g, kind: "const" },
  { re: /export\s+interface\s+(\w+)/g, kind: "interface" },
  { re: /export\s+type\s+(\w+)(?!\s*\{)/g, kind: "type" },
];

export function extractStructuredExports(
  files: Record<string, string>
): ExportEntry[] {
  const results: ExportEntry[] = [];
  const seen = new Set<string>();

  for (const [filePath, code] of Object.entries(files)) {
    for (const { re, kind } of EXPORT_PATTERNS) {
      const regex = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = regex.exec(code)) !== null) {
        const name = m[1];
        const key = `${name}:${filePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ name, kind, filePath });
      }
    }
  }

  return results;
}
