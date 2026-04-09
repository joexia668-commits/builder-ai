import fs from 'fs'
import path from 'path'

export interface AssembleOptions {
  projectName: string;
  projectId: string;
  generatedFiles: Record<string, string>;
  mode: 'hosted' | 'export';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface AssembledProject {
  files: Record<string, string>;
}

const TEMPLATE_DIR = path.join(process.cwd(), 'templates/nextjs')

/** Map Sandpack-style path to Next.js project path. */
function mapSandpackPath(sandpackPath: string): string {
  const normalized = sandpackPath.startsWith('/') ? sandpackPath.slice(1) : sandpackPath
  if (normalized === 'App.tsx' || normalized === 'App.jsx' || normalized === 'App.js') {
    return 'pages/index.tsx'
  }
  return normalized
}

/** Recursively read all files from a directory, returning path → content map. */
function readTemplateDir(dir: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      Object.assign(result, readTemplateDir(fullPath, relativePath))
    } else {
      result[relativePath] = fs.readFileSync(fullPath, 'utf-8')
    }
  }
  return result
}

function buildSupabaseTs(mode: 'hosted' | 'export', url?: string, key?: string): string {
  if (mode === 'hosted' && url && key) {
    return `import { createClient } from '@supabase/supabase-js'
export const supabase = createClient('${url}', '${key}')
`
  }
  return `import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
`
}

export function assembleProject(options: AssembleOptions): AssembledProject {
  const { generatedFiles, mode, supabaseUrl, supabaseAnonKey } = options

  // 1. Load all platform template files
  const templateFiles = readTemplateDir(TEMPLATE_DIR)

  // Remove placeholder supabase files — we'll inject the right one below
  delete templateFiles['lib/supabase.hosted.ts']
  delete templateFiles['lib/supabase.export.ts']

  // 2. Map AI-generated files from Sandpack format to Next.js paths
  const mappedGenerated: Record<string, string> = {}
  for (const [sandpackPath, content] of Object.entries(generatedFiles)) {
    const nextjsPath = mapSandpackPath(sandpackPath)
    mappedGenerated[nextjsPath] = content
  }

  // 3. Merge: templates first, then AI-generated
  // Protect infrastructure files from being overwritten by AI
  const PROTECTED = new Set([
    'package.json', 'next.config.js', 'tsconfig.json',
    'tailwind.config.js', 'postcss.config.js',
    'pages/_app.tsx', 'pages/_document.tsx',
    'styles/globals.css', 'lib/utils.ts',
  ])

  const files: Record<string, string> = { ...templateFiles }
  for (const [nextjsPath, content] of Object.entries(mappedGenerated)) {
    if (!PROTECTED.has(nextjsPath)) {
      files[nextjsPath] = content
    }
  }

  // 4. Inject correct supabase.ts
  files['lib/supabase.ts'] = buildSupabaseTs(mode, supabaseUrl, supabaseAnonKey)

  return { files }
}
