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
import { validateScaffold } from "@/lib/validate-scaffold";
import { extractPmOutput, extractScaffoldFromTwoPhase } from "@/lib/extract-json";
import { runLayerWithFallback } from "@/lib/engineer-circuit";
import { getMultiFileEngineerPrompt, buildMissingFileEngineerPrompt, buildMismatchedFilesEngineerPrompt, buildDisallowedImportsEngineerPrompt } from "@/lib/generate-prompts";
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmHistoryContext,
  deriveArchFromFiles,
  buildTriageContext,
} from "@/lib/agent-context";
import { classifyIntent } from "@/lib/intent-classifier";
import { findMissingLocalImports, findMissingLocalImportsWithNames, checkImportExportConsistency, checkDisallowedImports } from "@/lib/extract-code";
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
  ScaffoldData,
  IterationContext,
  IterationRound,
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
  iterationContext?: IterationContext | null;
  onIterationContextChange?: (ctx: IterationContext) => void;
  onNewProject?: () => void;
}

const MAX_PATCH_FILES = 3;

async function triageAffectedFiles(
  prompt: string,
  currentFiles: Record<string, string>,
  projectId: string,
  modelId: string,
  signal: AbortSignal
): Promise<string[]> {
  const filePaths = Object.keys(currentFiles);
  const triageContext = buildTriageContext(prompt, filePaths);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        prompt,
        agent: "engineer",
        context: triageContext,
        modelId,
        triageMode: true,
      }),
      signal,
    });

    if (!response.ok || !response.body) return [];

    let accumulated = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "chunk" && event.content) {
            accumulated += event.content;
          }
        } catch { /* skip malformed lines */ }
      }
    }

    const jsonMatch = accumulated.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    const validKeys = new Set(filePaths);
    return parsed.filter((p): p is string => typeof p === "string" && validKeys.has(p));
  } catch {
    return [];
  }
}

const TRANSITION_MESSAGES: Partial<Record<AgentRole, string>> = {
  pm: "PM 已将需求文档移交给架构师...",
  architect: "架构师已将技术方案移交给工程师...",
};

// Epoch timestamp for UI-only messages (not persisted)
function getEpochDate(): Date {
  return new Date(0);
}

