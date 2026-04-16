import type { PartialExtractResult, ImportExportMismatch, DisallowedImport, LucideIconFix, Scene } from "@/lib/types";
import { LUCIDE_ICON_NAMES } from "@/lib/lucide-icon-names";

/**
 * Strip single-line (//) and multi-line (/* *\/) comments from code,
 * while leaving string literals and template literals untouched.
 * This reduces token bloat from LLM-generated comments without touching logic.
 */
export function stripComments(code: string): string {
  let result = "";
  let i = 0;
  while (i < code.length) {
    // Single-line comment
    if (code[i] === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    // Multi-line comment (also covers JSX {/* */} — the braces are handled outside)
    if (code[i] === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // String literals — skip contents verbatim to avoid false comment detection
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      result += code[i++];
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") result += code[i++]; // escape char
        result += code[i++];
      }
      if (i < code.length) result += code[i++]; // closing quote
      continue;
    }
    // Template literals — skip contents verbatim
    if (code[i] === "`") {
      result += code[i++];
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") result += code[i++];
        result += code[i++];
      }
      if (i < code.length) result += code[i++];
      continue;
    }
    result += code[i++];
  }
  return result;
}

/**
 * If a generated JS/TS file contains more than one bare `export default X;`
 * re-export line, keep only the last one and remove the earlier ones.
 *
 * This fixes a common feature_add artifact where the Engineer copies the
 * original file's trailing `export default X;` into the middle of the new
 * output, then also emits a new default export at the end.
 */
export function deduplicateDefaultExport(code: string): string {
  // Matches standalone re-export lines: `export default identifier;`
  const re = /^export default \w+;[ \t]*\n?/gm;
  const matches = Array.from(code.matchAll(re));
  if (matches.length <= 1) return code;

  let seen = 0;
  const total = matches.length;
  return code.replace(re, (match) => {
    seen++;
    return seen < total ? "" : match;
  });
}

/** Check that all three delimiter pairs are balanced. */
export function isDelimitersBalanced(code: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (const ch of code) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
    if (braces < 0 || parens < 0 || brackets < 0) return false;
  }
  return braces === 0 && parens === 0 && brackets === 0;
}

/**
 * Detect unclosed string literals (' " `) or unclosed multi-line comments.
 * Uses a character-level state machine mirroring stripComments().
 * Returns true if the code contains an unterminated literal — indicating
 * the LLM output was truncated mid-string or mid-comment.
 *
 * Note: template literal `${...}` expression nesting is not tracked — deeply
 * nested backticks inside `${}` may produce false negatives in pathological cases.
 * For LLM truncation detection (the primary use case), this is acceptable.
 */
export function hasUnterminatedLiteral(code: string): boolean {
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // Single-line comment — skip to end of line
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }

    // Multi-line comment — skip to */
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      if (i >= code.length) return true;
      i += 2;
      continue;
    }

    // Single/double-quoted string
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < code.length && code[i] !== quote && code[i] !== "\n") {
        if (code[i] === "\\") i++;
        i++;
      }
      if (i >= code.length || code[i] === "\n") return true;
      i++;
      continue;
    }

    // Template literal
    if (ch === "`") {
      i++;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") i++;
        i++;
      }
      if (i >= code.length) return true;
      i++;
      continue;
    }

    i++;
  }
  return false;
}

/**
 * Check whether extracted code is structurally complete:
 *   1. Contains `export default` (present naturally or appended by caller)
 *   2. All delimiter pairs are balanced — `{}` `()` `[]` open count === close count
 *
 * Returns false when the LLM output was truncated mid-generation.
 */
function isCodeComplete(code: string): boolean {
  if (!code.includes("export default")) return false;
  return isDelimitersBalanced(code);
}

/**
 * Extract React component code from LLM output.
 *
 * Three-layer extraction strategy (priority descending):
 *   1. Markdown fence — precise capture of fenced content
 *   2. Head location  — start from `import ` or `export default`
 *   3. Tail truncation — strip explanation text after last `}`
 *
 * If no `export default` remains after extraction, one is appended.
 * Returns null if the extracted code fails the completeness check
 * (unbalanced braces — indicates the LLM output was truncated).
 */
