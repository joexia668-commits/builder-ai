"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConversationSidebar } from "@/components/sidebar/conversation-sidebar";
import { ChatArea } from "@/components/workspace/chat-area";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getVersionFiles } from "@/lib/version-files";
import { useGenerationSession } from "@/hooks/use-generation-session";
import type { Project, ProjectMessage, ProjectVersion, IterationContext } from "@/lib/types";

interface WorkspaceProps {
  project: Project & {
    messages: ProjectMessage[];
    versions: ProjectVersion[];
  };
  allProjects: { id: string; name: string; updatedAt: Date }[];
  isDemo?: boolean;
}

type MobileTab = "chat" | "preview";

export function Workspace({ project, allProjects, isDemo = false }: WorkspaceProps) {
  const router = useRouter();
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const { liveStreams, engineerProgress } = useGenerationSession(project.id);

  useEffect(() => {
    function handleOffline() {
      toast.error("网络已断开，请检查你的网络连接");
    }
    function handleOnline() {
      toast.success("网络已恢复");
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const lastVersion = project.versions[project.versions.length - 1];
  const [currentFiles, setCurrentFiles] = useState<Record<string, string>>(
    lastVersion ? getVersionFiles(lastVersion as { code: string; files?: Record<string, string> | null }) : {}
  );
  const [versions, setVersions] = useState<ProjectVersion[]>(project.versions);
  const [messages, setMessages] = useState<ProjectMessage[]>(project.messages);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewingVersion, setPreviewingVersion] = useState<ProjectVersion | null>(null);
  const [iterationContext, setIterationContext] = useState<IterationContext | null>(
    project.iterationContext ?? null
  );

  const displayFiles = previewingVersion
    ? getVersionFiles(previewingVersion as { code: string; files?: Record<string, string> | null })
    : currentFiles;

  function handleRestoreVersion(newVersion: ProjectVersion) {
    setCurrentFiles(
      getVersionFiles(newVersion as { code: string; files?: Record<string, string> | null })
    );
    setVersions((prev) => [...prev, newVersion]);
    setPreviewingVersion(null);
    // Sync iterationContext if the restored version carried a snapshot
    if (newVersion.iterationSnapshot) {
      setIterationContext(newVersion.iterationSnapshot);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {isDemo && <DemoBanner />}
      {/* Mobile tab bar — visible only on mobile (<768px) */}
      <div className="flex md:hidden border-b bg-white shrink-0">
        <button
          data-testid="mobile-tab-chat"
          data-active={mobileTab === "chat"}
          onClick={() => setMobileTab("chat")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mobileTab === "chat"
              ? "text-indigo-600 border-b-2 border-indigo-600"
              : "text-gray-500"
          }`}
        >
          对话
        </button>
        <button
          data-testid="mobile-tab-preview"
          data-active={mobileTab === "preview"}
          onClick={() => setMobileTab("preview")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            mobileTab === "preview"
              ? "text-indigo-600 border-b-2 border-indigo-600"
              : "text-gray-500"
          }`}
        >
          预览
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar: hidden on mobile, icon-only on tablet, full on desktop */}
        <div className="hidden md:flex shrink-0">
          <ConversationSidebar
            currentProjectId={project.id}
            projects={allProjects}
          />
        </div>

        {/* Chat area */}
        <div
          className={`flex-1 flex flex-col overflow-hidden border-r md:flex ${
            mobileTab === "chat" ? "flex" : "hidden md:flex"
          }`}
        >
          <ChatArea
            initialModel={project.preferredModel ?? undefined}
            project={project}
            messages={messages}
            onMessagesChange={setMessages}
            onGeneratingChange={setIsGenerating}
            isPreviewingHistory={previewingVersion !== null}
            isDemo={isDemo}
            currentFiles={currentFiles}
            iterationContext={iterationContext}
            onIterationContextChange={setIterationContext}
            onFilesGenerated={(files, version) => {
              setCurrentFiles(files);
              setVersions((prev) => [...prev, version]);
              setPreviewingVersion(null);
            }}
            onNewProject={() => router.push("/")}
          />
        </div>

        {/* Preview panel */}
        <div
          className={`relative flex-1 flex flex-col overflow-hidden ${
            mobileTab === "preview" ? "flex" : "hidden md:flex"
          }`}
        >
          <PreviewPanel
            files={displayFiles}
            projectId={project.id}
            isGenerating={isGenerating}
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={setPreviewingVersion}
            onVersionRestore={handleRestoreVersion}
            latestVersionId={versions[versions.length - 1]?.id}
            liveStreams={liveStreams}
            engineerProgress={engineerProgress}
          />
        </div>
      </div>
    </div>
  );
}
