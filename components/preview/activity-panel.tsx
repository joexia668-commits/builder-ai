"use client";

import { useRef } from "react";
import { FileBlock } from "@/components/preview/file-block";
import { useAutoScrollToBottom } from "@/hooks/use-auto-scroll-to-bottom";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

interface ActivityPanelProps {
  readonly liveStreams: Record<string, LiveFileStream>;
  readonly engineerProgress: EngineerProgress | null;
  readonly currentModule?: string | null;
}

export function ActivityPanel({ liveStreams, engineerProgress, currentModule }: ActivityPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const streams = Object.values(liveStreams);

  useAutoScrollToBottom(containerRef, [
    streams.length,
    streams.reduce((sum, s) => sum + s.content.length, 0),
  ]);

  return (
    <div
      ref={containerRef}
      data-testid="activity-panel"
      className="h-full overflow-auto font-mono text-xs bg-zinc-950 text-zinc-100 p-4"
    >
      {engineerProgress !== null && (
        <div className="sticky top-0 bg-zinc-950/95 border-b border-zinc-800 pb-2 mb-3 text-zinc-400">
          Layer {engineerProgress.currentLayer}/{engineerProgress.totalLayers} ·{" "}
          {engineerProgress.completedFiles.length}/{engineerProgress.totalFiles} done
          {currentModule && (
            <span className="ml-2 text-violet-400">· {currentModule}</span>
          )}
          {engineerProgress.retryInfo !== null && (
            <span className="ml-2 text-amber-400">
              🔁 retry {engineerProgress.retryInfo.attempt}/
              {engineerProgress.retryInfo.maxAttempts}
            </span>
          )}
        </div>
      )}
      {streams.map((s) => (
        <FileBlock key={s.path} stream={s} />
      ))}
    </div>
  );
}
