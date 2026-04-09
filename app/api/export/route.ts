import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getVersionFiles } from '@/lib/version-files'
import { assembleProject } from '@/lib/project-assembler'
import { createProjectZip } from '@/lib/zip-exporter'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const versionId = searchParams.get('versionId')

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'projectId is required' }), { status: 400 })
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  })
  if (!project) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }

  const version = await prisma.version.findFirst({
    where: versionId
      ? { id: versionId, projectId }
      : { projectId },
    orderBy: versionId ? undefined : { versionNumber: 'desc' },
  })
  if (!version) {
    return new Response(JSON.stringify({ error: 'No version found' }), { status: 404 })
  }

  const generatedFiles = getVersionFiles(version as { code: string; files?: Record<string, string> | null })
  const projectName = slugify(project.name) || 'my-app'

  const assembled = assembleProject({
    projectName,
    projectId,
    generatedFiles,
    mode: 'export',
  })

  const zipBuffer = await createProjectZip(assembled.files, projectName)

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${projectName}.zip"`,
      'Content-Length': String(zipBuffer.length),
    },
  })
}
