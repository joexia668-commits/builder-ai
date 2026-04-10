import { createVercelDeployment, pollDeploymentStatus } from '@/lib/vercel-deploy'

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('createVercelDeployment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.VERCEL_TOKEN = 'test-token'
    delete process.env.VERCEL_TEAM_ID
  })

  it('calls Vercel Deploy API with correct auth header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'dpl_abc', url: 'my-app.vercel.app', projectId: 'vp_xyz', readyState: 'QUEUED' }),
    })

    await createVercelDeployment({
      projectSlug: 'my-app',
      files: { 'pages/index.tsx': 'export default function Home() {}' },
      vercelProjectId: undefined,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v13/deployments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('returns vercelDeployId, vercelProjectId and normalised url', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'dpl_abc', url: 'my-app.vercel.app', projectId: 'vp_xyz', readyState: 'QUEUED' }),
    })

    const result = await createVercelDeployment({
      projectSlug: 'my-app',
      files: { 'pages/index.tsx': 'content' },
      vercelProjectId: undefined,
    })

    expect(result.vercelDeployId).toBe('dpl_abc')
    expect(result.vercelProjectId).toBe('vp_xyz')
    expect(result.url).toBe('https://my-app.vercel.app')
  })

  it('throws when VERCEL_TOKEN is not set', async () => {
    delete process.env.VERCEL_TOKEN
    await expect(
      createVercelDeployment({ projectSlug: 'x', files: {}, vercelProjectId: undefined })
    ).rejects.toThrow('VERCEL_TOKEN')
  })

  it('throws when Vercel API returns error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token' } }),
    })

    await expect(
      createVercelDeployment({ projectSlug: 'x', files: {}, vercelProjectId: undefined })
    ).rejects.toThrow('Invalid token')
  })

  it('includes teamId in URL when VERCEL_TEAM_ID is set', async () => {
    process.env.VERCEL_TEAM_ID = 'team_abc'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'dpl_1', url: 'app.vercel.app', projectId: 'vp_1', readyState: 'QUEUED' }),
    })

    await createVercelDeployment({ projectSlug: 'app', files: {}, vercelProjectId: undefined })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v13/deployments?teamId=team_abc',
      expect.any(Object)
    )
    delete process.env.VERCEL_TEAM_ID
  })
})

describe('pollDeploymentStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.VERCEL_TOKEN = 'test-token'
    delete process.env.VERCEL_TEAM_ID
  })

  it('returns ready when deployment is READY', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'READY', url: 'my-app.vercel.app' }),
    })

    const result = await pollDeploymentStatus('dpl_abc', 1)
    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://my-app.vercel.app')
  })

  it('returns error when deployment has ERROR state', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'ERROR' }),
    })

    const result = await pollDeploymentStatus('dpl_abc', 1)
    expect(result.status).toBe('error')
  })

  it('returns building after max attempts when still in progress', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'BUILDING' }),
    })

    const result = await pollDeploymentStatus('dpl_abc', 2)
    expect(result.status).toBe('building')
  })
})
