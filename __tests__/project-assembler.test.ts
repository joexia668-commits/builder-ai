import { assembleProject } from '@/lib/project-assembler'

const GENERATED_FILES: Record<string, string> = {
  '/App.tsx': 'export default function App() { return <div>Hello</div> }',
  '/components/Header.tsx': 'export function Header() { return <header>Header</header> }',
  '/hooks/useData.ts': 'export function useData() { return [] }',
  '/lib/helpers.ts': 'export function format(s: string) { return s.trim() }',
}

describe('assembleProject', () => {
  describe('file path mapping', () => {
    it('maps /App.tsx to pages/index.tsx', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: { '/App.tsx': 'content' },
        mode: 'export',
      })
      expect(result.files['pages/index.tsx']).toBe('content')
      expect(result.files['/App.tsx']).toBeUndefined()
    })

    it('maps /components/* stripping leading slash', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: { '/components/Header.tsx': 'header content' },
        mode: 'export',
      })
      expect(result.files['components/Header.tsx']).toBe('header content')
    })

    it('maps /hooks/* and /lib/* stripping leading slash', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: GENERATED_FILES,
        mode: 'export',
      })
      expect(result.files['hooks/useData.ts']).toBe('export function useData() { return [] }')
      expect(result.files['lib/helpers.ts']).toBe('export function format(s: string) { return s.trim() }')
    })
  })

  describe('template files injection', () => {
    it('includes package.json from template', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['package.json']).toBeDefined()
      expect(result.files['package.json']).toContain('"next"')
    })

    it('includes pages/_app.tsx from template', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['pages/_app.tsx']).toBeDefined()
    })

    it('includes components/ui/button.tsx from template', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['components/ui/button.tsx']).toBeDefined()
    })
  })

  describe('supabase injection', () => {
    it('export mode: lib/supabase.ts has placeholder values', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['lib/supabase.ts']).toContain('NEXT_PUBLIC_SUPABASE_URL')
      expect(result.files['lib/supabase.ts']).not.toContain('https://real.supabase.co')
    })

    it('hosted mode: lib/supabase.ts injects real credentials', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'hosted',
        supabaseUrl: 'https://real.supabase.co',
        supabaseAnonKey: 'anon-key-123',
      })
      expect(result.files['lib/supabase.ts']).toContain('https://real.supabase.co')
      expect(result.files['lib/supabase.ts']).toContain('anon-key-123')
    })
  })
})
