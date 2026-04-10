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

  const sourceVersion = await prisma.version.findFirst({
    where: { id: params.id, project: { userId: session.user.id } },
  });
  if (!sourceVersion) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Immutable: create a new version instead of overwriting
  const lastVersion = await prisma.version.findFirst({
    where: { projectId: sourceVersion.projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const newVersion = await prisma.version.create({
    data: {
      projectId: sourceVersion.projectId,
      code: sourceVersion.code,
      ...(sourceVersion.files ? { files: sourceVersion.files as Record<string, string> } : {}),
      description: `从 v${sourceVersion.versionNumber} 恢复`,
      versionNumber,
    },
  });

  return NextResponse.json(newVersion, { status: 201 });
}
