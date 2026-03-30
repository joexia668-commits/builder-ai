import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const versions = await prisma.version.findMany({
    where: { projectId, project: { userId: session.user.id } },
    orderBy: { versionNumber: "asc" },
  });

  return NextResponse.json({ versions });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { projectId, code, description } = body;

  if (!projectId || !code) {
    return NextResponse.json({ error: "projectId and code are required" }, { status: 400 });
  }

  // Verify project belongs to user
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Get next version number
  const lastVersion = await prisma.version.findFirst({
    where: { projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const version = await prisma.version.create({
    data: { projectId, code, description, versionNumber },
  });

  // Update project updatedAt
  await prisma.project.update({
    where: { id: projectId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(version, { status: 201 });
}
