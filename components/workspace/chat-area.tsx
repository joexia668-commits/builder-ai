"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useGenerationSession } from "@/hooks/use-generation-session";
import {
  updateSession,
  abortSession,
  getSession,
} from "@/lib/generation-session";
import { AgentStatusBar } from "@/components/agent/agent-status-bar";
import { AgentMessage } from "@/components/agent/agent-message";
import { ChatInput } from "@/components/workspace/chat-input";
import { fetchAPI, readSSEBody } from "@/lib/api-client";
import { DEFAULT_MODEL_ID, getAvailableModels } from "@/lib/model-registry";
import { topologicalSort } from "@/lib/topo-sort";
import { extractPmOutput, extractScaffoldFromTwoPhase } from "@/lib/extract-json";
import { runLayerWithFallback } from "@/lib/engineer-circuit";
import { getMultiFileEngineerPrompt } from "@/lib/generate-prompts";
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmIterationContext,
} from "@/lib/agent-context";
import { classifyIntent } from "@/lib/intent-classifier";
import { findMissingLocalImports } from "@/lib/extract-code";
import { ERROR_DISPLAY } from "@/lib/error-codes";
import type { ErrorCode } from "@/lib/types";
import type {
  Project,
  ProjectMessage,
  ProjectVersion,
  AgentState,
  AgentRole,
  PmOutput,
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
  isDemo?: boolean;
  initialModel?: string;
  currentFiles?: Record<string, string>;
  lastPmOutput?: PmOutput | null;
  onPmOutputGenerated?: (pm: PmOutput) => void;
  onNewProject?: () => void;
}

const TRANSITION_MESSAGES: Partial<Record<AgentRole, string>> = {
  pm: "PM 已将需求文档移交给架构师...",
  architect: "架构师已将技术方案移交给工程师...",
};

