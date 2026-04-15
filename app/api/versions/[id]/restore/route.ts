import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sourceVersion = await prisma.version.findFirst({
    where: { id: params.id, project: { userId: session.user.id } },
  });
  if (!sourceVersion) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lastVersion = await prisma.version.findFirst({
    where: { projectId: sourceVersion.projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const sourceSnapshot = sourceVersion.iterationSnapshot as Record<string, unknown> | null;

  const newVersion = await prisma.version.create({
    data: {
      projectId: sourceVersion.projectId,
      code: sourceVersion.code,
      ...(sourceVersion.files ? { files: sourceVersion.files as Record<string, string> } : {}),
      description: `从 v${sourceVersion.versionNumber} 恢复`,
      versionNumber,
      parentVersionId: sourceVersion.id,
      ...(sourceSnapshot ? { iterationSnapshot: sourceSnapshot } : {}),
    },
  });

  await prisma.project.update({
    where: { id: sourceVersion.projectId },
    data: {
      updatedAt: new Date(),
      ...(sourceSnapshot ? { iterationContext: sourceSnapshot } : {}),
    },
  });

  return NextResponse.json(newVersion, { status: 201 });
}