export function extractReactCode(raw: string): string | null {
  const stripped = stripComments(raw);

  // Layer 0: annotated fence (```jsx filename=App.jsx or similar) — highest priority
  // Requires a non-newline annotation token after the language tag (e.g., filename=, title=)
  const annotatedFenceMatch = stripped.match(/```(?:jsx?|tsx?) [^\n]+\n([\s\S]*?)```/);
  if (annotatedFenceMatch?.[1]) {
    const candidate = annotatedFenceMatch[1].trim();
    if (isCodeComplete(candidate)) return candidate;
    // Truncated inside annotated fence — fall through to other layers
  }

  // Layer 1: fence match (jsx/js/tsx/ts or bare fence)
  const fenceMatch =
    stripped.match(/```(?:jsx?|tsx?)\n([\s\S]*?)```/) ??
    stripped.match(/```\n([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim();
    if (isCodeComplete(candidate)) return candidate;
    // Truncated inside fence — fall through to head/tail extraction
  }

  // Layer 2: head location
  let code = stripped;
  const importIdx = code.indexOf('import ');
  const exportIdx = code.indexOf('export default');
  if (importIdx >= 0) {
    code = code.substring(importIdx);
  } else if (exportIdx >= 0) {
    code = code.substring(exportIdx);
  }

  // Layer 3: tail truncation — strip everything after last `}`
  const lastBrace = code.lastIndexOf('}');
  if (lastBrace >= 0) {
    code = code.substring(0, lastBrace + 1);
  }

  // Ensure export default exists
  if (!code.includes('export default')) {
    code += '\nexport default App;';
  }

  const trimmed = code.trim();
  return isCodeComplete(trimmed) ? trimmed : null;
}

/**
 * Extract all `// === FILE: /path ===` blocks from LLM output without requiring
 * specific paths to be present. Used for the direct bug-fix / style-change path
 * where the LLM only emits modified files.
 *
 * @returns Record of path → code for every block found, or null if none found
 *          or any block has unbalanced braces.
 */
export function extractAnyMultiFileCode(
  raw: string
): Record<string, string> | null {
  // Primary: standard FILE marker format
  const result = extractAnyMultiFileCodeByMarker(raw);
  if (result !== null) return result;

  // Fallback: Markdown fenced blocks with a path comment on the first line
  // e.g.  ```jsx\n// /App.js\nimport React ...\n```
  return extractAnyMultiFileCodeFromMarkdown(raw);
}

function extractAnyMultiFileCodeByMarker(
  raw: string
): Record<string, string> | null {
  const marker = /^\/\/ === FILE: (.+?)(?:\s*===)?$/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1].trim();
      fileMap[currentPath] = [];
    } else if (currentPath !== null) {
      fileMap[currentPath].push(line);
    }
  }

  if (Object.keys(fileMap).length === 0) return null;

  const result: Record<string, string> = {};
  const paths = Object.keys(fileMap);
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const code = deduplicateDefaultExport(fileMap[path].join("\n").trim());
    if (!isDelimitersBalanced(code)) {
      // Last file truncated mid-stream — salvage everything before it
      if (i === paths.length - 1 && Object.keys(result).length > 0) break;
      return null;
    }
    result[path] = code;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function extractAnyMultiFileCodeFromMarkdown(
  raw: string
): Record<string, string> | null {
  // Match fenced code blocks: ```[lang]\n// /path/to/file.ext\n<code>\n```
  const fenceRe = /```[a-z]*\n([\s\S]*?)```/g;
  const pathCommentRe = /^\/\/\s*(\/\S+\.[a-zA-Z]+)/;
  const result: Record<string, string> = {};
  let m: RegExpExecArray | null;

  while ((m = fenceRe.exec(raw)) !== null) {
    const block = m[1];
    const firstLine = block.split("\n")[0].trim();
    const pathMatch = firstLine.match(pathCommentRe);
    if (!pathMatch) continue;
    const path = pathMatch[1];
    // Strip the path comment line, keep the rest as code
    const code = deduplicateDefaultExport(
      block.split("\n").slice(1).join("\n").trim()
    );
    if (!isDelimitersBalanced(code)) continue;
    result[path] = code;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract multiple files from LLM output using FILE separator markers.
 *
 * Expected format:
 *   // === FILE: /path/to/file.js ===
 *   (code for file)
 *   // === FILE: /another/file.js ===
 *   (code for file)
 *
 * @param raw - Raw LLM output text
 * @param expectedFiles - List of file paths that must be present
 * @returns Record mapping path to code, or null if any file is missing or incomplete
 */
export function extractMultiFileCode(
  raw: string,
  expectedFiles: readonly string[]
): Record<string, string> | null {
  if (expectedFiles.length === 0) return {};

  const marker = /^\/\/ === FILE: (.+?)(?:\s*===)?$/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1].trim();
      fileMap[currentPath] = [];
    } else if (currentPath !== null) {
      fileMap[currentPath].push(line);
    }
  }

  const result: Record<string, string> = {};

  for (const path of expectedFiles) {
    const codeLines = fileMap[path];
    if (!codeLines) return null;

    const code = deduplicateDefaultExport(codeLines.join("\n").trim());
    // For multi-file: check all delimiter balance (individual files don't need export default)
    if (!isDelimitersBalanced(code)) return null;

    result[path] = code;
  }

  return result;
}

