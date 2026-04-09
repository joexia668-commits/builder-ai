const VERCEL_API = 'https://api.vercel.com'

export interface CreateDeploymentOptions {
  projectSlug: string;
  files: Record<string, string>;
  vercelProjectId?: string;
}

export interface CreateDeploymentResult {
  vercelDeployId: string;
  vercelProjectId: string;
  url: string;
}

export type DeployStatus = 'ready' | 'error' | 'building'

export interface PollResult {
  status: DeployStatus;
  url?: string;
}

function getToken(): string {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN environment variable is not set')
  return token
}

function normalizeUrl(url: string): string {
  return url.startsWith('https://') ? url : `https://${url}`
}

function toVercelFiles(files: Record<string, string>) {
  return Object.entries(files).map(([file, data]) => ({
    file,
    data: Buffer.from(data).toString('base64'),
    encoding: 'base64',
  }))
}

function deployUrl(teamId?: string): string {
  return teamId
    ? `${VERCEL_API}/v13/deployments?teamId=${teamId}`
    : `${VERCEL_API}/v13/deployments`
}

function statusUrl(deployId: string, teamId?: string): string {
  return teamId
    ? `${VERCEL_API}/v13/deployments/${deployId}?teamId=${teamId}`
    : `${VERCEL_API}/v13/deployments/${deployId}`
}

/**
 * Trigger a Vercel deployment via the Deploy API v13.
 * Returns the deployment ID, Vercel project ID, and deployment URL.
 */
export async function createVercelDeployment(
  options: CreateDeploymentOptions
): Promise<CreateDeploymentResult> {
  const token = getToken()
  const { projectSlug, files, vercelProjectId } = options
  const teamId = process.env.VERCEL_TEAM_ID

  const body: Record<string, unknown> = {
    name: projectSlug,
    files: toVercelFiles(files),
    projectSettings: { framework: 'nextjs' },
    target: 'production',
  }
  if (vercelProjectId) body.project = vercelProjectId

  const res = await fetch(deployUrl(teamId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json() as {
    id?: string;
    url?: string;
    projectId?: string;
    readyState?: string;
    error?: { message: string };
  }

  if (!res.ok) {
    throw new Error(data.error?.message ?? `Vercel API error: ${res.status}`)
  }

  return {
    vercelDeployId: data.id!,
    vercelProjectId: data.projectId ?? vercelProjectId ?? '',
    url: normalizeUrl(data.url!),
  }
}

/**
 * Poll Vercel until deployment reaches a terminal state (ready/error)
 * or max attempts is exhausted (returns 'building').
 * @param deployId - Vercel deployment ID
 * @param maxAttempts - max poll cycles (each cycle is immediate; callers add delay between calls)
 */
export async function pollDeploymentStatus(
  deployId: string,
  maxAttempts = 40
): Promise<PollResult> {
  const token = getToken()
  const teamId = process.env.VERCEL_TEAM_ID

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(statusUrl(deployId, teamId), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json() as { readyState: string; url?: string }

    if (data.readyState === 'READY') {
      return { status: 'ready', url: data.url ? normalizeUrl(data.url) : undefined }
    }
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      return { status: 'error' }
    }
  }

  return { status: 'building' }
}
