/**
 * Sandpack configuration builder.
 *
 * Centralises all Sandpack setup so it can be tested without mounting
 * the full component. Injects the hidden supabaseClient.js file and
 * auto-stubs any local imports the AI generated but never created.
 */

import { findMissingLocalImportsWithNames } from "@/lib/extract-code";

/**
 * Detect default-vs-named export mismatches between generated files and patch them.
 *
 * AI often generates `export default function Foo()` in one file while another file
 * does `import { Foo } from '/Foo.jsx'` (named import), or vice versa. Both resolve
 * to `undefined` at runtime, causing the "Element type is invalid: got undefined" error.
 *
 * Fix strategy (minimal, non-destructive):
 *   • Named import of a default-only export  → append `export { default as Name };`
 *   • Default import of a named-only export  → append `export default FirstNamedExport;`
 */
function patchExportMismatches(
  files: Record<string, string>
): Record<string, string> {
  const namedImportRe = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s+from\s+['"](\/.+?)['"]/g;
  const defaultImportRe = /import\s+([\w$]+)\s+from\s+['"](\/.+?)['"]/g;

  // What each existing file is expected to provide
  const needsDefault = new Set<string>();
  const needsNamed = new Map<string, Set<string>>();

  for (const code of Object.values(files)) {
    for (const m of Array.from(code.matchAll(defaultImportRe))) {
      const path = m[2];
      if (files[path]) needsDefault.add(path);
    }
    for (const m of Array.from(code.matchAll(namedImportRe))) {
      const path = m[2];
      if (!files[path]) continue;
      if (!needsNamed.has(path)) needsNamed.set(path, new Set());
      for (const token of m[1].split(",")) {
        const name = token.trim().split(/\s+as\s+/)[0].trim();
        if (name && /^[a-zA-Z_$][\w$]*$/.test(name))
          needsNamed.get(path)!.add(name);
      }
    }
  }

  const result = { ...files };

  for (const [path, code] of Object.entries(files)) {
    const hasDefault = /export\s+default\b/.test(code);

    // Named exports: `export function/class/const/let/var Name` or `export { X }`
    const namedSet = new Set<string>();
    for (const m of Array.from(
      code.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z_$][\w$]*)/g)
    )) {
      if (m[1] !== "default") namedSet.add(m[1]);
    }
    for (const m of Array.from(code.matchAll(/export\s*\{([^}]+)\}/g))) {
      for (const token of m[1].split(",")) {
        const parts = token.trim().split(/\s+as\s+/);
        const exported = (parts[1] ?? parts[0]).trim();
        if (exported && exported !== "default" && /^[a-zA-Z_$][\w$]*$/.test(exported))
          namedSet.add(exported);
      }
    }

    const additions: string[] = [];

    // File imported as default but has no default export → re-export first named as default
    if (needsDefault.has(path) && !hasDefault) {
      const first = Array.from(namedSet)[0];
      if (first) additions.push(`export default ${first};`);
    }

    // File imported by name but missing some named exports → add them
    const needed = needsNamed.get(path);
    if (needed) {
      for (const name of Array.from(needed)) {
        if (!namedSet.has(name)) {
          // If the file has a default export, re-export it under the needed name
          additions.push(
            hasDefault
              ? `export { default as ${name} };`
              : `export const ${name} = () => null;`
          );
        }
      }
    }

    if (additions.length > 0) {
      result[path] = code + "\n// [builder-ai: export patch]\n" + additions.join("\n");
    }
  }

  return result;
}

const PLACEHOLDER_APP = `export default function App() {
  return (
    <div className="flex items-center justify-center h-screen text-gray-400">
      <p>等待 AI 生成代码...</p>
    </div>
  );
}`;

function buildSupabaseClientCode(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('${url}', '${key}');`;
}

export interface SandpackFileEntry {
  code: string;
  hidden?: boolean;
}

export interface SandpackConfig {
  template: string;
  files: Record<string, SandpackFileEntry>;
  customSetup?: {
    dependencies?: Record<string, string>;
  };
  options?: {
    recompileMode?: "delayed" | "immediate";
    recompileDelay?: number;
    externalResources?: string[];
  };
  theme?: string;
}

export function buildSandpackConfig(
  input: string | Record<string, string>,
  projectId: string
): SandpackConfig {
  void projectId; // projectId reserved for future per-project isolation

  // Normalize: string input becomes single-file { "/App.js": code }
  let userFiles: Record<string, string> =
    typeof input === "string" ? { "/App.js": input || PLACEHOLDER_APP } : { ...input };

  // Fix default-vs-named export mismatches before Sandpack sees the files.
  if (typeof input !== "string") {
    userFiles = patchExportMismatches(userFiles);
  }

  // Ensure /App.js has a value (Sandpack entry point)
  if (!userFiles["/App.js"]) {
    userFiles["/App.js"] = PLACEHOLDER_APP;
  }

  // Convert to Sandpack file entries
  const sandpackFiles: Record<string, SandpackFileEntry> = {};
  for (const [path, code] of Object.entries(userFiles)) {
    sandpackFiles[path] = { code };
  }

  // Inject stubs for any local imports the AI generated but never created.
  // Named exports are included so that `import { Foo } from '/missing.js'`
  // resolves to () => null instead of undefined, preventing the React
  // "Element type is invalid: got undefined" error.
  const missingImports = findMissingLocalImportsWithNames(userFiles);
  for (const [missingPath, namedExports] of Array.from(missingImports.entries())) {
    const namedLines = Array.from(namedExports)
      .map((n) => `export const ${n} = () => null;`)
      .join("\n");
    const stubParts = [
      `// Auto-stub: ${missingPath} was not generated by AI`,
      namedLines,
      `export default new Proxy({}, {\n  get(_, key) {\n    console.warn(\`[Builder AI] Missing module stub: ${missingPath} — "\${String(key)}" called on missing module\`);\n    return () => null;\n  }\n});`,
    ];
    sandpackFiles[missingPath] = {
      code: stubParts.filter(Boolean).join("\n"),
      hidden: true,
    };
  }

  // Inject hidden supabase client
  sandpackFiles["/supabaseClient.js"] = {
    code: buildSupabaseClientCode(),
    hidden: true,
  };

  return {
    template: "react",
    theme: "auto",
    files: sandpackFiles,
    customSetup: {
      dependencies: {
        "@supabase/supabase-js": "^2.39.0",
        "lucide-react": "^0.300.0",
      },
    },
    options: {
      recompileMode: "delayed",
      recompileDelay: 500,
      externalResources: ["https://cdn.tailwindcss.com"],
    },
  };
}
