import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const version = await prisma.version.findFirst({
    where: { id: params.id, project: { userId: session.user.id } },
  });
  if (!version) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { files } = body as { files?: Record<string, string> };
  if (!files) return NextResponse.json({ error: "files is required" }, { status: 400 });

  const effectiveCode = files["/App.js"] ?? version.code;

  const updated = await prisma.version.update({
    where: { id: params.id },
    data: {
      files,
      code: effectiveCode,
    },
  });

  return NextResponse.json(updated);
}
