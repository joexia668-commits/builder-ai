import { GET } from '@/app/api/export/route'

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    version: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/project-assembler', () => ({
  assembleProject: jest.fn(() => ({ files: { 'package.json': '{}' } })),
}))
jest.mock('@/lib/zip-exporter', () => ({
  createProjectZip: jest.fn(async () => Buffer.from('fake-zip')),
}))
jest.mock('@/lib/version-files', () => ({
  getVersionFiles: jest.fn(() => ({ '/App.tsx': 'content' })),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = getServerSession as jest.Mock
const mockVersionFindFirst = prisma.version.findFirst as jest.Mock
const mockProjectFindFirst = prisma.project.findFirst as jest.Mock

describe('GET /api/export', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const req = new Request('http://localhost/api/export?projectId=p1&versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when projectId is missing', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    const req = new Request('http://localhost/api/export?versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when project not found', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFindFirst.mockResolvedValue(null)
    const req = new Request('http://localhost/api/export?projectId=p1&versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns zip with correct headers when successful', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFindFirst.mockResolvedValue({ id: 'p1', name: 'My App', userId: 'u1' })
    mockVersionFindFirst.mockResolvedValue({
      id: 'v1', code: '', files: { '/App.tsx': 'content' },
    })
    const req = new Request('http://localhost/api/export?projectId=p1&versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('.zip')
  })
})
