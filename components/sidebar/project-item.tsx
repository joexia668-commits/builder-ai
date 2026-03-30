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
            "flex flex-col items-center lg:items-start px-2 lg:px-3 py-2.5 hover:bg-gray-100 transition-colors border-l-2 rounded-r pr-8",
            isActive
              ? "border-indigo-500 bg-indigo-50 hover:bg-indigo-50"
              : "border-transparent"
          )}
        >
          {/* Tablet: first letter icon */}
          <span
            className={cn(
              "lg:hidden w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
              isActive
                ? "bg-indigo-200 text-indigo-700"
                : "bg-gray-200 text-gray-600"
            )}
          >
            {project.name.charAt(0).toUpperCase()}
          </span>
          {/* Desktop: full text */}
          <span
            className={cn(
              "hidden lg:block text-sm font-medium truncate w-full",
              isActive ? "text-indigo-700" : "text-gray-700"
            )}
          >
            {project.name}
          </span>
          <span className="hidden lg:block text-xs text-gray-400 mt-0.5">
            {new Date(project.updatedAt).toLocaleDateString("zh-CN", {
              month: "short",
              day: "numeric",
            })}
          </span>
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
