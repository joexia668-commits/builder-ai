"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ConversationSidebar } from "@/components/sidebar/conversation-sidebar";
import { ChatArea } from "@/components/workspace/chat-area";
import { PreviewPanel } from "@/components/preview/preview-panel";
import type { Project, ProjectMessage, ProjectVersion } from "@/lib/types";

interface WorkspaceProps {
  project: Project & {
    messages: ProjectMessage[];
    versions: ProjectVersion[];
  };
  allProjects: { id: string; name: string; updatedAt: Date }[];
}

type MobileTab = "chat" | "preview";

export function Workspace({ project, allProjects }: WorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");

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

  const [currentCode, setCurrentCode] = useState<string>(
    project.versions[project.versions.length - 1]?.code ?? ""
  );
  const [versions, setVersions] = useState<ProjectVersion[]>(project.versions);
  const [messages, setMessages] = useState<ProjectMessage[]>(project.messages);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewingVersion, setPreviewingVersion] = useState<ProjectVersion | null>(null);

  const displayCode = previewingVersion?.code ?? currentCode;

  function handleRestoreVersion(newVersion: ProjectVersion) {
    setCurrentCode(newVersion.code);
    setVersions((prev) => [...prev, newVersion]);
    setPreviewingVersion(null);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
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

        {/* Chat area: full on desktop/tablet, conditionally shown on mobile */}
        <div
          className={`flex-1 flex flex-col overflow-hidden border-r md:flex ${
            mobileTab === "chat" ? "flex" : "hidden md:flex"
          }`}
        >
          <ChatArea initialModel={project.preferredModel ?? undefined}
            project={project}
            messages={messages}
            onMessagesChange={setMessages}
            onGeneratingChange={setIsGenerating}
            isPreviewingHistory={previewingVersion !== null}
            onCodeGenerated={(code, version) => {
              setCurrentCode(code);
              setVersions((prev) => [...prev, version]);
              setPreviewingVersion(null);
            }}
          />
        </div>

        {/* Preview panel: full on desktop/tablet, conditionally shown on mobile */}
        <div
          className={`relative flex-1 flex flex-col overflow-hidden ${
            mobileTab === "preview" ? "flex" : "hidden md:flex"
          }`}
        >
          <PreviewPanel
            code={displayCode}
            projectId={project.id}
            isGenerating={isGenerating}
            onCodeChange={setCurrentCode}
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={setPreviewingVersion}
            onVersionRestore={handleRestoreVersion}
          />
        </div>
      </div>
    </div>
  );
}
