"use client";

import { cn } from "@/lib/utils";
import { AGENTS, AGENT_ORDER } from "@/lib/types";
import type { AgentRole, AgentState, EngineerProgress } from "@/lib/types";
import { ThinkingIndicator } from "@/components/agent/thinking-indicator";

interface AgentStatusBarProps {
  agentStates: Record<AgentRole, AgentState>;
  isGenerating: boolean;
  engineerProgress?: EngineerProgress | null;
}

export function AgentStatusBar({
  agentStates,
  isGenerating,
  engineerProgress,
}: AgentStatusBarProps) {
  return (
    <div data-testid="agent-status-bar" className="border-b bg-white px-4 py-2 flex items-center gap-2">
      {AGENT_ORDER.map((role, index) => {
        const agent = AGENTS[role];
        const state = agentStates[role];
        const isDone = state.status === "done";
        const isActive =
          state.status === "thinking" || state.status === "streaming";
        const isIdle = state.status === "idle";

        return (
          <div key={role} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                isDone && "bg-emerald-50 border-emerald-200 text-emerald-700",
                isActive && "border-2 text-white",
                isIdle && !isGenerating && "bg-gray-50 border-gray-200 text-gray-400",
                isIdle && isGenerating && "bg-gray-50 border-gray-200 text-gray-300 opacity-50"
              )}
              style={
                isActive
                  ? { borderColor: agent.color, backgroundColor: agent.color }
                  : undefined
              }
            >
              <span>{agent.avatar}</span>
              <span>{agent.role}</span>
              {isDone && <span>✓</span>}
              {isActive && <ThinkingIndicator color="white" />}
            </div>

            {/* Engineer sub-progress */}
            {role === "engineer" && isActive && engineerProgress && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>
                    第 {engineerProgress.currentLayer}/{engineerProgress.totalLayers} 层
                  </span>
                  <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{
                        width: `${(engineerProgress.completedFiles.length / engineerProgress.totalFiles) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-gray-400">
                    {engineerProgress.completedFiles.length}/{engineerProgress.totalFiles}
                  </span>
                </div>
                {engineerProgress.retryInfo && (
                  <div className="text-[11px] text-amber-600 leading-tight">
                    Layer {engineerProgress.retryInfo.layerIdx + 1} 重试{" "}
                    {engineerProgress.retryInfo.attempt}/
                    {engineerProgress.retryInfo.maxAttempts}
                    {engineerProgress.retryInfo.reason === "parse_failed" && "（上次输出截断）"}
                    {engineerProgress.retryInfo.reason === "per_file_fallback" && "（逐文件回退）"}
                    {engineerProgress.retryInfo.failedSubset.length > 0 && (
                      <>
                        ：
                        {engineerProgress.retryInfo.failedSubset
                          .map((p) => p.split("/").pop())
                          .join(", ")}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {index < AGENT_ORDER.length - 1 && (
              <span className="text-gray-300 text-xs">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
