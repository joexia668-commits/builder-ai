import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

interface SaveMessageInput {
  projectId: string;
  role: string;
  content: string;
  metadata?: Prisma.InputJsonValue;
}

export async function saveMessage(input: SaveMessageInput) {
  return prisma.message.create({
    data: {
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      metadata: input.metadata,
    },
  });
}

export async function getProjectMessages(projectId: string) {
  return prisma.message.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
}
