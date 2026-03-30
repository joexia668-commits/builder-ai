import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { saveMessage } from "./message-service";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, role, content, metadata } = body as {
    projectId: string;
    role: string;
    content: string;
    metadata?: Prisma.InputJsonValue;
  };

  if (!projectId || !role || !content) {
    return NextResponse.json(
      { error: "projectId, role, content are required" },
      { status: 400 }
    );
  }

  // Verify the project belongs to the current user
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const message = await saveMessage({ projectId, role, content, metadata });
  return NextResponse.json(message, { status: 201 });
}
