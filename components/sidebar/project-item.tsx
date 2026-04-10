"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";
import { RenameProjectDialog } from "@/components/ui/rename-project-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ProjectItemData {
  id: string;
  name: string;
  updatedAt: Date;
}

interface ProjectItemProps {
  readonly project: ProjectItemData;
  readonly isActive: boolean;
  readonly onDelete: (id: string) => void;
  readonly isDeleting?: boolean;
  readonly onRename: (id: string, newName: string) => void;
  readonly isRenaming?: boolean;
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const d = new Date(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function ProjectItem({
  project,
  isActive,
  onDelete,
  isDeleting = false,
  onRename,
  isRenaming = false,
}: ProjectItemProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);

  function handleConfirmDelete() {
    onDelete(project.id);
    setShowConfirm(false);
  }

  function handleConfirmRename(newName: string) {
    onRename(project.id, newName);
    setShowRename(false);
  }

  return (
    <>
      <div
        className="group/item relative mx-1"
        data-active={isActive ? "true" : undefined}
        data-testid="project-item"
        data-projectid={project.id}
      >
        <Link
          href={`/project/${project.id}`}
          title={project.name}
          className={cn(
            "relative flex flex-col items-center lg:flex-row lg:items-center gap-2 px-2 lg:px-2 py-2.5 lg:py-[7px] rounded-lg transition-all duration-150 pr-8",
            isActive
              ? "bg-[#eef2ff] hover:bg-[#eef2ff]"
              : "hover:bg-[#f9fafb]"
          )}
        >
          {isActive && (
            <span className="hidden lg:block absolute left-0 top-1 bottom-1 w-[3px] bg-[#4f46e5] rounded-r-sm" />
          )}
          <span
            className={cn(
              "lg:hidden w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
              isActive ? "bg-indigo-200 text-indigo-700" : "bg-gray-200 text-gray-600"
            )}
          >
            {project.name.charAt(0).toUpperCase()}
          </span>
          <span
            className={cn(
              "hidden lg:block w-1.5 h-1.5 rounded-full flex-shrink-0",
              isActive ? "bg-[#4f46e5]" : "bg-[#d1d5db]"
            )}
          />
          <div className="hidden lg:block flex-1 min-w-0">
            <span
              className={cn(
                "block text-[13px] font-medium truncate",
                isActive ? "text-[#3730a3] font-semibold" : "text-[#374151]"
              )}
            >
              {project.name}
            </span>
            <span className="block text-[11px] text-[#9ca3af] mt-0.5">
              {relativeTime(project.updatedAt)}
            </span>
          </div>
        </Link>

        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label={`${project.name} 操作`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRename(true); }}
              >
                <Pencil className="w-4 h-4 mr-2" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowConfirm(true); }}
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
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowConfirm(false)}
          isLoading={isDeleting}
        />
      )}

      {showRename && (
        <RenameProjectDialog
          projectName={project.name}
          onConfirm={handleConfirmRename}
          onCancel={() => setShowRename(false)}
          isLoading={isRenaming}
        />
      )}
    </>
  );
}
