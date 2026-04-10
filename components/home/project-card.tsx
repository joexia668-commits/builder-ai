"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";

export interface ProjectCardData {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  _count: { versions: number; messages: number };
  messages: { content: string; role: string }[];
}

interface ProjectCardProps {
  readonly project: ProjectCardData;
  readonly onDelete: (id: string) => void;
  readonly isDeleting?: boolean;
}

export function ProjectCard({ project, onDelete, isDeleting = false }: ProjectCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirm(true);
  }

  function handleConfirm() {
    onDelete(project.id);
    setShowConfirm(false);
  }

  function handleCancel() {
    setShowConfirm(false);
  }

  return (
    <>
      <div className="relative group" data-testid="project-card" data-projectid={project.id}>
        <Link
          href={`/project/${project.id}`}
          className="bg-white rounded-xl border border-[#e5e7eb] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:border-[#a5b4fc] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all duration-150 p-4 block"
        >
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-[#030712] truncate pr-8 tracking-[-0.2px]">
              {project.name}
            </h3>
            <span className="shrink-0 bg-[#eef2ff] text-[#4f46e5] text-[11px] font-medium rounded-full px-[7px] py-[2px]">
              v{project._count.versions}
            </span>
          </div>
          {project.description && (
            <p className="text-[12px] text-[#6b7280] truncate mb-2">
              {project.description}
            </p>
          )}
          {project.messages[0] && (
            <p className="text-[11px] text-[#9ca3af] truncate mb-3">
              {project.messages[0].content.slice(0, 60)}...
            </p>
          )}
          <p className="text-[11px] text-[#9ca3af]">
            {new Date(project.updatedAt).toLocaleDateString("zh-CN", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </Link>

        <div className="absolute top-3 right-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="inline-flex items-center justify-center rounded-md w-7 h-7 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="项目操作"
            >
              <MoreHorizontal className="w-4 h-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                onClick={handleDeleteClick}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                删除项目
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showConfirm && (
        <DeleteProjectDialog
          projectName={project.name}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isLoading={isDeleting}
        />
      )}
    </>
  );
}
