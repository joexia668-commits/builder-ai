import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pollDeploymentStatus } from '@/lib/vercel-deploy'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const deployment = await prisma.deployment.findUnique({
      where: { id: params.id },
      include: { project: { select: { userId: true } } },
    })

    if (!deployment || deployment.project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Already in terminal state — return immediately without polling
    if (deployment.status === 'ready' || deployment.status === 'error') {
      return NextResponse.json({ status: deployment.status, url: deployment.url })
    }

    // Still building — do a single poll check (frontend retries every 3s)
    const pollResult = await pollDeploymentStatus(deployment.vercelDeployId, 1)

    if (pollResult.status !== 'building') {
      const updated = await prisma.deployment.update({
        where: { id: params.id },
        data: {
          status: pollResult.status,
          ...(pollResult.url ? { url: pollResult.url } : {}),
        },
      })
      return NextResponse.json({ status: updated.status, url: updated.url })
    }

    return NextResponse.json({ status: 'building', url: deployment.url })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
