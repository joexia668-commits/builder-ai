"use client";

import { AGENTS } from "@/lib/types";
import { ThinkingIndicator } from "@/components/agent/thinking-indicator";
import { cn } from "@/lib/utils";
import type { ProjectMessage } from "@/lib/types";

interface AgentMessageProps {
  message: ProjectMessage;
  isStreaming?: boolean;
  isThinking?: boolean;
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
        <div className="max-w-[75%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 max-w-[90%]">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-base border-2"
        style={{ borderColor: agent?.color ?? "#e5e7eb" }}
      >
        {agent?.avatar}
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-xs font-semibold"
            style={{ color: agent?.color }}
          >
            {agent?.role}
          </span>
          {isThinking && (
            <span className="text-xs text-gray-400">正在思考...</span>
          )}
          {isStreaming && !isThinking && (
            <span className="text-xs text-gray-400">生成中</span>
          )}
        </div>

        <div
          className={cn(
            "rounded-2xl rounded-tl-sm px-4 py-3 text-sm border-l-2 bg-gray-50"
          )}
          style={{ borderLeftColor: agent?.color ?? "#e5e7eb" }}
        >
          {isThinking ? (
            <ThinkingIndicator color={agent?.color} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-gray-800 text-sm leading-relaxed">
              {message.content}
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-middle" />
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
