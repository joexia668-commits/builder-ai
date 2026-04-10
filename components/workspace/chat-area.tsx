"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { AgentStatusBar } from "@/components/agent/agent-status-bar";
import { AgentMessage } from "@/components/agent/agent-message";
import { ChatInput } from "@/components/workspace/chat-input";
import { fetchAPI } from "@/lib/api-client";
import { DEFAULT_MODEL_ID, getAvailableModels } from "@/lib/model-registry";
import { topologicalSort } from "@/lib/topo-sort";
import { extractPmOutput, extractScaffoldFromTwoPhase } from "@/lib/extract-json";
import { runLayerWithFallback } from "@/lib/engineer-circuit";
import { getMultiFileEngineerPrompt } from "@/lib/generate-prompts";
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildPmIterationContext,
} from "@/lib/agent-context";
import { classifyIntent } from "@/lib/intent-classifier";
import type {
  Project,
  ProjectMessage,
  ProjectVersion,
  AgentState,
  AgentRole,
  PmOutput,
  EngineerProgress,
  ScaffoldFile,
} from "@/lib/types";
import { AGENT_ORDER, AGENTS } from "@/lib/types";

interface ChatAreaProps {
  project: Project;
  messages: ProjectMessage[];
  onMessagesChange: (messages: ProjectMessage[]) => void;
  onFilesGenerated: (files: Record<string, string>, version: ProjectVersion) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  isPreviewingHistory?: boolean;
  initialModel?: string;
  currentFiles?: Record<string, string>;
  lastPmOutput?: PmOutput | null;
  onPmOutputGenerated?: (pm: PmOutput) => void;
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
  onFilesGenerated,
  onGeneratingChange,
  isPreviewingHistory = false,
  initialModel,
  currentFiles = {},
  lastPmOutput,
  onPmOutputGenerated,
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
  const [engineerProgress, setEngineerProgress] = useState<EngineerProgress | null>(null);

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

  async function readEngineerSSE(
    body: ReadableStream<Uint8Array>
  ): Promise<Record<string, string>> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let layerResult: Record<string, string> | null = null;

