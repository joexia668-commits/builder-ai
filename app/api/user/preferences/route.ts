import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidModelId } from "@/lib/model-registry";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferredModel: true },
  });

  return NextResponse.json({ preferredModel: user?.preferredModel ?? null });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { preferredModel } = body as { preferredModel?: string | null };

  if (preferredModel !== undefined && preferredModel !== null) {
    if (!isValidModelId(preferredModel)) {
      return NextResponse.json(
        { error: `Unknown modelId: ${preferredModel}` },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { preferredModel: preferredModel ?? null },
    select: { preferredModel: true },
  });

  return NextResponse.json({ preferredModel: updated.preferredModel });
}
