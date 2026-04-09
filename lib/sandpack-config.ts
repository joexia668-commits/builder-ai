/**
 * Sandpack configuration builder.
 *
 * Centralises all Sandpack setup so it can be tested without mounting
 * the full component. Injects the hidden supabaseClient.js file.
 */

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
  const userFiles: Record<string, string> =
    typeof input === "string" ? { "/App.js": input || PLACEHOLDER_APP } : { ...input };

  // Ensure /App.js has a value (Sandpack entry point)
  if (!userFiles["/App.js"]) {
    userFiles["/App.js"] = PLACEHOLDER_APP;
  }

  // Convert to Sandpack file entries
  const sandpackFiles: Record<string, SandpackFileEntry> = {};
  for (const [path, code] of Object.entries(userFiles)) {
    sandpackFiles[path] = { code };
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
