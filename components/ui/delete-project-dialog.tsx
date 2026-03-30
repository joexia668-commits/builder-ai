"use client";

import { Button } from "@/components/ui/button";

interface DeleteProjectDialogProps {
  readonly projectName: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly isLoading: boolean;
}

export function DeleteProjectDialog({
  projectName,
  onConfirm,
  onCancel,
  isLoading,
}: DeleteProjectDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={!isLoading ? onCancel : undefined}
      />
      <div className="relative z-10 bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4">
        <h2
          id="delete-dialog-title"
          className="text-lg font-semibold text-gray-900 mb-2"
        >
          删除项目
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          确认删除「{projectName}」？此操作不可撤销，所有对话记录和版本历史将永久删除。
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "删除中..." : "删除"}
          </Button>
        </div>
      </div>
    </div>
  );
}
