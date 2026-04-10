"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";

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
}: ProjectItemProps) {
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
          {/* Left-bar active indicator (desktop only) */}
          {isActive && (
            <span className="hidden lg:block absolute left-0 top-1 bottom-1 w-[3px] bg-[#4f46e5] rounded-r-sm" />
          )}

          {/* Tablet: first letter circle */}
          <span
            className={cn(
              "lg:hidden w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
              isActive
                ? "bg-indigo-200 text-indigo-700"
                : "bg-gray-200 text-gray-600"
            )}
          >
            {project.name.charAt(0).toUpperCase()}
          </span>

          {/* Desktop: dot + name + time */}
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

        <button
          onClick={handleDeleteClick}
          aria-label={`删除 ${project.name}`}
          className={cn(
            "absolute right-1 top-1/2 -translate-y-1/2",
            "w-6 h-6 flex items-center justify-center rounded",
            "text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors",
            "opacity-0 group-hover/item:opacity-100 focus:opacity-100"
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
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
