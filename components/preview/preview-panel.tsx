"use client";

import { useState, useRef, useEffect } from "react";
import { PreviewFrame } from "@/components/preview/preview-frame";
import { FileTreeCodeViewer } from "@/components/preview/file-tree-code-viewer";
import { VersionTimeline } from "@/components/timeline/version-timeline";
import { fetchAPI } from "@/lib/api-client";
import type { ProjectVersion, LiveFileStream, EngineerProgress } from "@/lib/types";

type Tab = "preview" | "code";
type DeployState = "idle" | "building" | "ready" | "error";

interface PreviewPanelProps {
  files: Record<string, string>;
  projectId: string;
  isGenerating: boolean;
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onVersionRestore: (newVersion: ProjectVersion) => void;
  latestVersionId?: string;
  liveStreams: Record<string, LiveFileStream>;
  engineerProgress: EngineerProgress | null;
}

export function PreviewPanel({
  files,
  projectId,
  isGenerating,
  versions,
  previewingVersion,
  onPreviewVersion,
  onVersionRestore,
  latestVersionId,
  liveStreams,
  engineerProgress,
}: PreviewPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [isExporting, setIsExporting] = useState(false);
  const [deployState, setDeployState] = useState<DeployState>("idle");
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasCode = Object.values(files).some((code) => code.length > 0);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (deployPollRef.current) clearInterval(deployPollRef.current);
    };
  }, []);

  const userOverrideRef = useRef(false);
  const prevGeneratingRef = useRef(isGenerating);

  useEffect(() => {
    const prev = prevGeneratingRef.current;
    prevGeneratingRef.current = isGenerating;

    // Rising edge: generation just started — auto-switch to code unless overridden
    if (!prev && isGenerating && !userOverrideRef.current) {
      setTab("code");
      return;
    }

    // Falling edge: generation just ended — switch back to preview after a short
    // delay. Return cleanup so the timer is cancelled if generation restarts first.
    if (prev && !isGenerating) {
      const timer = setTimeout(() => {
        if (!userOverrideRef.current) setTab("preview");
        userOverrideRef.current = false;
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isGenerating]);

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

  async function handleDeploy() {
    if (!latestVersionId) return;
    setDeployState("building");
    setDeployUrl(null);

    try {
      const res = await fetchAPI("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, versionId: latestVersionId }),
      });
      if (!res.ok) throw new Error("Deploy failed");
      const { deploymentId } = await res.json() as { deploymentId: string };

      deployPollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetchAPI(`/api/deploy/${deploymentId}`);
          if (!pollRes.ok) return;
          const { status, url } = await pollRes.json() as { status: string; url: string };

          if (status === "ready") {
            clearInterval(deployPollRef.current!);
            deployPollRef.current = null;
            setDeployState("ready");
            setDeployUrl(url);
          } else if (status === "error") {
            clearInterval(deployPollRef.current!);
            deployPollRef.current = null;
            setDeployState("error");
          }
        } catch {
          // network error during poll — keep retrying
        }
      }, 3000);
    } catch {
      setDeployState("error");
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 min-w-0">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex gap-[1px] bg-[#f3f4f6] p-[2px] rounded-lg">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={`tab-${t}`}
              onClick={() => {
                setTab(t);
                userOverrideRef.current = true;
              }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                tab === t
                  ? "bg-white text-[#111827] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "text-[#6b7280] hover:text-[#374151]"
              }`}
            >
              {t === "preview" ? "预览" : "代码"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {hasCode && (
            <>
              <button
                data-testid="btn-export"
                disabled={isGenerating || isExporting || !latestVersionId}
                onClick={handleExport}
                className="h-[28px] px-[10px] rounded-md text-[11px] font-medium border border-[#e5e7eb] bg-white text-[#374151] hover:border-[#c7d2fe] hover:bg-[#fafafa] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
              >
                {isExporting ? "导出中..." : "Export ↓"}
              </button>
              <button
                data-testid="btn-deploy"
                disabled={isGenerating || deployState === "building" || !latestVersionId}
                onClick={handleDeploy}
                className={`h-[28px] px-[10px] rounded-md text-[11px] font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
                  deployState === "ready"
                    ? "bg-green-100 text-green-700 border border-green-200"
                    : deployState === "error"
                    ? "bg-red-100 text-red-700 border border-red-200"
                    : "bg-[#4f46e5] text-white hover:bg-[#4338ca]"
                }`}
              >
                {deployState === "building"
                  ? "部署中..."
                  : deployState === "ready"
                  ? "已部署 ↗"
                  : deployState === "error"
                  ? "部署失败"
                  : "Deploy ↗"}
              </button>
              {deployUrl && (
                <a
                  data-testid="deploy-url"
                  href={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline truncate max-w-[160px]"
                >
                  {deployUrl.replace("https://", "")}
                </a>
              )}
            </>
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
              <div className="flex flex-col items-center justify-center h-full gap-3 bg-[#f9fafb] text-center px-8">
                <div className="w-[44px] h-[44px] rounded-[12px] bg-gradient-to-br from-[#eef2ff] to-[#ede9fe] border border-[#e0e7ff] flex items-center justify-center text-xl">
                  🏗️
                </div>
                <p className="font-semibold text-[#374151]">BuilderAI</p>
                <p className="text-sm text-[#9ca3af]">等待生成 — 在左侧输入需求，AI 将为你生成应用</p>
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
          <FileTreeCodeViewer
            files={files}
            liveStreams={liveStreams}
            engineerProgress={engineerProgress}
            isGenerating={isGenerating}
          />
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