// Epoch timestamp for UI-only messages (not persisted)
function getEpochDate(): Date {
  return new Date(0);
}

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
  isDemo = false,
  initialModel,
  currentFiles = {},
  lastPmOutput,
  onPmOutputGenerated,
  onNewProject,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const persistModelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedModel, setSelectedModel] = useState<string>(
    initialModel ?? DEFAULT_MODEL_ID
  );

  const session = useGenerationSession(project.id);
  const { isGenerating, generationError, lastPrompt, transitionText, agentStates, engineerProgress } = session;

  const availableModelIds = getAvailableModels({
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.NEXT_PUBLIC_GEMINI_CONFIGURED ?? "",
    DEEPSEEK_API_KEY: process.env.NEXT_PUBLIC_DEEPSEEK_CONFIGURED ?? "",
    GROQ_API_KEY: process.env.NEXT_PUBLIC_GROQ_CONFIGURED ?? "",
  }).map((m) => m.id);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentStates, transitionText]);

  function updateAgentState(role: AgentRole, update: Partial<AgentState>) {
    const current = getSession(project.id);
    updateSession(project.id, {
      agentStates: {
        ...current.agentStates,
        [role]: { ...current.agentStates[role], ...update },
      },
    });
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
    abortSession(project.id);
  }

  interface EngineerSSEResult {
    files: Record<string, string>;
    failedInResponse: string[];
    truncatedTail?: string;
  }

  async function readEngineerSSE(
    body: ReadableStream<Uint8Array>,
    tag: string
  ): Promise<EngineerSSEResult> {
    let files: Record<string, string> | null = null;
    let failedInResponse: string[] = [];
    let truncatedTail: string | undefined;

    await readSSEBody<{
      type: string;
      code?: string;
      files?: Record<string, string>;
      failed?: string[];
      truncatedTail?: string;
      error?: string;
      errorCode?: ErrorCode;
      failedFiles?: string[];
    }>(
      body,
      (event) => {
        if (event.type === "files_complete" && event.files) {
          files = event.files;
          failedInResponse = [];
        } else if (event.type === "partial_files_complete" && event.files) {
          files = event.files;
          failedInResponse = event.failed ?? [];
          truncatedTail = event.truncatedTail;
        } else if (event.type === "code_complete" && event.code) {
          files = { "/App.js": event.code };
          failedInResponse = [];
        } else if (event.type === "error") {
          throw Object.assign(
            new Error(event.error ?? "Stream error"),
            {
              errorCode: event.errorCode ?? "unknown",
              failedFiles: event.failedFiles ?? [],
              truncatedTail: event.truncatedTail,
            }
          );
        }
      },
      {
        tag,
        onStall: () => updateSession(project.id, { stallWarning: true }),
      }
    );

    if (!files) throw new Error("No files received from engineer");
    return { files, failedInResponse, truncatedTail };
  }

  async function handleSubmit(prompt: string) {
    if (isGenerating) return;
    const abortController = new AbortController();
    updateSession(project.id, {
      generationError: null,
      lastPrompt: prompt,
      isGenerating: true,
      stallWarning: false,
      abortController,
      agentStates: {
        pm: { role: "pm", status: "idle", output: "" },
        architect: { role: "architect", status: "idle", output: "" },
        engineer: { role: "engineer", status: "idle", output: "" },
      },
    });
    onGeneratingChange?.(true);

    // Phase 0: classify intent to route pipeline
    const hasExistingCode = Object.keys(currentFiles).length > 0;
    const intent = classifyIntent(prompt, hasExistingCode);

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

        // Multi-file V1: use FILE separator format so the server can parse with
        // extractMultiFileCode. Single-file V1: keep the merged single-file path.
        const isMultiFileV1 = Object.keys(currentFiles).length > 1;
        const directContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, currentFiles)
          : buildDirectEngineerContext(prompt, currentFiles);

        const directResponse = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            prompt,
            agent: "engineer",
            context: directContext,
            modelId: selectedModel,
            // Multi-file direct path: LLM only emits modified files; server extracts
            // whatever FILE blocks are present and client merges with currentFiles.
            ...(isMultiFileV1 ? { partialMultiFile: true } : {}),
          }),
          signal: abortController.signal,
        });

        if (!directResponse.ok) {
          const errorText = await directResponse.text();
          throw new Error(`HTTP ${directResponse.status}: ${errorText.slice(0, 200)}`);
        }
        if (!directResponse.body) throw new Error("No response body");

        updateAgentState("engineer", { status: "streaming" });

        let directOutput = "";
        let directCode = "";
        let directFiles: Record<string, string> | null = null;

        await readSSEBody<{
          type: string;
          content?: string;
          code?: string;
          files?: Record<string, string>;
          error?: string;
          errorCode?: ErrorCode;
        }>(
          directResponse.body,
          (event) => {
            if (event.type === "chunk") {
              directOutput += event.content ?? "";
              updateAgentState("engineer", { output: directOutput });
            } else if (event.type === "code_complete") {
              if (event.code) directCode = event.code;
            } else if (event.type === "files_complete" && event.files) {
              directFiles = event.files;
            } else if (event.type === "reset") {
              directOutput = "";
              updateAgentState("engineer", { output: "" });
            } else if (event.type === "error") {
              throw Object.assign(
                new Error(event.error ?? "Stream error"),
                { errorCode: event.errorCode ?? "unknown" }
              );
            }
          },
          {
            tag: `direct:${intent}`,
            onStall: () => updateSession(project.id, { stallWarning: true }),
          }
        );

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

        if (isMultiFileV1 && directFiles) {
          // Merge: LLM re-emits all files; output overrides V1 for each path.
          const mergedFiles = { ...currentFiles, ...(directFiles as Record<string, string>) };
          const res = await fetchAPI("/api/versions", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              files: mergedFiles,
              description: prompt.slice(0, 80),
            }),
          });
          const version = await res.json();
          onFilesGenerated(mergedFiles, version);
        } else if (directCode) {
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
        } else {
          updateSession(project.id, { generationError: { code: "unknown", raw: "Engineer 未能生成可解析的代码，请重试" } });
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

            updateSession(project.id, {
              engineerProgress: {
                totalLayers: layers.length,
                currentLayer: 0,
                totalFiles,
                currentFiles: [],
                completedFiles: [],
                failedFiles: [],
                retryInfo: null,
              },
            });

            for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
              const layerPaths = layers[layerIdx];
              const layerFiles = layerPaths
                .map((p) => scaffold.files.find((f) => f.path === p))
                .filter((f): f is ScaffoldFile => f !== undefined);

              {
                const prev = getSession(project.id).engineerProgress;
                if (prev) {
                  updateSession(project.id, {
                    engineerProgress: {
                      ...prev,
                      currentLayer: layerIdx + 1,
                      currentFiles: layerPaths.map((p) => p.split("/").pop() ?? p),
                    },
                  });
                }
              }

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
                  updateSession(project.id, { transitionText: null });
                  return readEngineerSSE(response.body, `engineer:layer-${layerIdx + 1}`);
                },
                abortController.signal
              );

              Object.assign(allCompletedFiles, layerResult.files);
              if (layerResult.failed.length > 0) {
                allFailedFiles.push(...layerResult.failed);
              }
              {
                const prev = getSession(project.id).engineerProgress;
                if (prev) {
                  updateSession(project.id, {
                    engineerProgress: {
                      ...prev,
                      completedFiles: Object.keys(allCompletedFiles),
                      failedFiles: [...prev.failedFiles, ...layerResult.failed],
                    },
                  });
                }
              }
            }

            const completedList = Object.keys(allCompletedFiles).join(", ");
            const failedNote =
              allFailedFiles.length > 0
                ? `\n\n⚠️ 以下文件生成失败: ${allFailedFiles.join(", ")}`
                : "";
            const summaryOutput = `✅ 已生成 ${Object.keys(allCompletedFiles).length} 个文件:\n${completedList}${failedNote}`;

            outputs.engineer = summaryOutput;
            updateAgentState("engineer", { status: "done", output: summaryOutput });
            updateSession(project.id, { engineerProgress: null });

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
              const missingImports = findMissingLocalImports(allCompletedFiles);
              if (missingImports.length > 0) {
                updateSession(project.id, {
                  generationError: {
                    code: "missing_imports",
                    raw: `AI 生成的代码引用了未创建的文件：${missingImports.join("、")}`,
                  },
                });
                // Intentionally do NOT return here — stubs were injected by buildSandpackConfig
                // so the preview renders with partial functionality instead of a blank screen.
              }
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

        updateSession(project.id, { transitionText: null });
        updateAgentState(agentRole, { status: "streaming" });

        let agentOutput = "";

        await readSSEBody<{
          type: string;
          content?: string;
          code?: string;
          error?: string;
          errorCode?: ErrorCode;
        }>(
          response.body,
          (event) => {
            if (event.type === "chunk") {
              agentOutput += event.content ?? "";
              updateAgentState(agentRole, { output: agentOutput });
            } else if (event.type === "code_complete") {
              if (event.code) lastCode = event.code;
            } else if (event.type === "reset") {
              agentOutput = "";
              updateAgentState(agentRole, { output: "" });
            } else if (event.type === "error") {
              throw Object.assign(
                new Error(event.error ?? "Stream error"),
                { errorCode: event.errorCode ?? "unknown" }
              );
            }
          },
          {
            tag: agentRole,
            onStall: () => updateSession(project.id, { stallWarning: true }),
          }
        );

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
          updateSession(project.id, { transitionText: handoff });
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
        const errorCode: ErrorCode =
          err !== null && typeof err === "object" && "errorCode" in err
            ? (err as { errorCode: ErrorCode }).errorCode
            : "unknown";
        updateSession(project.id, { generationError: { code: errorCode, raw: message } });
      }
      if (isAbort) {
        updateSession(project.id, {
          agentStates: {
            pm: { role: "pm", status: "idle", output: "" },
            architect: { role: "architect", status: "idle", output: "" },
            engineer: { role: "engineer", status: "idle", output: "" },
          },
        });
      }
    } finally {
      updateSession(project.id, {
        isGenerating: false,
        transitionText: null,
        engineerProgress: null,
        stallWarning: false,
      });
      onGeneratingChange?.(false);
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
                  createdAt: getEpochDate(),
                }}
                isStreaming={state.status === "streaming"}
                isThinking={state.status === "thinking"}
              />
            );
          })}

        {generationError && (() => {
          const display = ERROR_DISPLAY[generationError.code];
          return (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg mx-2">
              <span className="text-red-500 text-lg shrink-0">{display.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-red-700 font-medium">{display.title}</p>
                <p className="text-xs text-red-500 mt-0.5">{display.description}</p>
                {display.action?.type === "new_project" && (
                  <button
                    onClick={onNewProject}
                    className="mt-1.5 text-xs underline text-red-700 hover:text-red-900"
                  >
                    {display.action.label}
                  </button>
                )}
              </div>
              <button
                data-testid="retry-btn"
                onClick={() => handleSubmit(lastPrompt)}
                className="shrink-0 text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
              >
                重试
              </button>
            </div>
          );
        })()}

        {transitionText && (
          <div className="flex items-center gap-2 text-sm text-gray-400 italic px-2 py-1">
            <span className="text-base">→</span>
            <span>{transitionText}</span>
          </div>
        )}

        {isGenerating && session.stallWarning && (
          <div
            data-testid="stall-warning"
            className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg mx-2"
          >
            <span className="text-amber-500 text-lg shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-700 font-medium">超过 30 秒没有收到生成进度</p>
              <p className="text-xs text-amber-500 mt-0.5">
                可能是模型响应较慢或连接卡住。
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => updateSession(project.id, { stallWarning: false })}
                className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors"
              >
                继续等待
              </button>
              <button
                onClick={() => {
                  stopGeneration();
                  updateSession(project.id, { stallWarning: false });
                }}
                className="text-xs px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
              >
                中断重试
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput
        onSubmit={handleSubmit}
        disabled={isGenerating || isPreviewingHistory}
        isPreviewingHistory={isPreviewingHistory}
        isDemo={isDemo}
        isGenerating={isGenerating}
        onStop={stopGeneration}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        availableModelIds={availableModelIds}
      />
    </div>
  );
}
