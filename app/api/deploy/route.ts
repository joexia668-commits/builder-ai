import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getVersionFiles } from '@/lib/version-files'
import { assembleProject } from '@/lib/project-assembler'
import { createVercelDeployment } from '@/lib/vercel-deploy'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { projectId?: string; versionId?: string }
  const { projectId, versionId } = body

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  try {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
    })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const version = await prisma.version.findFirst({
      where: versionId ? { id: versionId, projectId } : { projectId },
      orderBy: versionId ? undefined : { versionNumber: 'desc' },
    })
    if (!version) return NextResponse.json({ error: 'No version found' }, { status: 404 })

    const generatedFiles = getVersionFiles(
      version as { code: string; files?: Record<string, string> | null }
    )
    const projectSlug = slugify(project.name) || 'my-app'

    const assembled = assembleProject({
      projectName: projectSlug,
      projectId,
      generatedFiles,
      mode: 'hosted',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    })

    const vercelResult = await createVercelDeployment({
      projectSlug,
      files: assembled.files,
      vercelProjectId: undefined,
    })

    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        versionId: version.id,
        vercelProjectId: vercelResult.vercelProjectId,
        vercelDeployId: vercelResult.vercelDeployId,
        url: vercelResult.url,
        status: 'building',
      },
    })

    return NextResponse.json(
      { deploymentId: deployment.id, status: 'building', url: deployment.url },
      { status: 202 }
    )
  } catch (error: unknown) {
    console.error('[/api/deploy]', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
