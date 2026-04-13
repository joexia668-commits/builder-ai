import type { PartialExtractResult } from "@/lib/types";

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
  const marker = /^\/\/ === FILE: (.+?) ===/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1];
      fileMap[currentPath] = [];
    } else if (currentPath !== null) {
      fileMap[currentPath].push(line);
    }
  }

  if (Object.keys(fileMap).length === 0) return null;

  const result: Record<string, string> = {};
  for (const [path, codeLines] of Object.entries(fileMap)) {
    const code = deduplicateDefaultExport(codeLines.join("\n").trim());
    if (!isDelimitersBalanced(code)) return null;
    result[path] = code;
  }

  return result;
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

  const marker = /^\/\/ === FILE: (.+?) ===/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1];
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

  const marker = /^\/\/ === FILE: (.+?) ===/;
  const lines = raw.split("\n");
  const fileMap: Record<string, string[]> = {};
  let currentPath: string | null = null;

  for (const line of lines) {
    const match = line.match(marker);
    if (match) {
      currentPath = match[1];
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
 * Scan all generated files for imports of local paths ('/...') that are not
 * present in the files map. Returns a Map from missing path to the set of
 * named exports required from that path (empty set = only default/namespace import).
 * /supabaseClient.js is always whitelisted (it is injected by buildSandpackConfig).
 */
export function findMissingLocalImportsWithNames(
  files: Readonly<Record<string, string>>
): Map<string, Set<string>> {
  const presentPaths = new Set(Object.keys(files));
  const missing = new Map<string, Set<string>>();

  const ensurePath = (path: string) => {
    if (!missing.has(path)) missing.set(path, new Set());
  };

  // Regex matches: import [Default,] { Foo, Bar as B } from '/path'
  const namedImportRe = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s+from\s+['"](\/.+?)['"]/g;

  for (const code of Object.values(files)) {
    // Pass 1: extract named import specifiers per path
    for (const m of Array.from(code.matchAll(namedImportRe))) {
      const path = m[2];
      if (!WHITELISTED_LOCAL.has(path) && !presentPaths.has(path)) {
        ensurePath(path);
        for (const token of m[1].split(",")) {
          const raw = token.trim();
          if (!raw) continue;
          // "Foo as Bar" → use original export name "Foo"
          const name = raw.split(/\s+as\s+/)[0].trim();
          if (name && /^[a-zA-Z_$][\w$]*$/.test(name)) {
            missing.get(path)!.add(name);
          }
        }
      }
    }

    // Pass 2: catch default/namespace imports to ensure the path is tracked
    for (const m of Array.from(code.matchAll(/from\s+['"](\/.+?)['"]/g))) {
      const path = m[1];
      if (!WHITELISTED_LOCAL.has(path) && !presentPaths.has(path)) {
        ensurePath(path);
      }
    }
  }

  return missing;
}

/**
 * Scan all generated files for imports of local paths ('/...') that are not
 * present in the files map. Returns a deduplicated list of missing paths.
 * /supabaseClient.js is always whitelisted (it is injected by buildSandpackConfig).
 */
export function findMissingLocalImports(
  files: Readonly<Record<string, string>>
): string[] {
  const presentPaths = new Set(Object.keys(files));
  const missing = new Set<string>();

  for (const code of Object.values(files)) {
    for (const match of Array.from(code.matchAll(/from\s+['"](\/.+?)['"]/g))) {
      const importedPath = match[1];
      if (!WHITELISTED_LOCAL.has(importedPath) && !presentPaths.has(importedPath)) {
        missing.add(importedPath);
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
  for (const m of code.matchAll(declRe)) named.add(m[1]);

  // export { Foo, Bar as Baz } — skip export type { ... }
  const braceRe = /\bexport\s+(type\s+)?\{([^}]*)\}/g;
  for (const m of code.matchAll(braceRe)) {
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
  for (const m of code.matchAll(namedRe)) {
    const entry = ensure(m[3]);
    if (m[1]) entry.hasDefault = true; // "Default," prefix present
    for (const token of m[2].split(",")) {
      const raw = token.trim();
      if (!raw) continue;
      // "Foo as Bar" → external name from the source is "Foo"
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (name && /^[$\w]+$/.test(name)) entry.named.push(name);
    }
  }

  // import Default from '/path' (no braces — default-only import)
  const defaultRe = /\bimport\s+(?!type\b)([$\w]+)\s+from\s+['"](\/.+?)['"]/g;
  for (const m of code.matchAll(defaultRe)) {
    ensure(m[2]).hasDefault = true;
  }

  return Array.from(byPath.entries()).map(([path, v]) => ({ path, ...v }));
}
