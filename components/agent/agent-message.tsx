"use client";

import { AGENTS } from "@/lib/types";
import { ThinkingIndicator } from "@/components/agent/thinking-indicator";
import { PmOutputCard } from "@/components/agent/pm-output-card";
import { cn } from "@/lib/utils";
import type { ProjectMessage } from "@/lib/types";
import { extractPmOutput } from "@/lib/extract-json";

interface AgentMessageProps {
  message: ProjectMessage;
  isStreaming?: boolean;
  isThinking?: boolean;
}

function getBubbleClasses(role: string): string {
  switch (role) {
    case "pm": return "bg-[#eef2ff] border border-[#e0e7ff]";
    case "architect": return "bg-[#f5f3ff] border border-[#ede9fe]";
    case "engineer": return "bg-[#f0fdf4] border border-[#dcfce7]";
    default: return "bg-[#f9fafb] border border-[#f3f4f6]";
  }
}

function getAvatarBg(role: string): string {
  switch (role) {
    case "pm": return "#eef2ff";
    case "architect": return "#f5f3ff";
    case "engineer": return "#f0fdf4";
    default: return "#f3f4f6";
  }
}

export function AgentMessage({
  message,
  isStreaming,
  isThinking,
}: AgentMessageProps) {
  const isUser = message.role === "user";
  const agent = !isUser ? AGENTS[message.role as keyof typeof AGENTS] : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-[#4f46e5] text-white rounded-[16px_16px_4px_16px] px-4 py-2.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 max-w-[90%]">
      {/* Avatar */}
      <div
        className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 text-base shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
        style={{ background: getAvatarBg(message.role) }}
      >
        {agent?.avatar}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[11px] font-semibold"
            style={{ color: agent?.color }}
          >
            {agent?.role}
          </span>
          {isThinking && (
            <span className="text-[11px] text-[#9ca3af]">正在思考...</span>
          )}
          {isStreaming && !isThinking && (
            <span className="text-[11px] text-[#9ca3af]">生成中</span>
          )}
        </div>

        <div
          className={cn(
            "rounded-[4px_16px_16px_16px] px-4 py-3 text-sm",
            getBubbleClasses(message.role)
          )}
        >
          {isThinking ? (
            <ThinkingIndicator color={agent?.color} />
          ) : (() => {
            const pmData =
              message.role === "pm" && !isStreaming
                ? extractPmOutput(message.content)
                : null;
            return pmData ? (
              <PmOutputCard data={pmData} />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-gray-800 text-sm leading-relaxed">
                {message.content}
                {isStreaming && (
                  <span className="inline-block w-0.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-middle" />
                )}
              </pre>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
