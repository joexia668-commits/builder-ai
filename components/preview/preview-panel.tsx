"use client";

import { useState } from "react";
import { PreviewFrame } from "@/components/preview/preview-frame";
import { MultiFileEditor } from "@/components/preview/multi-file-editor";
import { VersionTimeline } from "@/components/timeline/version-timeline";
import { fetchAPI } from "@/lib/api-client";
import type { ProjectVersion } from "@/lib/types";

type Tab = "preview" | "code";

interface PreviewPanelProps {
  files: Record<string, string>;
  projectId: string;
  isGenerating: boolean;
  onFilesChange: (files: Record<string, string>) => void;
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onVersionRestore: (newVersion: ProjectVersion) => void;
  latestVersionId?: string;
}

export function PreviewPanel({
  files,
  projectId,
  isGenerating,
  onFilesChange,
  versions,
  previewingVersion,
  onPreviewVersion,
  onVersionRestore,
  latestVersionId,
}: PreviewPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [isExporting, setIsExporting] = useState(false);
  const hasCode = Object.values(files).some((code) => code.length > 0);

  async function handleExport() {
    if (!latestVersionId) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ projectId, versionId: latestVersionId });
      const res = await fetchAPI(`/api/export?${params}`, { method: 'GET' });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 min-w-0">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex gap-1">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={`tab-${t}`}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {t === "preview" ? "预览" : "代码"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {hasCode && (
            <button
              data-testid="btn-export"
              disabled={isGenerating || isExporting || !latestVersionId}
              onClick={handleExport}
              className="px-3 py-1 rounded text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isExporting ? "导出中..." : "Export ↓"}
            </button>
          )}
          <span className="text-xs text-gray-400">⚡ Sandpack</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "preview" ? (
          <div className="flex-1 overflow-hidden relative">
            {hasCode ? (
              <PreviewFrame files={files} projectId={projectId} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 bg-gray-50 text-center px-8">
                <div className="text-5xl">🏗️</div>
                <p className="font-semibold text-gray-700">BuilderAI</p>
                <p className="text-sm text-gray-400">等待生成 — 在左侧输入需求，AI 将为你生成应用</p>
              </div>
            )}
            {isGenerating && (
              <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-48 h-4 bg-gray-200 rounded animate-pulse" />
                  <div className="w-32 h-4 bg-gray-200 rounded animate-pulse" />
                  <p className="text-sm text-muted-foreground">正在生成中...</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <MultiFileEditor files={files} onFilesChange={onFilesChange} />
        )}

        {versions.length > 0 && (
          <VersionTimeline
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={onPreviewVersion}
            onRestoreVersion={onVersionRestore}
            isGenerating={isGenerating}
          />
        )}
      </div>
    </div>
  );
}