// Monotonic counter for stable temp IDs (avoids Date.now() at render level)
let tempIdCounter = 0;
function makeTempId(prefix: string): string {
  return `${prefix}-${++tempIdCounter}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_ITERATION_ROUNDS = 5;

function appendRound(
  existing: IterationContext | null | undefined,
  round: IterationRound
): IterationContext {
  const rounds: readonly IterationRound[] = [
    ...(existing?.rounds ?? []),
    round,
  ].slice(-MAX_ITERATION_ROUNDS);
  return { rounds };
}

function resolveArchContext(
  _rounds: readonly IterationRound[],
  pmOutput: string,
  existingFiles: Record<string, string>
): string {
  const archCtx = Object.keys(existingFiles).length > 0
    ? deriveArchFromFiles(existingFiles)
    : "";
  return archCtx ? `${archCtx}\n\n${pmOutput}` : pmOutput;
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
  iterationContext,
  onIterationContextChange,
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
      path?: string;
      delta?: string;
      attempt?: number;
    }>(
      body,
      (event) => {
        if (event.type === "files_complete" && event.files) {
          files = event.files;
          failedInResponse = [];
          // Self-heal: overwrite streaming buffer with authoritative code
          const authoritative = event.files;
          const current = getSession(project.id);
          const next = { ...current.liveStreams };
          for (const [p, code] of Object.entries(authoritative)) {
            if (next[p] !== undefined) {
              next[p] = { ...next[p], status: "done" as const, content: code };
            }
          }
          updateSession(project.id, { liveStreams: next });
        } else if (event.type === "partial_files_complete" && event.files) {
          files = event.files;
          failedInResponse = event.failed ?? [];
          truncatedTail = event.truncatedTail;
          const authoritative = event.files;
          const failedPaths = event.failed ?? [];
          const current = getSession(project.id);
          const next = { ...current.liveStreams };
          for (const [p, code] of Object.entries(authoritative)) {
            if (next[p] !== undefined) {
              next[p] = { ...next[p], status: "done" as const, content: code };
            }
          }
          for (const p of failedPaths) {
            if (next[p] !== undefined) {
              next[p] = { ...next[p], status: "failed" as const };
            }
          }
          updateSession(project.id, { liveStreams: next });
        } else if (event.type === "code_complete" && event.code) {
          files = { "/App.js": event.code };
          failedInResponse = [];
        } else if (event.type === "file_start" && event.path) {
          const path = event.path;
          const current = getSession(project.id);
          const existing = current.liveStreams[path];
          updateSession(project.id, {
            liveStreams: {
              ...current.liveStreams,
              [path]: {
                path,
                content: "",
                status: "streaming" as const,
                attempt: existing?.attempt ?? 1,
                failedAttempts: existing?.failedAttempts ?? [],
              },
            },
          });
        } else if (event.type === "file_chunk" && event.path && event.delta !== undefined) {
          const path = event.path;
          const delta = event.delta;
          const current = getSession(project.id);
          const cur = current.liveStreams[path];
          if (cur !== undefined) {
            const MAX_STREAM_CHARS = 50_000;
            const nextContent =
              cur.content.length >= MAX_STREAM_CHARS ? cur.content : cur.content + delta;
            updateSession(project.id, {
              liveStreams: {
                ...current.liveStreams,
                [path]: { ...cur, content: nextContent },
              },
            });
          }
        } else if (event.type === "file_end") {
          // No-op: await authoritative files_complete / partial_files_complete
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
      liveStreams: {},
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
    const roundTimestamp = new Date().toISOString();

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
    let capturedScaffold: ScaffoldData | null = null;

    try {
      // Direct path: bug_fix / style_change skips PM + Architect
      if (intent === "bug_fix" || intent === "style_change") {
        updateAgentState("engineer", { status: "thinking", output: "" });

        // Multi-file V1: use FILE separator format so the server can parse with
        // extractMultiFileCode. Single-file V1: keep the merged single-file path.
        const isMultiFileV1 = Object.keys(currentFiles).length > 1;

        let triageFiles = currentFiles;
        if (isMultiFileV1) {
          updateAgentState("engineer", { status: "thinking", output: "正在分析需要修改的文件..." });
          const triagePaths = await triageAffectedFiles(
            prompt, currentFiles, project.id, selectedModel, abortController.signal
          );
          if (triagePaths.length > 0 && triagePaths.length <= MAX_PATCH_FILES) {
            triageFiles = Object.fromEntries(
              triagePaths.map((p) => [p, currentFiles[p]])
            );
          }
        }

        const baseDirectContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, triageFiles)
          : buildDirectEngineerContext(prompt, currentFiles);

        const MAX_DIRECT_ATTEMPTS = 2;
        const DIRECT_RETRY_PREFIX =
          "【重试提示 — 上一次输出被截断】严格要求：省略所有注释和解释性文字，最小化代码体积，确保所有大括号平衡。\n\n";
        let directOutput = "";
        let directCode = "";
        let directFiles: Record<string, string> | null = null;

        for (let attempt = 1; attempt <= MAX_DIRECT_ATTEMPTS; attempt++) {
          directOutput = "";
          directCode = "";
          directFiles = null;

          // On retry, prepend conciseness hint directly into context (retryHint in the
          // request body is ignored by the server — context is the only injected field).
          const directContext =
            attempt > 1 ? DIRECT_RETRY_PREFIX + baseDirectContext : baseDirectContext;

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

          try {
            await readSSEBody<{
              type: string;
              content?: string;
              code?: string;
              files?: Record<string, string>;
              error?: string;
              errorCode?: ErrorCode;
              path?: string;
              delta?: string;
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
                  // Self-heal: overwrite streaming buffer with authoritative code
                  const authoritative = event.files;
                  const current = getSession(project.id);
                  const next = { ...current.liveStreams };
                  for (const [p, code] of Object.entries(authoritative)) {
                    if (next[p] !== undefined) {
                      next[p] = { ...next[p], status: "done" as const, content: code };
                    }
                  }
                  updateSession(project.id, { liveStreams: next });
                } else if (event.type === "reset") {
                  directOutput = "";
                  updateAgentState("engineer", { output: "" });
                  updateSession(project.id, { liveStreams: {} });
                } else if (event.type === "file_start" && event.path) {
                  const path = event.path;
                  const current = getSession(project.id);
                  const existing = current.liveStreams[path];
                  updateSession(project.id, {
                    liveStreams: {
                      ...current.liveStreams,
                      [path]: {
                        path,
                        content: "",
                        status: "streaming" as const,
                        attempt: existing?.attempt ?? 1,
                        failedAttempts: existing?.failedAttempts ?? [],
                      },
                    },
                  });
                } else if (event.type === "file_chunk" && event.path && event.delta !== undefined) {
                  const path = event.path;
                  const delta = event.delta;
                  const current = getSession(project.id);
                  const cur = current.liveStreams[path];
                  if (cur !== undefined) {
                    const MAX_STREAM_CHARS = 50_000;
                    const nextContent =
                      cur.content.length >= MAX_STREAM_CHARS ? cur.content : cur.content + delta;
                    updateSession(project.id, {
                      liveStreams: {
                        ...current.liveStreams,
                        [path]: { ...cur, content: nextContent },
                      },
                    });
                  }
                } else if (event.type === "file_end") {
                  // No-op
                } else if (event.type === "error") {
                  throw Object.assign(
                    new Error(event.error ?? "Stream error"),
                    { errorCode: event.errorCode ?? "unknown" }
                  );
                }
              },
              {
                tag: `direct:${intent}:attempt${attempt}`,
                onStall: () => updateSession(project.id, { stallWarning: true }),
              }
            );
            break; // success — exit retry loop
          } catch (err: unknown) {
            const code = (err as { errorCode?: string }).errorCode;
            if (code === "parse_failed" && attempt < MAX_DIRECT_ATTEMPTS) {
              // Truncation is probabilistic — retry with a conciseness hint.
              updateAgentState("engineer", { status: "thinking", output: "" });
              continue;
            }
            throw err;
          }
        }

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

        // Persist direct-path iteration round (no PM/Arch)
        {
          const round: IterationRound = {
            userPrompt: prompt,
            intent,
            pmSummary: null,
            timestamp: roundTimestamp,
          };
          const updated = appendRound(iterationContext, round);
          onIterationContextChange?.(updated);
          fetchAPI(`/api/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({ iterationContext: updated }),
          }).catch((err: unknown) => {
            console.error("[iterationContext] PATCH failed — context may lag DB:", err);
          });
        }

        return; // skip full pipeline — finally block still runs
      }

      for (const agentRole of AGENT_ORDER) {
        // Engineer: attempt multi-file path after architect completes
        if (agentRole === "engineer") {
          const scaffoldRaw = extractScaffoldFromTwoPhase(outputs.architect);
          const scaffoldFiltered = scaffoldRaw
            ? {
                ...scaffoldRaw,
                files: scaffoldRaw.files.filter(
                  (f) => f.path !== "/supabaseClient.js"
                ),
              }
            : null;

          if (scaffoldFiltered) capturedScaffold = scaffoldFiltered;

          // Validate scaffold: remove phantom deps, clean hints, break cycles
          const { scaffold, warnings: scaffoldWarnings } = scaffoldFiltered
            ? validateScaffold(scaffoldFiltered)
            : { scaffold: null, warnings: [] as readonly string[] };

          if (scaffoldWarnings.length > 0) {
            const warningContent = `🔧 已自动修正 scaffold：${scaffoldWarnings.join("；")}`;
            const warningMsg: ProjectMessage = {
              id: `scaffold-warning-${Date.now()}`,
              projectId: project.id,
              role: "system",
              content: warningContent,
              metadata: { type: "scaffold_warning" },
              createdAt: new Date(),
            };
            currentMessages = [...currentMessages, warningMsg];
            onMessagesChange(currentMessages);
            await persistMessage("system", warningContent, { type: "scaffold_warning" });
            updateSession(project.id, { scaffoldWarnings: [] });
          }

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

            let lastTruncatedTail: string | undefined;

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
                async (files, meta) => {
                  const engineerPrompt = getMultiFileEngineerPrompt({
                    projectId: project.id,
                    targetFiles: files,
                    sharedTypes: scaffold.sharedTypes,
                    completedFiles: allCompletedFiles,
                    designNotes: scaffold.designNotes,
                    existingFiles: hasExistingCode ? currentFiles : undefined,
                    retryHint:
                      meta.attempt > 1
                        ? {
                            attempt: meta.attempt,
                            reason: "string_truncated",
                            priorTail: lastTruncatedTail,
                          }
                        : undefined,
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
                  const sseResult = await readEngineerSSE(
                    response.body,
                    `engineer:layer-${layerIdx + 1}`
                  );
                  lastTruncatedTail = sseResult.truncatedTail;
                  return {
                    files: sseResult.files,
                    failed: sseResult.failedInResponse,
                  };
                },
                abortController.signal,
                (info) => {
                  const prev = getSession(project.id).engineerProgress;
                  if (!prev) return;
                  const isFirstLayerAttempt = info.attempt === 1 && info.phase === "layer";
                  updateSession(project.id, {
                    engineerProgress: {
                      ...prev,
                      retryInfo: isFirstLayerAttempt
                        ? null
                        : {
                            layerIdx,
                            attempt: info.attempt,
                            maxAttempts: info.maxAttempts,
                            reason: info.reason,
                            failedSubset: [...info.failedSubset],
                            phase: info.phase,
                          },
                    },
                  });
                  // Archive current streaming content when retrying specific files
                  if (info.attempt > 1 && info.failedSubset.length > 0) {
                    const session = getSession(project.id);
                    const next = { ...session.liveStreams };
                    for (const path of info.failedSubset) {
                      const cur = next[path];
                      if (cur === undefined) continue;
                      next[path] = {
                        ...cur,
                        failedAttempts: [
                          ...cur.failedAttempts,
                          { content: cur.content, reason: info.reason },
                        ],
                        content: "",
                        attempt: info.attempt,
                        status: "streaming" as const,
                      };
                    }
                    updateSession(project.id, { liveStreams: next });
                  }
                }
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

              // Clear retryInfo once the layer settles
              {
                const prev = getSession(project.id).engineerProgress;
                if (prev) {
                  updateSession(project.id, {
                    engineerProgress: { ...prev, retryInfo: null },
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

            console.warn("[pipeline] allCompletedFiles:", Object.keys(allCompletedFiles));
            console.warn("[pipeline] currentFiles:", Object.keys(currentFiles));
            console.warn("[pipeline] hasExistingCode:", hasExistingCode);
            console.warn("[pipeline] scaffold files:", capturedScaffold?.files.map(f => f.path));
            console.warn("[pipeline] scaffold removeFiles:", capturedScaffold?.removeFiles);
            if (Object.keys(allCompletedFiles).length > 0) {
              // Merge existing files BEFORE post-processing so that
              // findMissingLocalImports / checkImportExportConsistency see
              // the full file set (old + new) instead of only newly generated files.
              // Without this, imports pointing to old files are treated as "missing"
              // and trigger unnecessary patch/fix cycles that can corrupt files.
              if (hasExistingCode) {
                const preserved = { ...currentFiles };
                // New files override old; old files fill the gaps
                for (const [p, code] of Object.entries(allCompletedFiles)) {
                  preserved[p] = code;
                }
                // Write merged set back so post-processing sees everything
                Object.keys(allCompletedFiles).forEach((k) => delete allCompletedFiles[k]);
                Object.assign(allCompletedFiles, preserved);
              }

              // Attempt to patch missing files before falling back to stubs
              const missingMap = findMissingLocalImportsWithNames(allCompletedFiles);
              if (missingMap.size > 0 && missingMap.size <= MAX_PATCH_FILES) {
                updateAgentState("engineer", {
                  status: "streaming",
                  output: `正在补全缺失文件: ${Array.from(missingMap.keys()).map((p) => p.split("/").pop()).join(", ")}`,
                });
                try {
                  const patchPrompt = buildMissingFileEngineerPrompt(
                    missingMap,
                    allCompletedFiles,
                    project.id
                  );
                  const patchResponse = await fetchAPI("/api/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      projectId: project.id,
                      prompt: "补全缺失文件",
                      agent: "engineer",
                      context: patchPrompt,
                      modelId: selectedModel,
                    }),
                    signal: abortController.signal,
                  });
                  if (patchResponse.body) {
                    const patchSSE = await readEngineerSSE(
                      patchResponse.body,
                      "engineer:patch"
                    );
                    Object.assign(allCompletedFiles, patchSSE.files);
                  }
                } catch {
                  // Patch failed — fall through to stub injection
                  updateAgentState("engineer", {
                    status: "done",
                    output: "缺失文件补全失败，已回退至存根注入",
                  });
                }
                updateAgentState("engineer", {
                  status: "done",
                  output: summaryOutput,
                });
              }

              // Re-check for remaining missing imports after patch attempt
              const remainingMissing = findMissingLocalImports(allCompletedFiles);
              if (remainingMissing.length > 0) {
                console.warn("[pipeline] missing imports:", remainingMissing);
                updateSession(project.id, {
                  generationError: {
                    code: "missing_imports",
                    raw: `AI 生成的代码引用了未创建的文件：${remainingMissing.join("、")}`,
                  },
                });
                // Intentionally do NOT return here — stubs were injected by buildSandpackConfig
                // so the preview renders with partial functionality instead of a blank screen.
              }
              // Check import/export consistency and retry mismatched files (≤ MAX_PATCH_FILES)
              const importMismatches = checkImportExportConsistency(allCompletedFiles);
              if (importMismatches.length > 0) {
                const involvedPaths = new Set<string>();
                importMismatches.forEach((m) => {
                  involvedPaths.add(m.importerPath);
                  involvedPaths.add(m.exporterPath);
                });
                if (involvedPaths.size <= MAX_PATCH_FILES) {
                  const involvedPathsArray = Array.from(involvedPaths);
                  updateAgentState("engineer", {
                    status: "streaming",
                    output: `正在修复 import/export 不一致: ${involvedPathsArray.map((p) => p.split("/").pop()).join(", ")}`,
                  });
                  try {
                    const fixPrompt = buildMismatchedFilesEngineerPrompt(
                      involvedPathsArray,
                      allCompletedFiles,
                      importMismatches,
                      project.id
                    );
                    const fixResponse = await fetchAPI("/api/generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId: project.id,
                        prompt: "修复 import/export 不一致",
                        agent: "engineer",
                        context: fixPrompt,
                        modelId: selectedModel,
                      }),
                      signal: abortController.signal,
                    });
                    if (fixResponse.body) {
                      const fixSSE = await readEngineerSSE(
                        fixResponse.body,
                        "engineer:fix-imports"
                      );
                      Object.assign(allCompletedFiles, fixSSE.files);
                    }
                  } catch {
                    // Fix failed — fall through to Sandpack with current files
                  }
                  updateAgentState("engineer", { status: "done", output: summaryOutput });
                }
              }
              // Check for disallowed external package imports and retry affected files (≤ MAX_PATCH_FILES)
              const pkgViolations = checkDisallowedImports(allCompletedFiles);
              if (pkgViolations.length > 0) {
                const violatedPaths = Array.from(new Set(pkgViolations.map((v) => v.filePath)));
                if (violatedPaths.length <= MAX_PATCH_FILES) {
                  updateAgentState("engineer", {
                    status: "streaming",
                    output: `正在修复禁止包引用: ${violatedPaths.map((p) => p.split("/").pop()).join(", ")}`,
                  });
                  try {
                    const fixPrompt = buildDisallowedImportsEngineerPrompt(
                      violatedPaths,
                      allCompletedFiles,
                      pkgViolations,
                      project.id
                    );
                    const fixResponse = await fetchAPI("/api/generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId: project.id,
                        prompt: "修复禁止包引用",
                        agent: "engineer",
                        context: fixPrompt,
                        modelId: selectedModel,
                      }),
                      signal: abortController.signal,
                    });
                    if (fixResponse.body) {
                      const fixSSE = await readEngineerSSE(
                        fixResponse.body,
                        "engineer:fix-packages"
                      );
                      Object.assign(allCompletedFiles, fixSSE.files);
                    }
                  } catch {
                    // Fix failed — fall through to Sandpack with current files
                  }
                  updateAgentState("engineer", { status: "done", output: summaryOutput });
                }
              }
              // allCompletedFiles already includes currentFiles (merged before post-processing).
              // Only need to apply removeFiles from Architect.
              const finalFiles = allCompletedFiles;
              if (capturedScaffold?.removeFiles) {
                for (const removePath of capturedScaffold.removeFiles) {
                  delete finalFiles[removePath];
                }
              }
              const res = await fetchAPI("/api/versions", {
                method: "POST",
                body: JSON.stringify({
                  projectId: project.id,
                  files: finalFiles,
                  description: prompt.slice(0, 80),
                }),
              });
              const version = await res.json();
              onFilesGenerated(finalFiles, version);
            }

            // Skip normal engineer loop iteration
            continue;
          }
          // scaffold parse failed or single file → fall through to legacy single-file flow below
        }

        updateAgentState(agentRole, { status: "thinking", output: "" });

        const rounds = iterationContext?.rounds ?? [];
        const context =
          agentRole === "pm"
            ? (intent === "feature_add" && rounds.length > 0)
                ? buildPmHistoryContext(rounds)
                : undefined
            : agentRole === "architect"
              ? resolveArchContext(rounds, outputs.pm, currentFiles)
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
          id: makeTempId(`temp-agent-${agentRole}`),
          projectId: project.id,
          role: agentRole,
          content: agentOutput,
          metadata: null,
          createdAt: getEpochDate(),
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

      // Persist iteration round for cross-round context (full pipeline)
      {
        const round: IterationRound = {
          userPrompt: prompt,
          intent,
          pmSummary: parsedPm,
          timestamp: roundTimestamp,
        };
        const updated = appendRound(iterationContext, round);
        onIterationContextChange?.(updated);
        fetchAPI(`/api/projects/${project.id}`, {
          method: "PATCH",
          body: JSON.stringify({ iterationContext: updated }),
        }).catch((err: unknown) => {
          console.error("[iterationContext] PATCH failed — context may lag DB:", err);
        });
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
      // Keep liveStreams visible for 2.5s then clear so a new submission starts clean.
      setTimeout(() => {
        const current = getSession(project.id);
        if (!current.isGenerating) {
          updateSession(project.id, { liveStreams: {} });
        }
      }, 2500);
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

        {messages.map((msg) => {
          if ((msg.metadata as { type?: string } | null)?.type === "scaffold_warning") {
            return (
              <div key={msg.id} className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg mx-2 text-xs text-gray-500">
                <span>{msg.content}</span>
              </div>
            );
          }
          return <AgentMessage key={msg.id} message={msg} />;
        })}

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
