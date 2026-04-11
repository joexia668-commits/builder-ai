import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { Workspace } from "@/components/workspace/workspace";
import type { Project, ProjectMessage, ProjectVersion } from "@/lib/types";

interface PageProps {
  params: { id: string };
}

export default async function ProjectPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const isDemo = session.user.isDemo ?? false;
  const allowedUserId = isDemo
    ? (process.env.DEMO_USER_ID ?? null)
    : session.user.id;

  if (!allowedUserId) {
    redirect("/login");
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, userId: allowedUserId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { versionNumber: "asc" } },
    },
  });

  if (!project) {
    notFound();
  }

  const allProjects = await prisma.project.findMany({
    where: { userId: allowedUserId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true },
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />
      <Workspace
        project={project as unknown as Project & { messages: ProjectMessage[]; versions: ProjectVersion[] }}
        allProjects={allProjects}
        isDemo={isDemo}
      />
    </div>
  );
}
