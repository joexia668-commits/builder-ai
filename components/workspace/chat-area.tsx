"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { AgentStatusBar } from "@/components/agent/agent-status-bar";
import { AgentMessage } from "@/components/agent/agent-message";
import { ChatInput } from "@/components/workspace/chat-input";
import { fetchAPI } from "@/lib/api-client";
import { DEFAULT_MODEL_ID, getAvailableModels } from "@/lib/model-registry";
import type {
  Project,
  ProjectMessage,
  ProjectVersion,
  AgentState,
  AgentRole,
} from "@/lib/types";
import { AGENT_ORDER, AGENTS } from "@/lib/types";

interface ChatAreaProps {
  project: Project;
  messages: ProjectMessage[];
  onMessagesChange: (messages: ProjectMessage[]) => void;
  onCodeGenerated: (code: string, version: ProjectVersion) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  isPreviewingHistory?: boolean;
  initialModel?: string;
}

const TRANSITION_MESSAGES: Partial<Record<AgentRole, string>> = {
  pm: "PM 已将需求文档移交给架构师...",
  architect: "架构师已将技术方案移交给工程师...",
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ChatArea({
  project,
  messages,
  onMessagesChange,
  onCodeGenerated,
  onGeneratingChange,
  isPreviewingHistory = false,
  initialModel,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const persistModelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string>("");
  const [transitionText, setTransitionText] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(
    initialModel ?? DEFAULT_MODEL_ID
  );
  const [agentStates, setAgentStates] = useState<Record<AgentRole, AgentState>>(
    {
      pm: { role: "pm", status: "idle", output: "" },
      architect: { role: "architect", status: "idle", output: "" },
      engineer: { role: "engineer", status: "idle", output: "" },
    }
  );

  // Derive available model IDs from env (server-rendered env vars exposed via NEXT_PUBLIC_*)
  // We pass process.env subset; only NEXT_PUBLIC_* are available client-side
  const availableModelIds = getAvailableModels({
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.NEXT_PUBLIC_GEMINI_CONFIGURED ?? "",
    DEEPSEEK_API_KEY: process.env.NEXT_PUBLIC_DEEPSEEK_CONFIGURED ?? "",
    GROQ_API_KEY: process.env.NEXT_PUBLIC_GROQ_CONFIGURED ?? "",
  }).map((m) => m.id);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentStates, transitionText]);

  function updateAgentState(role: AgentRole, update: Partial<AgentState>) {
    setAgentStates((prev) => ({
      ...prev,
      [role]: { ...prev[role], ...update },
    }));
  }

  async function persistMessage(
    role: string,
    content: string,
    metadata?: Record<string, unknown>
  ) {
    try {
      await fetchAPI("/api/messages", {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, role, content, metadata }),
      });
    } catch {
      // Non-fatal: message displayed in UI even if DB write fails
    }
  }

  const handleModelChange = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      // Debounce project preference persistence (500ms)
      if (persistModelTimerRef.current) clearTimeout(persistModelTimerRef.current);
      persistModelTimerRef.current = setTimeout(() => {
        fetchAPI(`/api/projects/${project.id}`, {
          method: "PATCH",
          body: JSON.stringify({ preferredModel: modelId }),
        }).catch(() => {
          // Non-fatal
        });
      }, 500);
    },
    [project.id]
  );

  function stopGeneration() {
    abortControllerRef.current?.abort();
  }

  async function handleSubmit(prompt: string) {
    if (isGenerating) return;
    setGenerationError(null);
    setLastPrompt(prompt);
    setIsGenerating(true);
    onGeneratingChange?.(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setAgentStates({
      pm: { role: "pm", status: "idle", output: "" },
      architect: { role: "architect", status: "idle", output: "" },
      engineer: { role: "engineer", status: "idle", output: "" },
    });

    const userMsg: ProjectMessage = {
      id: `temp-${Date.now()}`,
      projectId: project.id,
      role: "user",
      content: prompt,
      metadata: null,
      createdAt: new Date(),
    };
    let currentMessages: ProjectMessage[] = [...messages, userMsg];
    onMessagesChange(currentMessages);
    await persistMessage("user", prompt);

    const outputs: Record<AgentRole, string> = { pm: "", architect: "", engineer: "" };
    let lastCode = "";

    try {
      for (const agentRole of AGENT_ORDER) {
        updateAgentState(agentRole, { status: "thinking", output: "" });

        const context =
          agentRole === "pm"
            ? undefined
            : agentRole === "architect"
              ? outputs.pm
              : `用户原始需求：\n${prompt}\n\nPM 需求文档：\n${outputs.pm}\n\n架构师技术方案：\n${outputs.architect}`;

        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            prompt,
            agent: agentRole,
            context,
            modelId: selectedModel,
          }),
          signal: abortController.signal,
        });

        if (!response.body) throw new Error("No response body");

        // Clear previous agent's handoff text now that this agent is streaming.
        // Doing this here (after fetch resolves) keeps the text visible during
        // the full network wait, not just the 800ms delay window.
        setTransitionText(null);
        updateAgentState(agentRole, { status: "streaming" });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let agentOutput = "";
        let sseBuffer = "";

        const processSSELines = (lines: string[]) => {
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;

            try {
              const event = JSON.parse(data) as { type: string; content?: string; code?: string; error?: string };
              if (event.type === "chunk") {
                agentOutput += event.content ?? "";
                updateAgentState(agentRole, { output: agentOutput });
              } else if (event.type === "code_complete") {
                if (event.code) lastCode = event.code;
              } else if (event.type === "error") {
                throw new Error(event.error ?? "Stream error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }

        while (true) {
          const { done, value } = await reader.read();

          sseBuffer += done
            ? decoder.decode()                        // flush残留的多字节字符
            : decoder.decode(value, { stream: true });

          const lines = sseBuffer.split("\n");
          // If stream is done, process all lines; otherwise hold the last incomplete line
          sseBuffer = done ? "" : (lines.pop() ?? "");
          processSSELines(lines);

          if (done) break;
        }

        // Process anything left in the buffer after stream ends
        if (sseBuffer.trim()) {
          processSSELines([sseBuffer]);
        }

        outputs[agentRole] = agentOutput;
        updateAgentState(agentRole, { status: "done", output: agentOutput });

        const agentMsg: ProjectMessage = {
          id: `temp-agent-${agentRole}-${Date.now()}`,
          projectId: project.id,
          role: agentRole,
          content: agentOutput,
          metadata: null,
          createdAt: new Date(),
        };
        currentMessages = [...currentMessages, agentMsg];
        onMessagesChange(currentMessages);

        await persistMessage(agentRole, agentOutput, {
          agentName: AGENTS[agentRole].name,
          agentColor: AGENTS[agentRole].color,
        });

        const handoff = TRANSITION_MESSAGES[agentRole];
        if (handoff) {
          setTransitionText(handoff);
          await delay(800);
        }
      }

      if (lastCode) {
        const res = await fetchAPI("/api/versions", {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            code: lastCode,
            description: prompt.slice(0, 80),
          }),
        });
        const version = await res.json();
        onCodeGenerated(lastCode, version);
      }
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) {
        console.error("Generation error:", err);
        const message = err instanceof Error ? err.message : "未知错误";
        setGenerationError(`生成失败：${message}`);
      }
      if (isAbort) {
        setAgentStates({
          pm: { role: "pm", status: "idle", output: "" },
          architect: { role: "architect", status: "idle", output: "" },
          engineer: { role: "engineer", status: "idle", output: "" },
        });
      }
    } finally {
      setIsGenerating(false);
      onGeneratingChange?.(false);
      setTransitionText(null);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden border-r">
      <AgentStatusBar agentStates={agentStates} isGenerating={isGenerating} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isGenerating && (
          <div className="h-full flex items-center justify-center text-center text-gray-400">
            <div>
              <div className="text-4xl mb-3">💬</div>
              <p className="font-medium text-gray-600">告诉 AI 你想要什么</p>
              <p className="text-sm mt-1">
                三个 Agent 将协作为你生成完整的 Web 应用
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <AgentMessage key={msg.id} message={msg} />
        ))}

        {isGenerating &&
          AGENT_ORDER.map((role) => {
            const state = agentStates[role];
            if (state.status === "idle" || state.status === "done") return null;
            return (
              <AgentMessage
                key={`streaming-${role}`}
                message={{
                  id: `streaming-${role}`,
                  projectId: project.id,
                  role,
                  content: state.output,
                  metadata: null,
                  createdAt: new Date(),
                }}
                isStreaming={state.status === "streaming"}
                isThinking={state.status === "thinking"}
              />
            );
          })}

        {generationError && (
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg mx-2">
            <span className="text-red-500 text-lg shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-700 font-medium">出错了</p>
              <p className="text-xs text-red-500 mt-0.5 truncate">{generationError}</p>
            </div>
            <button
              data-testid="retry-btn"
              onClick={() => handleSubmit(lastPrompt)}
              className="shrink-0 text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {transitionText && (
          <div className="flex items-center gap-2 text-sm text-gray-400 italic px-2 py-1">
            <span className="text-base">→</span>
            <span>{transitionText}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput
        onSubmit={handleSubmit}
        disabled={isGenerating || isPreviewingHistory}
        isPreviewingHistory={isPreviewingHistory}
        isGenerating={isGenerating}
        onStop={stopGeneration}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        availableModelIds={availableModelIds}
      />
    </div>
  );
}
