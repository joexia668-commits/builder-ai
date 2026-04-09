import { POST } from '@/app/api/deploy/route'
import { GET } from '@/app/api/deploy/[id]/route'

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    version: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    deployment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/project-assembler', () => ({
  assembleProject: jest.fn(() => ({ files: { 'package.json': '{}' } })),
}))
jest.mock('@/lib/vercel-deploy', () => ({
  createVercelDeployment: jest.fn(),
  pollDeploymentStatus: jest.fn(),
}))
jest.mock('@/lib/version-files', () => ({
  getVersionFiles: jest.fn(() => ({ '/App.tsx': 'content' })),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { createVercelDeployment, pollDeploymentStatus } from '@/lib/vercel-deploy'

const mockSession = getServerSession as jest.Mock
const mockProjectFind = prisma.project.findFirst as jest.Mock
const mockVersionFind = prisma.version.findFirst as jest.Mock
const mockDeployCreate = prisma.deployment.create as jest.Mock
const mockDeployFind = prisma.deployment.findUnique as jest.Mock
const mockDeployUpdate = prisma.deployment.update as jest.Mock
const mockCreateDeploy = createVercelDeployment as jest.Mock
const mockPollStatus = pollDeploymentStatus as jest.Mock

describe('POST /api/deploy', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null)
    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', versionId: 'v1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when projectId missing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when project not found', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFind.mockResolvedValue(null)
    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('creates deployment record and returns 202 with deploymentId', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFind.mockResolvedValue({ id: 'p1', name: 'My App', userId: 'u1' })
    mockVersionFind.mockResolvedValue({ id: 'v1', code: '', files: { '/App.tsx': 'x' } })
    mockCreateDeploy.mockResolvedValue({
      vercelDeployId: 'dpl_abc',
      vercelProjectId: 'vp_xyz',
      url: 'https://my-app.vercel.app',
    })
    mockDeployCreate.mockResolvedValue({
      id: 'dep_1',
      status: 'building',
      url: 'https://my-app.vercel.app',
    })

    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', versionId: 'v1' }),
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.deploymentId).toBe('dep_1')
    expect(body.status).toBe('building')
  })
})

describe('GET /api/deploy/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null)
    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when deployment not found', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockDeployFind.mockResolvedValue(null)
    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    expect(res.status).toBe(404)
  })

  it('returns current status without polling when already ready', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockDeployFind.mockResolvedValue({
      id: 'dep_1', status: 'ready', url: 'https://my-app.vercel.app',
      vercelDeployId: 'dpl_abc',
      project: { userId: 'u1' },
    })

    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.url).toBe('https://my-app.vercel.app')
    expect(mockPollStatus).not.toHaveBeenCalled()
  })

  it('polls Vercel and updates DB when status is building', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockDeployFind.mockResolvedValue({
      id: 'dep_1', status: 'building', url: 'https://my-app.vercel.app',
      vercelDeployId: 'dpl_abc',
      project: { userId: 'u1' },
    })
    mockPollStatus.mockResolvedValue({ status: 'ready', url: 'https://my-app.vercel.app' })
    mockDeployUpdate.mockResolvedValue({
      id: 'dep_1', status: 'ready', url: 'https://my-app.vercel.app',
    })

    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    const body = await res.json()

    expect(mockPollStatus).toHaveBeenCalledWith('dpl_abc', 1)
    expect(mockDeployUpdate).toHaveBeenCalled()
    expect(body.status).toBe('ready')
    expect(body.url).toBe('https://my-app.vercel.app')
  })
})
