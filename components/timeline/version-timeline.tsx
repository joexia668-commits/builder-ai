"use client";

import { useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";
import { fetchAPI } from "@/lib/api-client";
import { toast } from "sonner";
import type { ProjectVersion } from "@/lib/types";

interface VersionTimelineProps {
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onRestoreVersion: (newVersion: ProjectVersion) => void;
  isGenerating?: boolean;
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function VersionTimeline({
  versions,
  previewingVersion,
  onPreviewVersion,
  onRestoreVersion,
  isGenerating = false,
}: VersionTimelineProps) {
  const [restoring, setRestoring] = useState(false);
  const mounted = useMounted();

  const currentVersion = versions[versions.length - 1];

  async function handleRestore() {
    if (!previewingVersion) return;
    setRestoring(true);
    try {
      const res = await fetchAPI(`/api/versions/${previewingVersion.id}/restore`, {
        method: "POST",
      });
      const newVersion = await res.json() as ProjectVersion;
      onRestoreVersion(newVersion);
      onPreviewVersion(null);
      toast.success(`已恢复到 v${previewingVersion.versionNumber}`);
    } catch {
      toast.error("恢复失败，请重试");
    } finally {
      setRestoring(false);
    }
  }

  function handleNodeClick(version: ProjectVersion) {
    const isCurrent = version.id === currentVersion?.id;
    if (isCurrent || version.id === previewingVersion?.id) {
      // Clicking current or already-previewing node clears preview
      onPreviewVersion(null);
    } else {
      onPreviewVersion(version);
    }
  }

  return (
    <div className="border-t bg-white shrink-0">
      {previewingVersion && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs">
          <span className="text-amber-700">
            正在预览 v{previewingVersion.versionNumber}
            {previewingVersion.description
              ? ` — ${previewingVersion.description}`
              : ""}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="text-indigo-600 font-medium hover:underline disabled:opacity-50"
            >
              恢复此版本
            </button>
            <button
              onClick={() => onPreviewVersion(null)}
              className="text-gray-500 hover:underline"
            >
              返回当前
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="flex items-start gap-2 px-4 py-3 min-w-max">
          {versions.map((version, index) => {
            const isLast = index === versions.length - 1;
            const isPreviewing = previewingVersion?.id === version.id;

            return (
              <div key={version.id} className={cn("flex items-start gap-2", isGenerating && "opacity-40")}>
                <button
                  data-testid={`version-node-v${version.versionNumber}`}
                  onClick={() => !isGenerating && handleNodeClick(version)}
                  disabled={isGenerating}
                  className="flex flex-col items-center gap-1 group max-w-[60px]"
                >
                  <div
                    className={cn(
                      "rounded-full border-2 transition-all mt-0.5",
                      isLast && !isPreviewing
                        ? "w-3 h-3 bg-indigo-500 border-indigo-500"
                        : isPreviewing
                        ? "w-3 h-3 bg-amber-400 border-amber-400"
                        : "w-2.5 h-2.5 bg-white border-gray-300 group-hover:border-indigo-400"
                    )}
                  />
                  <span className="text-[10px] text-gray-500 font-medium">
                    v{version.versionNumber}
                  </span>
                  {version.description && (
                    <span className="text-[9px] text-gray-400 truncate w-full text-center leading-tight">
                      {version.description}
                    </span>
                  )}
                  <span className="text-[9px] text-gray-300">
                    {mounted ? formatTime(version.createdAt) : "--:--"}
                  </span>
                </button>

                {!isLast && (
                  <div className="w-6 h-px bg-gray-200 mt-2 self-start" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
