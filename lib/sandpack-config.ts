/**
 * Sandpack configuration builder.
 *
 * Centralises all Sandpack setup so it can be tested without mounting
 * the full component. Injects the hidden supabaseClient.js file and
 * auto-stubs any local imports the AI generated but never created.
 */

import { findMissingLocalImportsWithNames } from "@/lib/extract-code";

/**
 * Ensure every AI-generated file exposes both a default export and at least one
 * named export, so that both `import X from` and `import { X } from` always
 * resolve to a valid value in Sandpack.
 *
 * Works file-by-file without cross-file import analysis — immune to import
 * style variations that caused the previous regex-based patcher to silently skip.
 *
 * Rules applied per file:
 *   • Has `export default function/class X` or `export default X` but no same-named
 *     named export → append `export { default as X };`
 *   • Has named exports but no default export → append `export default FirstNamed;`
 *   • Already has both, or default is anonymous → no change
 */
function normalizeExports(
  files: Record<string, string>
): Record<string, string> {
  const result = { ...files };

  for (const [path, code] of Object.entries(files)) {
    const additions: string[] = [];

    // 1. Detect default export name (null for anonymous defaults)
    const defaultFnMatch = code.match(
      /export\s+default\s+(?:async\s+)?(?:function|class)\s+([a-zA-Z_$][\w$]*)/
    );
    const defaultIdMatch = !defaultFnMatch
      ? code.match(/export\s+default\s+([a-zA-Z_$][\w$]*)/)
      : null;
    const defaultName = defaultFnMatch?.[1] ?? defaultIdMatch?.[1];
    const hasDefault = /export\s+default\b/.test(code);

    // 2. Collect all named exports from this file
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

    // 3. Bidirectional normalization
    let transformedCode = code;

    // 3a. `export default function/class Name` → split into declaration + separate exports.
    // Sandpack's Babel rejects `export { Name }` after `export default function Name`,
    // but accepts it when Name is a regular declaration. So we transform:
    //   export default function Name(...) {    →    function Name(...) {
    //                                          +    export default Name;
    //                                          +    export { Name };
    if (defaultFnMatch && defaultName && !namedSet.has(defaultName)) {
      transformedCode = transformedCode.replace(
        /export\s+default\s+((?:async\s+)?(?:function|class)\s+)/,
        "$1"
      );
      additions.push(`export default ${defaultName};`);
      additions.push(`export { ${defaultName} };`);
    }

    // 3b. `export default Name` (identifier ref) — Name is already declared,
    // safe to add `export { Name }` directly.
    if (!defaultFnMatch && defaultName && !namedSet.has(defaultName)) {
      additions.push(`export { ${defaultName} };`);
    }

    // 3c. Named exports exist but no default → promote first named to default
    if (!hasDefault && namedSet.size > 0) {
      const first = Array.from(namedSet)[0];
      additions.push(`export default ${first};`);
    }

    if (additions.length > 0) {
      result[path] = transformedCode + "\n// [builder-ai: export normalization]\n" + additions.join("\n");
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

function buildSupabaseClientCode(projectId: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('${url}', '${key}', {
  global: { headers: { 'x-app-id': '${projectId}' } },
});
// Auth mock — supabase.auth is non-functional in the Sandpack sandbox.
// All calls are intercepted and return harmless success responses so that
// any AI-generated auth code does not permanently block the app's login page.
// Auth mock — stateful to survive signInWithPassword → getSession round-trips
const _authState = { session: null };
supabase.auth = {
  signInWithPassword: async ({ email }) => {
    _authState.session = { access_token: "demo" };
    return { data: { user: { email }, session: _authState.session }, error: null };
  },
  signUp: async ({ email }) =>
    ({ data: { user: { email }, session: null }, error: null }),
  signOut: async () => {
    _authState.session = null;
    return { error: null };
  },
  getSession: async () =>
    ({ data: { session: _authState.session }, error: null }),
  onAuthStateChange: () =>
    ({ data: { subscription: { id: "mock", callback: () => {}, unsubscribe: () => {} } } }),
};`;
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

  // Normalize: string input becomes single-file { "/App.js": code }
  let userFiles: Record<string, string> =
    typeof input === "string" ? { "/App.js": input || PLACEHOLDER_APP } : { ...input };

  // Normalize exports: ensure every file exposes both named and default export
  // styles so any import form resolves to a valid component, not undefined.
  if (typeof input !== "string") {
    userFiles = normalizeExports(userFiles);
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
    code: buildSupabaseClientCode(projectId),
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
