"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RenameProjectDialogProps {
  readonly projectName: string;
  readonly onConfirm: (newName: string) => void;
  readonly onCancel: () => void;
  readonly isLoading?: boolean;
}

export function RenameProjectDialog({ projectName, onConfirm, onCancel, isLoading = false }: RenameProjectDialogProps) {
  const [name, setName] = useState(projectName);

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === projectName) return;
    onConfirm(trimmed);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={!isLoading ? onCancel : undefined} />
      <div className="relative z-10 bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4">
        <h2 id="rename-dialog-title" className="text-lg font-semibold text-gray-900 mb-4">重命名项目</h2>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          autoFocus
          className="mb-4"
        />
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>取消</Button>
          <Button onClick={handleConfirm} disabled={!name.trim() || name.trim() === projectName || isLoading}>
            {isLoading ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
