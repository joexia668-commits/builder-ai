"use client";

import { cn } from "@/lib/utils";
import { AGENTS, AGENT_ORDER } from "@/lib/types";
import type { AgentRole, AgentState } from "@/lib/types";
import { ThinkingIndicator } from "@/components/agent/thinking-indicator";

interface AgentStatusBarProps {
  agentStates: Record<AgentRole, AgentState>;
  isGenerating: boolean;
}

export function AgentStatusBar({
  agentStates,
  isGenerating,
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

            {index < AGENT_ORDER.length - 1 && (
              <span className="text-gray-300 text-xs">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