/**
 * Parse multi-file engineer output and return a partial-salvage result:
 *   - ok:   files that are present, have balanced delimiters, and no unterminated literals
 *   - failed: expected files that are missing, delimiter-unbalanced, or have unterminated literals
 *   - truncatedTail: last ~200 chars of raw input when any file failed, else null
 *
 * Unlike extractMultiFileCode (which returns null on any failure), this keeps
 * successfully-parsed files so the caller can retry only the failed subset.
 */
export function extractMultiFileCodePartial(
  raw: string,
  expectedFiles: readonly string[]
): PartialExtractResult {
  if (expectedFiles.length === 0) {
    return { ok: {}, failed: [], truncatedTail: null };
  }

  const marker = /^\/\/ === FILE: (.+?)(?:\s*===)?$/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1].trim();
      fileMap[currentPath] = [];
    } else if (currentPath !== null) {
      fileMap[currentPath].push(line);
    }
  }

  const ok: Record<string, string> = {};
  const failed: string[] = [];

  for (const path of expectedFiles) {
    const codeLines = fileMap[path];
    if (!codeLines) {
      failed.push(path);
      continue;
    }
    const code = deduplicateDefaultExport(codeLines.join("\n").trim());
    if (!isDelimitersBalanced(code)) {
      failed.push(path);
      continue;
    }
    if (hasUnterminatedLiteral(code)) {
      failed.push(path);
      continue;
    }
    ok[path] = code;
  }

  const truncatedTail =
    failed.length > 0
      ? raw.slice(Math.max(0, raw.length - 200))
      : null;

  return { ok, failed, truncatedTail };
}

const WHITELISTED_LOCAL = new Set(["/supabaseClient.js"]);

/**
 * Resolve a relative import path (./foo or ../foo) against the importing file's
 * directory. Absolute paths (/foo) are returned as-is.
 */
function resolveImportPath(importPath: string, fromFile: string): string {
  if (importPath.startsWith("/")) return importPath;
  // Get directory of the importing file: "/views/App.js" → "/views"
  const dirParts = fromFile.split("/").slice(0, -1);
  for (const seg of importPath.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (dirParts.length > 1) dirParts.pop();
    } else {
      dirParts.push(seg);
    }
  }
  return dirParts.join("/") || "/";
}

/**
 * Scan all generated files for imports of local paths ('/...' or './...' or '../...')
 * that are not present in the files map. Returns a Map from missing absolute path
 * to the set of named exports required from that path (empty set = only default/namespace import).
 * /supabaseClient.js is always whitelisted (it is injected by PreviewFrame at runtime).
 */
