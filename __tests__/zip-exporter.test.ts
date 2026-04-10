import { createProjectZip } from '@/lib/zip-exporter'
import JSZip from 'jszip'

const FILES: Record<string, string> = {
  'package.json': '{"name":"my-app"}',
  'pages/index.tsx': 'export default function Home() { return <div>Hi</div> }',
  'components/ui/button.tsx': 'export function Button() { return <button /> }',
}

describe('createProjectZip', () => {
  it('returns a Buffer', async () => {
    const buf = await createProjectZip(FILES, 'my-app')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('zip contains files nested under project name folder', async () => {
    const buf = await createProjectZip(FILES, 'my-app')
    const zip = await JSZip.loadAsync(buf)
    expect(zip.files['my-app/package.json']).toBeDefined()
    expect(zip.files['my-app/pages/index.tsx']).toBeDefined()
    expect(zip.files['my-app/components/ui/button.tsx']).toBeDefined()
  })

  it('file content is preserved in zip', async () => {
    const buf = await createProjectZip(FILES, 'my-app')
    const zip = await JSZip.loadAsync(buf)
    const content = await zip.files['my-app/package.json'].async('string')
    expect(content).toBe('{"name":"my-app"}')
  })
})
