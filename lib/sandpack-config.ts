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

export function buildSandpackConfig(code: string, projectId: string): SandpackConfig {
  void projectId; // projectId reserved for future per-project isolation
  return {
    template: 'react',
    theme: 'auto',
    files: {
      '/App.js': { code: code || PLACEHOLDER_APP },
      '/supabaseClient.js': {
        code: buildSupabaseClientCode(),
        hidden: true,
      },
    },
    customSetup: {
      dependencies: {
        '@supabase/supabase-js': '^2.39.0',
        'lucide-react': '^0.300.0',
      },
    },
    options: {
      recompileMode: 'delayed',
      recompileDelay: 500,
      externalResources: ['https://cdn.tailwindcss.com'],
    },
  };
}