export function findMissingLocalImportsWithNames(
  files: Readonly<Record<string, string>>
): Map<string, Set<string>> {
  const presentPaths = new Set(Object.keys(files));
  const missing = new Map<string, Set<string>>();

  const ensurePath = (path: string) => {
    if (!missing.has(path)) missing.set(path, new Set());
  };

  // Regex matches: import [Default,] { Foo, Bar as B } from '/path' or './path' or '../path'
  const namedImportRe = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s+from\s+['"](\.[./][^'"]*|\/[^'"]+)['"]/g;

  for (const [filePath, code] of Object.entries(files)) {
    // Pass 1: extract named import specifiers per path
    for (const m of Array.from(code.matchAll(namedImportRe))) {
      const resolved = resolveImportPath(m[2], filePath);
      if (!WHITELISTED_LOCAL.has(resolved) && !presentPaths.has(resolved)) {
        ensurePath(resolved);
        for (const token of m[1].split(",")) {
          const raw = token.trim();
          if (!raw) continue;
          // "Foo as Bar" → use original export name "Foo"
          const name = raw.split(/\s+as\s+/)[0].trim();
          if (name && /^[a-zA-Z_$][\w$]*$/.test(name)) {
            missing.get(resolved)!.add(name);
          }
        }
      }
    }

    // Pass 2: catch default/namespace imports to ensure the path is tracked
    for (const m of Array.from(code.matchAll(/from\s+['"](\.[./][^'"]*|\/[^'"]+)['"]/g))) {
      const resolved = resolveImportPath(m[1], filePath);
      if (!WHITELISTED_LOCAL.has(resolved) && !presentPaths.has(resolved)) {
        ensurePath(resolved);
      }
    }
  }

  return missing;
}

/**
 * Scan all generated files for imports of local paths ('/...', './...', '../...')
 * that are not present in the files map. Returns a deduplicated list of missing
 * absolute paths. /supabaseClient.js is always whitelisted (injected by PreviewFrame).
 */
export function findMissingLocalImports(
  files: Readonly<Record<string, string>>
): string[] {
  const presentPaths = new Set(Object.keys(files));
  const missing = new Set<string>();

  for (const [filePath, code] of Object.entries(files)) {
    for (const match of Array.from(code.matchAll(/from\s+['"](\.[./][^'"]*|\/[^'"]+)['"]/g))) {
      const resolved = resolveImportPath(match[1], filePath);
      if (!WHITELISTED_LOCAL.has(resolved) && !presentPaths.has(resolved)) {
        missing.add(resolved);
      }
    }
  }

  return Array.from(missing);
}

/**
 * Extract all named and default exports from a JS/TS code string.
 * Skips `export type` declarations — TypeScript type-only, no runtime effect.
 *
 * Named exports detected:
 *   export function/async function/class/const/let/var Name
 *   export { Foo }
 *   export { Foo as Bar }  → captures external name Bar
 *
 * Default export detected:
 *   export default ... (any form)
 */
export function extractFileExports(code: string): { named: Set<string>; hasDefault: boolean } {
  const named = new Set<string>();
  let hasDefault = false;

  // export default (any form)
  if (/\bexport\s+default\b/.test(code)) hasDefault = true;

  // export function/async function*/class/const/let/var Name — skip "export type ..."
  const declRe = /\bexport\s+(?!type\b)(?:async\s+)?(?:function\*?|class|const|let|var)\s+([$\w]+)/g;
  let dm: RegExpExecArray | null;
  while ((dm = declRe.exec(code)) !== null) named.add(dm[1]);

  // export { Foo, Bar as Baz } — skip export type { ... }
  const braceRe = /\bexport\s+(type\s+)?\{([^}]*)\}/g;
  let bm: RegExpExecArray | null;
  while ((bm = braceRe.exec(code)) !== null) {
    const m = bm;
    if (m[1]) continue; // type-only export, skip
    for (const token of m[2].split(",")) {
      const raw = token.trim();
      if (!raw) continue;
      // "Foo as Bar" → external name is Bar
      const parts = raw.split(/\s+as\s+/);
      const external = (parts.length > 1 ? parts[1] : parts[0]).trim();
      if (external && /^[$\w]+$/.test(external)) named.add(external);
    }
  }

  return { named, hasDefault };
}

/**
 * Extract all imports of local paths (starting with '/') from a JS/TS code string.
 * Skips `import type` declarations and external packages.
 *
 * Returns one entry per local path with:
 *   - named: external names being imported (the name as exported by the source file)
 *            e.g. `import { Foo as F }` → named contains "Foo"
 *   - hasDefault: true if there is a default import from that path
 */
export function extractFileImports(
  code: string
): Array<{ path: string; named: string[]; hasDefault: boolean }> {
  const byPath = new Map<string, { named: string[]; hasDefault: boolean }>();

  const ensure = (path: string) => {
    if (!byPath.has(path)) byPath.set(path, { named: [], hasDefault: false });
    return byPath.get(path)!;
  };

  // import [Default,] { Named } from '/path' — skip "import type ..."
  const namedRe =
    /\bimport\s+(?!type\b)(?:([$\w]+)\s*,\s*)?\{([^}]*)\}\s+from\s+['"](\/.+?)['"]/g;
  let nm: RegExpExecArray | null;
  while ((nm = namedRe.exec(code)) !== null) {
    const entry = ensure(nm[3]);
    if (nm[1]) entry.hasDefault = true; // "Default," prefix present
    for (const token of nm[2].split(",")) {
      const raw = token.trim();
      if (!raw) continue;
      // "Foo as Bar" → external name from the source is "Foo"
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (name && /^[$\w]+$/.test(name)) entry.named.push(name);
    }
  }

  // import Default from '/path' (no braces — default-only import)
  const defaultRe = /\bimport\s+(?!type\b)([$\w]+)\s+from\s+['"](\/.+?)['"]/g;
  let dfm: RegExpExecArray | null;
  while ((dfm = defaultRe.exec(code)) !== null) {
    ensure(dfm[2]).hasDefault = true;
  }

  return Array.from(byPath.entries()).map(([path, v]) => ({ path, ...v }));
}

/**
 * Cross-file import/export consistency check.
 *
 * For every file in `files`, scans its local imports and verifies that
 * the target file actually exports what is being imported (named or default).
 *
 * Files that are missing entirely from `files` are skipped — they are
 * already handled by findMissingLocalImports / findMissingLocalImportsWithNames.
 *
 * Returns one ImportExportMismatch per (importer, exporter) pair that has
 * at least one missing named export or a missing default export.
 */
export function checkImportExportConsistency(
  files: Readonly<Record<string, string>>
): ImportExportMismatch[] {
  const mismatches: ImportExportMismatch[] = [];

  for (const [importerPath, code] of Object.entries(files)) {
    for (const imp of extractFileImports(code)) {
      const targetCode = files[imp.path];
      if (targetCode === undefined) continue; // missing file handled elsewhere

      const exports = extractFileExports(targetCode);
      const missingNamed = imp.named.filter((n) => !exports.named.has(n));
      const missingDefault = imp.hasDefault && !exports.hasDefault;

      if (missingNamed.length > 0 || missingDefault) {
        mismatches.push({
          importerPath,
          exporterPath: imp.path,
          missingNamed,
          missingDefault,
        });
      }
    }
  }

  return mismatches;
}

// Packages that cannot run in the Sandpack browser sandbox. Everything else is allowed.
export const BLOCKED_PACKAGES = new Set([
  // Node native modules
  "fs", "path", "child_process", "crypto", "os", "net", "http", "https",
  // Requires native compilation
  "sharp", "canvas", "puppeteer", "playwright", "better-sqlite3",
  // Oversized (>5MB)
  "three", "tensorflow", "@tensorflow/tfjs",
  // Server-only frameworks
  "express", "fastify", "koa", "next", "prisma",
]);

/**
 * Scan generated files for imports of external packages not available in Sandpack.
 * Skips local paths (starting with '/' or '.') and `import type` declarations.
 *
 * Returns one entry per (file, package) violation found.
 */
export function checkDisallowedImports(
  files: Readonly<Record<string, string>>,
  sceneTypes: Scene[] = ["general"]
): DisallowedImport[] {
  const violations: DisallowedImport[] = [];

  // Build a scene-based allow list — packages that are normally blocked but
  // are permitted when the detected scene indicates they're appropriate.
  const sceneAllowList = new Set<string>();
  if (sceneTypes.includes("game-engine") || sceneTypes.includes("game")) {
    sceneAllowList.add("phaser");
  }
  if (sceneTypes.includes("dashboard")) {
    sceneAllowList.add("recharts");
  }

  for (const [filePath, code] of Object.entries(files)) {
    // Match: import ... from 'pkg' — external packages only (no leading / or .)
    const importRe =
      /\bimport\s+(?!type\b)[^'"]*from\s+['"]([^./'"'][^'"]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(code)) !== null) {
      const fullPkg = m[1];
      // Resolve base package name (scoped: @scope/pkg → @scope/pkg; else first segment)
      const basePkg = fullPkg.startsWith("@")
        ? fullPkg.split("/").slice(0, 2).join("/")
        : fullPkg.split("/")[0];
      if (BLOCKED_PACKAGES.has(basePkg) && !sceneAllowList.has(basePkg)) {
        violations.push({ filePath, packageName: fullPkg });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Lucide icon auto-fix
// ---------------------------------------------------------------------------

const ICON_SUFFIXES = ["Icon", "Outline", "Solid", "Filled"];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findClosestIcon(name: string): string {
  // 1. Suffix stripping
  for (const suffix of ICON_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const stripped = name.slice(0, -suffix.length);
      if (stripped && LUCIDE_ICON_NAMES.has(stripped)) return stripped;
    }
  }

  // 2. Levenshtein ≤ 3
  let bestMatch = "";
  let bestDist = 4;
  for (const icon of Array.from(LUCIDE_ICON_NAMES)) {
    if (Math.abs(icon.length - name.length) > 3) continue;
    const d = levenshtein(name, icon);
    if (d < bestDist) {
      bestDist = d;
      bestMatch = icon;
    }
  }
  if (bestMatch) return bestMatch;

  // 3. Fallback
  return "CircleAlert";
}

const LUCIDE_IMPORT_RE = /\bimport\s+\{([^}]+)\}\s+from\s+["']lucide-react["']/g;

export function checkUndefinedLucideIcons(
  files: Readonly<Record<string, string>>
): LucideIconFix[] {
  const fixes: LucideIconFix[] = [];

  for (const [filePath, code] of Object.entries(files)) {
    LUCIDE_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LUCIDE_IMPORT_RE.exec(code)) !== null) {
      const names = match[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const originalName = name.split(/\s+as\s+/)[0].trim();
        if (!originalName || LUCIDE_ICON_NAMES.has(originalName)) continue;
        fixes.push({
          filePath,
          original: originalName,
          replacement: findClosestIcon(originalName),
        });
      }
    }
  }

  return fixes;
}

export function applyLucideIconFixes(
  files: Record<string, string>,
  fixes: readonly LucideIconFix[]
): void {
  for (const fix of fixes) {
    if (!files[fix.filePath]) continue;
    const re = new RegExp(`\\b${fix.original}\\b`, "g");
    files[fix.filePath] = files[fix.filePath].replace(re, fix.replacement);
  }
}

// ---------------------------------------------------------------------------
// Redirect phantom type imports to sharedTypes file
// ---------------------------------------------------------------------------

const LOCAL_IMPORT_RE = /from\s+['"](\/(utils|components|lib|helpers|shared)\/types(?:\.ts|\.tsx|\.js)?)['"]/g;

/**
 * Rewrites imports pointing to non-existent type files (e.g. /utils/types,
 * /components/types.ts) to the actual sharedTypes file (/types.ts).
 * LLMs frequently invent these paths instead of using the existing /types.ts.
 * Mutates `files` in place. Returns list of rewrites for logging.
 */
export function redirectPhantomTypeImports(files: Record<string, string>): string[] {
  const existingPaths = new Set(Object.keys(files));
  const rewrites: string[] = [];

  for (const [filePath, code] of Object.entries(files)) {
    const regex = new RegExp(LOCAL_IMPORT_RE.source, LOCAL_IMPORT_RE.flags);
    let changed = false;
    const newCode = code.replace(regex, (match, importPath: string) => {
      // If the file actually exists, don't rewrite
      if (existingPaths.has(importPath)) return match;
      // Also check without extension
      const withoutExt = importPath.replace(/\.(ts|tsx|js|jsx)$/, "");
      for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        if (existingPaths.has(withoutExt + ext)) return match;
      }
      // File doesn't exist — redirect to /types.ts if it exists
      if (existingPaths.has("/types.ts") || existingPaths.has("/types.js")) {
        const target = existingPaths.has("/types.ts") ? "/types.ts" : "/types.js";
        changed = true;
        rewrites.push(`${filePath}: ${importPath} → ${target}`);
        return match.replace(importPath, target);
      }
      return match;
    });
    if (changed) {
      files[filePath] = newCode;
    }
  }

  return rewrites;
}

// ---------------------------------------------------------------------------
// Fix dynamic import of supabaseClient → static import
// ---------------------------------------------------------------------------

const DYNAMIC_SUPABASE_RE = /(?:const|let|var)\s+\{[^}]*supabase[^}]*\}\s*=\s*await\s+import\(\s*['"]\/supabaseClient\.js['"]\s*\)\s*;?/g;

/**
 * Replaces dynamic `const { supabase } = await import("/supabaseClient.js")`
 * with static `import { supabase } from "/supabaseClient.js"`.
 * Vite's import analysis fails on dynamic absolute-path imports, but static
 * imports resolve correctly since the file is injected into WebContainer.
 * Mutates `files` in place. Returns count of fixes.
 */
export function fixDynamicSupabaseImport(files: Record<string, string>): number {
  let fixCount = 0;
  for (const [path, code] of Object.entries(files)) {
    const testRe = new RegExp(DYNAMIC_SUPABASE_RE.source);
    if (!testRe.test(code)) continue;
    const regex = new RegExp(DYNAMIC_SUPABASE_RE.source, DYNAMIC_SUPABASE_RE.flags);
    const hasStaticImport = /import\s+\{[^}]*supabase[^}]*\}\s+from\s+['"]\/supabaseClient\.js['"]/.test(code);
    let newCode = code.replace(regex, "");
    if (!hasStaticImport) {
      // Add static import at top (after any existing imports, or at line 0)
      const lastImportIdx = newCode.lastIndexOf("\nimport ");
      if (lastImportIdx >= 0) {
        const lineEnd = newCode.indexOf("\n", lastImportIdx + 1);
        newCode = newCode.slice(0, lineEnd + 1)
          + 'import { supabase } from "/supabaseClient.js";\n'
          + newCode.slice(lineEnd + 1);
      } else {
        newCode = 'import { supabase } from "/supabaseClient.js";\n' + newCode;
      }
    }
    files[path] = newCode;
    fixCount++;
  }
  return fixCount;
}

// ---------------------------------------------------------------------------
// JSX → TSX auto-rename for files containing TypeScript syntax
// ---------------------------------------------------------------------------

const TS_SYNTAX_IN_JSX_RE = /(?:^|\n)\s*export\s+(?:interface|type)\s+\w+/;

/**
 * Detects .jsx files that contain TypeScript syntax (export interface/type)
 * and renames them to .tsx. Updates import references in all other files.
 * Mutates `files` in place — deletes old keys, adds new keys.
 */
export function fixJsxWithTypeScript(files: Record<string, string>): string[] {
  const renames = new Map<string, string>();
  for (const [path, code] of Object.entries(files)) {
    if (path.endsWith(".jsx") && TS_SYNTAX_IN_JSX_RE.test(code)) {
      renames.set(path, path.replace(/\.jsx$/, ".tsx"));
    }
  }
  if (renames.size === 0) return [];

  // Rename files and update import references
  const renamed: string[] = [];
  const renameEntries = Array.from(renames.entries());
  for (const [oldPath, newPath] of renameEntries) {
    files[newPath] = files[oldPath];
    delete files[oldPath];
    renamed.push(`${oldPath} → ${newPath}`);
  }

  // Update import paths in all files
  const allPaths = Object.keys(files);
  for (const path of allPaths) {
    let code = files[path];
    for (const [oldPath, newPath] of renameEntries) {
      // Replace imports that reference the old .jsx path (with extension)
      const oldBase = oldPath.replace(/\.jsx$/, "");
      const newBase = newPath.replace(/\.tsx$/, "");
      if (oldBase !== newBase) {
        // Path stem changed — shouldn't happen since we only change extension
        code = code.replaceAll(oldPath, newPath);
      }
      // Replace explicit .jsx extension references
      code = code.replaceAll(oldPath, newPath);
    }
    files[path] = code;
  }

  return renamed;
}