    const processLines = (lines: string[]) => {
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data) as {
            type: string;
            content?: string;
            code?: string;
            files?: Record<string, string>;
            error?: string;
          };
          if (event.type === "files_complete" && event.files) {
            layerResult = event.files;
          } else if (event.type === "code_complete" && event.code) {
            layerResult = { "/App.js": event.code };
          } else if (event.type === "error") {
            throw new Error(event.error ?? "Stream error");
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) continue;
          throw parseErr;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      sseBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = done ? "" : (lines.pop() ?? "");
      processLines(lines);
      if (done) break;
    }
    if (sseBuffer.trim()) processLines([sseBuffer]);

    if (!layerResult) throw new Error("No files received from engineer");
    return layerResult;
  }

  async function handleSubmit(prompt: string) {
    if (isGenerating) return;
    setGenerationError(null);
    setLastPrompt(prompt);
    setIsGenerating(true);
    onGeneratingChange?.(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Phase 0: classify intent to route pipeline
    const hasExistingCode = Object.keys(currentFiles).length > 0;
    const intent = classifyIntent(prompt, hasExistingCode);

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
    let parsedPm: PmOutput | null = null;
    let lastCode = "";

    try {
      // Direct path: bug_fix / style_change skips PM + Architect
      if (intent === "bug_fix" || intent === "style_change") {
        updateAgentState("engineer", { status: "thinking", output: "" });
        const directContext = buildDirectEngineerContext(prompt, currentFiles);

        const directResponse = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            prompt,
            agent: "engineer",
            context: directContext,
            modelId: selectedModel,
          }),
          signal: abortController.signal,
        });

        if (!directResponse.ok) {
          const errorText = await directResponse.text();
          throw new Error(`HTTP ${directResponse.status}: ${errorText.slice(0, 200)}`);
        }
        if (!directResponse.body) throw new Error("No response body");

        updateAgentState("engineer", { status: "streaming" });

        const directReader = directResponse.body.getReader();
        const directDecoder = new TextDecoder();
        let directOutput = "";
        let directSseBuffer = "";
        let directCode = "";

        const processDirectLines = (lines: string[]) => {
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const event = JSON.parse(data) as { type: string; content?: string; code?: string; error?: string };
              if (event.type === "chunk") {
                directOutput += event.content ?? "";
                updateAgentState("engineer", { output: directOutput });
              } else if (event.type === "code_complete") {
                if (event.code) directCode = event.code;
              } else if (event.type === "reset") {
                directOutput = "";
                updateAgentState("engineer", { output: "" });
              } else if (event.type === "error") {
                throw new Error(event.error ?? "Stream error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        };

        while (true) {
          const { done, value } = await directReader.read();
          directSseBuffer += done
            ? directDecoder.decode()
            : directDecoder.decode(value, { stream: true });
          const lines = directSseBuffer.split("\n");
          directSseBuffer = done ? "" : (lines.pop() ?? "");
          processDirectLines(lines);
          if (done) break;
        }
        if (directSseBuffer.trim()) processDirectLines([directSseBuffer]);

        updateAgentState("engineer", { status: "done", output: directOutput });

        const directMsg: ProjectMessage = {
          id: `temp-agent-engineer-${Date.now()}`,
          projectId: project.id,
          role: "engineer",
          content: directOutput,
          metadata: null,
          createdAt: new Date(),
        };
        currentMessages = [...currentMessages, directMsg];
        onMessagesChange(currentMessages);
        await persistMessage("engineer", directOutput, {
          agentName: AGENTS.engineer.name,
          agentColor: AGENTS.engineer.color,
        });

        if (directCode) {
          const res = await fetchAPI("/api/versions", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              code: directCode,
              description: prompt.slice(0, 80),
            }),
          });
          const version = await res.json();
          onFilesGenerated({ "/App.js": directCode }, version);
        }

        return; // skip full pipeline — finally block still runs
      }

      for (const agentRole of AGENT_ORDER) {
        // Engineer: attempt multi-file path after architect completes
        if (agentRole === "engineer") {
          const scaffold = extractScaffoldFromTwoPhase(outputs.architect);

          if (scaffold && scaffold.files.length > 1) {
            // === MULTI-FILE PATH ===
            updateAgentState("engineer", { status: "thinking", output: "" });

            const layers = topologicalSort(scaffold.files);
            const totalFiles = scaffold.files.length;
            const allCompletedFiles: Record<string, string> = {};
            const allFailedFiles: string[] = [];

            setEngineerProgress({
              totalLayers: layers.length,
              currentLayer: 0,
              totalFiles,
              currentFiles: [],
              completedFiles: [],
              failedFiles: [],
            });

            for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
              const layerPaths = layers[layerIdx];
              const layerFiles = layerPaths
                .map((p) => scaffold.files.find((f) => f.path === p))
                .filter((f): f is ScaffoldFile => f !== undefined);

              setEngineerProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      currentLayer: layerIdx + 1,
                      currentFiles: layerPaths.map((p) => p.split("/").pop() ?? p),
                    }
                  : prev
              );

              updateAgentState("engineer", {
                status: "streaming",
                output: `正在生成第 ${layerIdx + 1}/${layers.length} 层: ${layerPaths.map((p) => p.split("/").pop()).join(", ")}`,
              });

              const layerResult = await runLayerWithFallback(
                layerFiles,
                async (files) => {
                  const engineerPrompt = getMultiFileEngineerPrompt({
                    projectId: project.id,
                    targetFiles: files,
                    sharedTypes: scaffold.sharedTypes,
                    completedFiles: allCompletedFiles,
                    designNotes: scaffold.designNotes,
                    existingFiles: hasExistingCode ? currentFiles : undefined,
                  });

                  const response = await fetch("/api/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      projectId: project.id,
                      prompt,
                      agent: "engineer",
                      context: engineerPrompt,
                      modelId: selectedModel,
                      targetFiles: files,
                      completedFiles: allCompletedFiles,
                      scaffold: { sharedTypes: scaffold.sharedTypes, designNotes: scaffold.designNotes },
                    }),
                    signal: abortController.signal,
                  });

                  if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
                  }
                  if (!response.body) throw new Error("No response body");
                  setTransitionText(null);
                  return readEngineerSSE(response.body);
                },
                abortController.signal
              );

              Object.assign(allCompletedFiles, layerResult.files);
              if (layerResult.failed.length > 0) {
                allFailedFiles.push(...layerResult.failed);
              }
              setEngineerProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      completedFiles: Object.keys(allCompletedFiles),
                      failedFiles: [...prev.failedFiles, ...layerResult.failed],
                    }
                  : prev
              );
            }

            const completedList = Object.keys(allCompletedFiles).join(", ");
            const failedNote =
              allFailedFiles.length > 0
                ? `\n\n⚠️ 以下文件生成失败: ${allFailedFiles.join(", ")}`
                : "";
            const summaryOutput = `✅ 已生成 ${Object.keys(allCompletedFiles).length} 个文件:\n${completedList}${failedNote}`;

            outputs.engineer = summaryOutput;
            updateAgentState("engineer", { status: "done", output: summaryOutput });
            setEngineerProgress(null);

            const engineerMsg: ProjectMessage = {
              id: `temp-agent-engineer-${Date.now()}`,
              projectId: project.id,
              role: "engineer",
              content: summaryOutput,
              metadata: null,
              createdAt: new Date(),
            };
            currentMessages = [...currentMessages, engineerMsg];
            onMessagesChange(currentMessages);

            await persistMessage("engineer", summaryOutput, {
              agentName: AGENTS.engineer.name,
              agentColor: AGENTS.engineer.color,
            });

            if (Object.keys(allCompletedFiles).length > 0) {
              const res = await fetchAPI("/api/versions", {
                method: "POST",
                body: JSON.stringify({
                  projectId: project.id,
                  files: allCompletedFiles,
                  description: prompt.slice(0, 80),
                }),
              });
              const version = await res.json();
              onFilesGenerated(allCompletedFiles, version);
            }

            // Skip normal engineer loop iteration
            continue;
          }
          // scaffold parse failed or single file → fall through to legacy single-file flow below
        }

        updateAgentState(agentRole, { status: "thinking", output: "" });

        const context =
          agentRole === "pm"
            ? (intent === "feature_add" && lastPmOutput)
                ? buildPmIterationContext(lastPmOutput)
                : undefined
            : agentRole === "architect"
              ? outputs.pm
              : parsedPm
                ? buildEngineerContextFromStructured(
                    prompt,
                    parsedPm,
                    outputs.architect,
                    hasExistingCode ? currentFiles : undefined
                  )
                : buildEngineerContext(
                    prompt,
                    outputs.pm,
                    outputs.architect,
                    hasExistingCode ? currentFiles : undefined
                  );

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

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
        }
        if (!response.body) throw new Error("No response body");

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
              } else if (event.type === "reset") {
                agentOutput = "";
                updateAgentState(agentRole, { output: "" });
              } else if (event.type === "error") {
                throw new Error(event.error ?? "Stream error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          sseBuffer += done
            ? decoder.decode()
            : decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = done ? "" : (lines.pop() ?? "");
          processSSELines(lines);
          if (done) break;
        }

        if (sseBuffer.trim()) {
          processSSELines([sseBuffer]);
        }

        outputs[agentRole] = agentOutput;
        if (agentRole === "pm") parsedPm = extractPmOutput(agentOutput);
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

      // Legacy single-file path
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
        onFilesGenerated({ "/App.js": lastCode }, version);
      }

      // Persist PM output so next iteration can inject feature summary
      if (parsedPm) {
        onPmOutputGenerated?.(parsedPm);
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
      setEngineerProgress(null);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden border-r">
      <AgentStatusBar
        agentStates={agentStates}
        isGenerating={isGenerating}
        engineerProgress={engineerProgress}
      />

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
