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
  buildSkeletonArchitectContext,
  buildModuleArchitectContext,
} from "@/lib/agent-context";
import { createPipelineController } from "@/lib/pipeline-controller";
import { parseDecomposerOutput, validateDecomposerOutput, buildDecomposerContext } from "@/lib/decomposer";
import { classifyIntent } from "@/lib/intent-classifier";
import { classifySceneFromPrompt, classifySceneFromPm } from "@/lib/scene-classifier";
import { getEngineerSceneRules, getArchitectSceneHint } from "@/lib/scene-rules";
import { findMissingLocalImports, findMissingLocalImportsWithNames, checkImportExportConsistency, checkDisallowedImports, checkUndefinedLucideIcons, applyLucideIconFixes } from "@/lib/extract-code";
import { ERROR_DISPLAY } from "@/lib/error-codes";
import { computeChangedFiles } from "@/lib/version-files";
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
  Scene,
  Complexity,
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
  onScaffoldDependenciesChange?: (deps: Record<string, string> | undefined) => void;
  /** Called during complex-path generation to update preview files incrementally (no version creation). */
  onFilesChange?: (files: Record<string, string>) => void;
}

function computeMaxPatchFiles(totalFiles: number): number {
  return Math.min(8, Math.max(3, Math.ceil(totalFiles * 0.3)));
}

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
  existingFiles: Record<string, string>,
  scenes: Scene[] = ["general"]
): string {
  const archCtx = Object.keys(existingFiles).length > 0
    ? deriveArchFromFiles(existingFiles)
    : "";
  const hint = getArchitectSceneHint(scenes);
  const base = archCtx ? `${archCtx}\n\n${pmOutput}` : pmOutput;
  return hint ? `${hint}\n\n${base}` : base;
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
  onScaffoldDependenciesChange,
  onFilesChange,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const persistModelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedModel, setSelectedModel] = useState<string>(
    initialModel ?? DEFAULT_MODEL_ID
  );

  const session = useGenerationSession(project.id);
  const { isGenerating, generationError, lastPrompt, transitionText, agentStates, engineerProgress, pipelineState, currentModule, moduleProgress } = session;

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
        decomposer: { role: "decomposer", status: "idle", output: "" },
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

    const outputs: Record<AgentRole, string> = { pm: "", decomposer: "", architect: "", engineer: "" };
    let parsedPm: PmOutput | null = null;
    let lastCode = "";
    let capturedScaffold: ScaffoldData | null = null;
    let detectedScenes: Scene[] = ["general"];

    try {
      // Direct path: bug_fix / style_change skips PM + Architect
      if (intent === "bug_fix" || intent === "style_change") {
        // Direct path does not use scaffold — reset any previously stored deps
        onScaffoldDependenciesChange?.(undefined);
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
          if (triagePaths.length > 0 && triagePaths.length <= computeMaxPatchFiles(Object.keys(currentFiles).length)) {
            triageFiles = Object.fromEntries(
              triagePaths.map((p) => [p, currentFiles[p]])
            );
          }
        }

        // ADR 0018: inject full-project architecture summary so Engineer sees all
        // 27 files' structure/exports/deps, even though code is only triage subset.
        const archSummary = isMultiFileV1 ? deriveArchFromFiles(currentFiles) : "";

        const baseDirectContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, triageFiles, archSummary || undefined)
          : buildDirectEngineerContext(prompt, currentFiles);
        const directSceneRules = getEngineerSceneRules(classifySceneFromPrompt(prompt));
        const baseDirectContextWithScene = directSceneRules ? `${baseDirectContext}\n\n${directSceneRules}` : baseDirectContext;

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
            attempt > 1 ? DIRECT_RETRY_PREFIX + baseDirectContextWithScene : baseDirectContextWithScene;

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

        // Compute updated context BEFORE saving version so snapshot includes this round
        const directRound: IterationRound = {
          userPrompt: prompt,
          intent,
          pmSummary: null,
          timestamp: roundTimestamp,
        };
        const directUpdatedCtx = appendRound(iterationContext, directRound);

        if (isMultiFileV1 && directFiles) {
          // Merge: LLM re-emits all files; output overrides V1 for each path.
          const mergedFiles = { ...currentFiles, ...(directFiles as Record<string, string>) };
          const res = await fetchAPI("/api/versions", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              files: mergedFiles,
              description: prompt.slice(0, 80),
              changedFiles: computeChangedFiles(currentFiles, mergedFiles),
              iterationSnapshot: directUpdatedCtx,
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
              changedFiles: computeChangedFiles(currentFiles, { "/App.js": directCode }),
              iterationSnapshot: directUpdatedCtx,
            }),
          });
          const version = await res.json();
          onFilesGenerated({ "/App.js": directCode }, version);
        } else {
          updateSession(project.id, { generationError: { code: "unknown", raw: "Engineer 未能生成可解析的代码，请重试" } });
        }

        // Persist direct-path iteration round (already computed above)
        {
          onIterationContextChange?.(directUpdatedCtx);
          fetchAPI(`/api/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({ iterationContext: directUpdatedCtx }),
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
            // Thread scaffold dependencies to preview config via workspace state
            onScaffoldDependenciesChange?.(
              scaffold.dependencies ? { ...scaffold.dependencies } as Record<string, string> : undefined
            );

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
                    sceneRules: getEngineerSceneRules(detectedScenes),
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
              if (missingMap.size > 0 && missingMap.size <= computeMaxPatchFiles(Object.keys(allCompletedFiles).length)) {
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
                // Intentionally do NOT return here — stubs are injected by prepareFiles()
                // in PreviewFrame so the preview renders with partial functionality.
              }
              // Fix invalid lucide-react icon names (static replacement, no LLM call)
              const lucideFixes = checkUndefinedLucideIcons(allCompletedFiles);
              if (lucideFixes.length > 0) {
                updateAgentState("engineer", {
                  status: "streaming",
                  output: `正在修复 lucide 图标引用: ${lucideFixes.map((f) => `${f.original} → ${f.replacement}`).join(", ")}`,
                });
                applyLucideIconFixes(allCompletedFiles, lucideFixes);
              }
              // Check import/export consistency and retry mismatched files (≤ MAX_PATCH_FILES)
              const importMismatches = checkImportExportConsistency(allCompletedFiles);
              if (importMismatches.length > 0) {
                const involvedPaths = new Set<string>();
                importMismatches.forEach((m) => {
                  involvedPaths.add(m.importerPath);
                  involvedPaths.add(m.exporterPath);
                });
                if (involvedPaths.size <= computeMaxPatchFiles(Object.keys(allCompletedFiles).length)) {
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
                    // Fix failed — fall through to preview with current files
                  }
                  updateAgentState("engineer", { status: "done", output: summaryOutput });
                }
              }
              // Check for disallowed external package imports and retry affected files (≤ MAX_PATCH_FILES)
              const pkgViolations = checkDisallowedImports(allCompletedFiles, detectedScenes);
              if (pkgViolations.length > 0) {
                const violatedPaths = Array.from(new Set(pkgViolations.map((v) => v.filePath)));
                if (violatedPaths.length <= computeMaxPatchFiles(Object.keys(allCompletedFiles).length)) {
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
                    // Fix failed — fall through to preview with current files
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
              // Compute updated context including this round so snapshot is complete
              const pipelineRound: IterationRound = {
                userPrompt: prompt,
                intent,
                pmSummary: parsedPm,
                timestamp: roundTimestamp,
              };
              const pipelineUpdatedCtx = appendRound(iterationContext, pipelineRound);
              onIterationContextChange?.(pipelineUpdatedCtx);
              fetchAPI(`/api/projects/${project.id}`, {
                method: "PATCH",
                body: JSON.stringify({ iterationContext: pipelineUpdatedCtx }),
              }).catch((err: unknown) => {
                console.error("[iterationContext] PATCH failed — context may lag DB:", err);
              });

              const res = await fetchAPI("/api/versions", {
                method: "POST",
                body: JSON.stringify({
                  projectId: project.id,
                  files: finalFiles,
                  description: prompt.slice(0, 80),
                  changedFiles: computeChangedFiles(currentFiles, finalFiles),
                  iterationSnapshot: pipelineUpdatedCtx,
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

        // Decomposer is handled inside the complex path above or skipped in simple path
        if (agentRole === "decomposer") continue;

        updateAgentState(agentRole, { status: "thinking", output: "" });

        const rounds = iterationContext?.rounds ?? [];
        const baseEngineerCtx = parsedPm
          ? buildEngineerContextFromStructured(prompt, parsedPm, outputs.architect, hasExistingCode ? currentFiles : undefined)
          : buildEngineerContext(prompt, outputs.pm, outputs.architect, hasExistingCode ? currentFiles : undefined);
        const engineerSceneRules = getEngineerSceneRules(detectedScenes);
        const engineerCtxWithScene = engineerSceneRules ? `${baseEngineerCtx}\n\n${engineerSceneRules}` : baseEngineerCtx;
        const context =
          agentRole === "pm"
            ? (intent === "feature_add" && rounds.length > 0)
                ? buildPmHistoryContext(rounds)
                : undefined
            : agentRole === "architect"
              ? resolveArchContext(rounds, outputs.pm, currentFiles, detectedScenes)
              : engineerCtxWithScene;

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
        if (agentRole === "pm") {
          parsedPm = extractPmOutput(agentOutput);
          if (parsedPm) detectedScenes = classifySceneFromPm(parsedPm);
        }
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

        // ── After PM completes, determine complexity and potentially enter complex path ──
        if (agentRole === "pm" && parsedPm) {
          const complexity: Complexity = parsedPm.modules.length > 3 || parsedPm.features.length > 5
            ? "complex"
            : (parsedPm.complexity ?? "simple");

          if (complexity === "complex") {
            // === COMPLEX PATH: Decomposer → Skeleton → Module-filling ===
            const pipeline = createPipelineController({
              onStateChange: (state, message) => {
                updateSession(project.id, { pipelineState: state, transitionText: message });
              },
            });
            pipeline.start(prompt);
            pipeline.onPmComplete(parsedPm);

            // ── A) Call Decomposer ──
            updateAgentState("decomposer", { status: "thinking", output: "" });
            updateSession(project.id, { pipelineState: "DECOMPOSING", transitionText: "正在拆解模块..." });

            const decomposerContext = buildDecomposerContext(
              parsedPm,
              Object.keys(currentFiles),
              detectedScenes
            );

            const decomposerResponse = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agent: "decomposer",
                prompt,
                context: decomposerContext,
                projectId: project.id,
                modelId: selectedModel,
              }),
              signal: abortController.signal,
            });

            if (!decomposerResponse.ok) {
              const errorText = await decomposerResponse.text();
              throw new Error(`HTTP ${decomposerResponse.status}: ${errorText.slice(0, 200)}`);
            }
            if (!decomposerResponse.body) throw new Error("No response body from decomposer");

            let decomposerRaw = "";
            await readSSEBody<{ type: string; content?: string; code?: string; error?: string; errorCode?: ErrorCode }>(
              decomposerResponse.body,
              (event) => {
                if (event.type === "chunk" && event.content) {
                  decomposerRaw += event.content;
                  updateAgentState("decomposer", { status: "streaming", output: decomposerRaw });
                } else if (event.type === "code_complete" && event.code) {
                  decomposerRaw = event.code;
                } else if (event.type === "error") {
                  throw Object.assign(
                    new Error(event.error ?? "Decomposer error"),
                    { errorCode: event.errorCode ?? "unknown" }
                  );
                }
              },
              { tag: "decomposer", onStall: () => updateSession(project.id, { stallWarning: true }) }
            );

            updateAgentState("decomposer", { status: "done", output: decomposerRaw });
            outputs.decomposer = decomposerRaw;

            // Persist decomposer message
            const decomposerMsg: ProjectMessage = {
              id: makeTempId("temp-agent-decomposer"),
              projectId: project.id,
              role: "decomposer",
              content: decomposerRaw,
              metadata: null,
              createdAt: getEpochDate(),
            };
            currentMessages = [...currentMessages, decomposerMsg];
            onMessagesChange(currentMessages);
            await persistMessage("decomposer", decomposerRaw, {
              agentName: AGENTS.decomposer.name,
              agentColor: AGENTS.decomposer.color,
            });

            const decomposed = parseDecomposerOutput(decomposerRaw);

            // ── B) If Decomposer fails, fall back to simple path ──
            if (!decomposed) {
              updateSession(project.id, {
                pipelineState: "ARCHITECTING",
                transitionText: "模块拆解失败，降级为简单模式...",
              });
              pipeline.onDecomposerFailed();
              // Continue the AGENT_ORDER loop — it will proceed to architect then engineer
              continue;
            }

            // ── C) Decomposer succeeded — run Skeleton → Module-filling ──
            const validated = validateDecomposerOutput(decomposed);
            pipeline.onDecomposerComplete(validated);

            const moduleQueue = validated.generateOrder.flat();
            const allModuleFiles: Record<string, string> = {};
            const skeletonFiles: Record<string, string> = {};
            const failedModules: string[] = [];

            // ── SKELETON phase ──
            updateSession(project.id, { pipelineState: "SKELETON", transitionText: "正在生成应用骨架..." });
            updateAgentState("architect", { status: "thinking", output: "" });

            const skeletonArchContext = buildSkeletonArchitectContext(
              parsedPm, validated.skeleton, currentFiles, detectedScenes
            );

            const skeletonArchResponse = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: project.id,
                prompt,
                agent: "architect",
                context: skeletonArchContext,
                modelId: selectedModel,
              }),
              signal: abortController.signal,
            });

            if (!skeletonArchResponse.ok) {
              const errText = await skeletonArchResponse.text();
              throw new Error(`HTTP ${skeletonArchResponse.status}: ${errText.slice(0, 200)}`);
            }
            if (!skeletonArchResponse.body) throw new Error("No response body from skeleton architect");

            let skeletonArchOutput = "";
            await readSSEBody<{ type: string; content?: string; error?: string; errorCode?: ErrorCode }>(
              skeletonArchResponse.body,
              (event) => {
                if (event.type === "chunk") {
                  skeletonArchOutput += event.content ?? "";
                  updateAgentState("architect", { output: skeletonArchOutput });
                } else if (event.type === "error") {
                  throw Object.assign(
                    new Error(event.error ?? "Skeleton architect error"),
                    { errorCode: event.errorCode ?? "unknown" }
                  );
                }
              },
              { tag: "architect:skeleton", onStall: () => updateSession(project.id, { stallWarning: true }) }
            );

            updateAgentState("architect", { status: "done", output: skeletonArchOutput });
            outputs.architect = skeletonArchOutput;

            const skeletonScaffoldRaw = extractScaffoldFromTwoPhase(skeletonArchOutput);
            const skeletonScaffoldFiltered = skeletonScaffoldRaw
              ? { ...skeletonScaffoldRaw, files: skeletonScaffoldRaw.files.filter((f) => f.path !== "/supabaseClient.js") }
              : null;

            if (skeletonScaffoldFiltered) capturedScaffold = skeletonScaffoldFiltered;

            const { scaffold: skeletonScaffold } = skeletonScaffoldFiltered
              ? validateScaffold(skeletonScaffoldFiltered)
              : { scaffold: null };

            if (skeletonScaffold && skeletonScaffold.files.length > 0) {
              onScaffoldDependenciesChange?.(
                skeletonScaffold.dependencies ? { ...skeletonScaffold.dependencies } as Record<string, string> : undefined
              );

              // Generate skeleton files via Engineer
              updateAgentState("engineer", { status: "thinking", output: "正在生成骨架代码..." });
              const skeletonLayers = topologicalSort(skeletonScaffold.files);

              for (let layerIdx = 0; layerIdx < skeletonLayers.length; layerIdx++) {
                const layerPaths = skeletonLayers[layerIdx];
                const layerFiles = layerPaths
                  .map((p) => skeletonScaffold.files.find((f) => f.path === p))
                  .filter((f): f is ScaffoldFile => f !== undefined);

                updateAgentState("engineer", {
                  status: "streaming",
                  output: `骨架: 第 ${layerIdx + 1}/${skeletonLayers.length} 层`,
                });

                const layerResult = await runLayerWithFallback(
                  layerFiles,
                  async (files, meta) => {
                    const engineerPrompt = getMultiFileEngineerPrompt({
                      projectId: project.id,
                      targetFiles: files,
                      sharedTypes: skeletonScaffold.sharedTypes,
                      completedFiles: skeletonFiles,
                      designNotes: skeletonScaffold.designNotes,
                      existingFiles: hasExistingCode ? currentFiles : undefined,
                      sceneRules: getEngineerSceneRules(detectedScenes),
                      retryHint: meta.attempt > 1
                        ? { attempt: meta.attempt, reason: "string_truncated" as const, priorTail: undefined }
                        : undefined,
                    });
                    const resp = await fetch("/api/generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId: project.id,
                        prompt,
                        agent: "engineer",
                        context: engineerPrompt,
                        modelId: selectedModel,
                        targetFiles: files,
                        completedFiles: skeletonFiles,
                        scaffold: { sharedTypes: skeletonScaffold.sharedTypes, designNotes: skeletonScaffold.designNotes },
                      }),
                      signal: abortController.signal,
                    });
                    if (!resp.ok) {
                      const errText = await resp.text();
                      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
                    }
                    if (!resp.body) throw new Error("No response body");
                    const sseResult = await readEngineerSSE(resp.body, `engineer:skeleton:layer-${layerIdx + 1}`);
                    return { files: sseResult.files, failed: sseResult.failedInResponse };
                  },
                  abortController.signal,
                  () => { /* no retry UI for skeleton */ }
                );

                Object.assign(skeletonFiles, layerResult.files);
              }

              Object.assign(allModuleFiles, skeletonFiles);
              pipeline.onSkeletonComplete(skeletonFiles);

              // Progressive delivery: mount skeleton in preview immediately
              onFilesChange?.({ ...currentFiles, ...skeletonFiles });
            }

            // ── MODULE_FILLING phase ──
            for (let mi = 0; mi < moduleQueue.length; mi++) {
              const moduleName = moduleQueue[mi];
              const moduleDef = validated.modules.find((m) => m.name === moduleName);
              if (!moduleDef) continue;

              updateSession(project.id, {
                pipelineState: "MODULE_FILLING",
                transitionText: `正在生成模块: ${moduleName}...`,
                currentModule: moduleName,
                moduleProgress: {
                  total: moduleQueue.length,
                  completed: moduleQueue.slice(0, mi).filter((n) => !failedModules.includes(n)),
                  failed: failedModules,
                  current: moduleName,
                },
              });

              try {
                // Call Architect for this module
                updateAgentState("architect", { status: "thinking", output: "" });
                const moduleArchContext = buildModuleArchitectContext(
                  parsedPm, moduleDef, skeletonFiles, allModuleFiles, detectedScenes
                );

                const moduleArchResponse = await fetch("/api/generate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    projectId: project.id,
                    prompt: `生成模块: ${moduleName} - ${moduleDef.description}`,
                    agent: "architect",
                    context: moduleArchContext,
                    modelId: selectedModel,
                  }),
                  signal: abortController.signal,
                });

                if (!moduleArchResponse.ok) {
                  throw new Error(`HTTP ${moduleArchResponse.status}`);
                }
                if (!moduleArchResponse.body) throw new Error("No response body");

                let moduleArchOutput = "";
                await readSSEBody<{ type: string; content?: string; error?: string; errorCode?: ErrorCode }>(
                  moduleArchResponse.body,
                  (event) => {
                    if (event.type === "chunk") {
                      moduleArchOutput += event.content ?? "";
                      updateAgentState("architect", { output: moduleArchOutput });
                    } else if (event.type === "error") {
                      throw Object.assign(
                        new Error(event.error ?? "Module architect error"),
                        { errorCode: event.errorCode ?? "unknown" }
                      );
                    }
                  },
                  { tag: `architect:module:${moduleName}`, onStall: () => updateSession(project.id, { stallWarning: true }) }
                );

                updateAgentState("architect", { status: "done", output: moduleArchOutput });

                const moduleScaffoldRaw = extractScaffoldFromTwoPhase(moduleArchOutput);
                const moduleScaffoldFiltered = moduleScaffoldRaw
                  ? { ...moduleScaffoldRaw, files: moduleScaffoldRaw.files.filter((f) => f.path !== "/supabaseClient.js") }
                  : null;
                const { scaffold: moduleScaffold } = moduleScaffoldFiltered
                  ? validateScaffold(moduleScaffoldFiltered)
                  : { scaffold: null };

                if (moduleScaffold && moduleScaffold.files.length > 0) {
                  // Engineer for this module's files
                  updateAgentState("engineer", { status: "thinking", output: `正在生成模块 ${moduleName} 代码...` });
                  const moduleLayers = topologicalSort(moduleScaffold.files);

                  for (let layerIdx = 0; layerIdx < moduleLayers.length; layerIdx++) {
                    const layerPaths = moduleLayers[layerIdx];
                    const layerFiles = layerPaths
                      .map((p) => moduleScaffold.files.find((f) => f.path === p))
                      .filter((f): f is ScaffoldFile => f !== undefined);

                    updateAgentState("engineer", {
                      status: "streaming",
                      output: `模块 ${moduleName}: 第 ${layerIdx + 1}/${moduleLayers.length} 层`,
                    });

                    const layerResult = await runLayerWithFallback(
                      layerFiles,
                      async (files, meta) => {
                        const engineerPrompt = getMultiFileEngineerPrompt({
                          projectId: project.id,
                          targetFiles: files,
                          sharedTypes: moduleScaffold.sharedTypes,
                          completedFiles: allModuleFiles,
                          designNotes: moduleScaffold.designNotes,
                          existingFiles: hasExistingCode ? currentFiles : undefined,
                          sceneRules: getEngineerSceneRules(detectedScenes),
                          retryHint: meta.attempt > 1
                            ? { attempt: meta.attempt, reason: "string_truncated" as const, priorTail: undefined }
                            : undefined,
                        });
                        const resp = await fetch("/api/generate", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            projectId: project.id,
                            prompt: `生成模块 ${moduleName}`,
                            agent: "engineer",
                            context: engineerPrompt,
                            modelId: selectedModel,
                            targetFiles: files,
                            completedFiles: allModuleFiles,
                            scaffold: { sharedTypes: moduleScaffold.sharedTypes, designNotes: moduleScaffold.designNotes },
                          }),
                          signal: abortController.signal,
                        });
                        if (!resp.ok) {
                          const errText = await resp.text();
                          throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
                        }
                        if (!resp.body) throw new Error("No response body");
                        const sseResult = await readEngineerSSE(resp.body, `engineer:module:${moduleName}:layer-${layerIdx + 1}`);
                        return { files: sseResult.files, failed: sseResult.failedInResponse };
                      },
                      abortController.signal,
                      () => { /* retry UI handled via moduleProgress */ }
                    );

                    Object.assign(allModuleFiles, layerResult.files);
                  }
                }

                pipeline.onModuleComplete(moduleName, allModuleFiles);

                // Progressive delivery: update preview with module files as they complete
                onFilesChange?.({ ...allModuleFiles });
              } catch (err) {
                if (err instanceof DOMException && err.name === "AbortError") throw err;
                failedModules.push(moduleName);
                pipeline.onModuleFailed(moduleName, err instanceof Error ? err.message : "unknown");
                continue; // skip to next module
              }
            }

            // ── POST_PROCESSING (reuse existing post-processing logic) ──
            updateSession(project.id, { pipelineState: "POST_PROCESSING", transitionText: "正在检查代码一致性..." });

            // Merge existing files into allModuleFiles for full-set post-processing
            if (hasExistingCode) {
              const preserved = { ...currentFiles };
              for (const [p, code] of Object.entries(allModuleFiles)) {
                preserved[p] = code;
              }
              Object.keys(allModuleFiles).forEach((k) => delete allModuleFiles[k]);
              Object.assign(allModuleFiles, preserved);
            }

            // Patch missing files
            const missingMap = findMissingLocalImportsWithNames(allModuleFiles);
            if (missingMap.size > 0 && missingMap.size <= computeMaxPatchFiles(Object.keys(allModuleFiles).length)) {
              updateAgentState("engineer", {
                status: "streaming",
                output: `正在补全缺失文件: ${Array.from(missingMap.keys()).map((p) => p.split("/").pop()).join(", ")}`,
              });
              try {
                const patchPrompt = buildMissingFileEngineerPrompt(missingMap, allModuleFiles, project.id);
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
                  const patchSSE = await readEngineerSSE(patchResponse.body, "engineer:complex:patch");
                  Object.assign(allModuleFiles, patchSSE.files);
                }
              } catch {
                // Patch failed — fall through to stub injection
              }
            }

            // Remaining missing imports check
            const remainingMissing = findMissingLocalImports(allModuleFiles);
            if (remainingMissing.length > 0) {
              updateSession(project.id, {
                generationError: {
                  code: "missing_imports",
                  raw: `AI 生成的代码引用了未创建的文件：${remainingMissing.join("、")}`,
                },
              });
            }

            // Lucide icon fixes
            const lucideFixes = checkUndefinedLucideIcons(allModuleFiles);
            if (lucideFixes.length > 0) {
              applyLucideIconFixes(allModuleFiles, lucideFixes);
            }

            // Import/export consistency
            const importMismatches = checkImportExportConsistency(allModuleFiles);
            if (importMismatches.length > 0) {
              const involvedPaths = new Set<string>();
              importMismatches.forEach((m) => { involvedPaths.add(m.importerPath); involvedPaths.add(m.exporterPath); });
              if (involvedPaths.size <= computeMaxPatchFiles(Object.keys(allModuleFiles).length)) {
                const involvedPathsArray = Array.from(involvedPaths);
                try {
                  const fixPrompt = buildMismatchedFilesEngineerPrompt(involvedPathsArray, allModuleFiles, importMismatches, project.id);
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
                    const fixSSE = await readEngineerSSE(fixResponse.body, "engineer:complex:fix-imports");
                    Object.assign(allModuleFiles, fixSSE.files);
                  }
                } catch { /* fix failed */ }
              }
            }

            // Disallowed imports
            const pkgViolations = checkDisallowedImports(allModuleFiles, detectedScenes);
            if (pkgViolations.length > 0) {
              const violatedPaths = Array.from(new Set(pkgViolations.map((v) => v.filePath)));
              if (violatedPaths.length <= computeMaxPatchFiles(Object.keys(allModuleFiles).length)) {
                try {
                  const fixPrompt = buildDisallowedImportsEngineerPrompt(violatedPaths, allModuleFiles, pkgViolations, project.id);
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
                    const fixSSE = await readEngineerSSE(fixResponse.body, "engineer:complex:fix-packages");
                    Object.assign(allModuleFiles, fixSSE.files);
                  }
                } catch { /* fix failed */ }
              }
            }

            // Apply removeFiles from scaffold
            const finalFiles = allModuleFiles;
            if (capturedScaffold?.removeFiles) {
              for (const removePath of capturedScaffold.removeFiles) {
                delete finalFiles[removePath];
              }
            }

            // Create summary message
            const completedList = Object.keys(finalFiles).join(", ");
            const failedNote = failedModules.length > 0
              ? `\n\n⚠️ 以下模块生成失败: ${failedModules.join(", ")}`
              : "";
            const complexSummary = `✅ 模块化生成完成 (${Object.keys(finalFiles).length} 个文件):\n${completedList}${failedNote}`;

            updateAgentState("engineer", { status: "done", output: complexSummary });
            updateSession(project.id, { pipelineState: "COMPLETE", engineerProgress: null });

            const complexEngineerMsg: ProjectMessage = {
              id: makeTempId("temp-agent-engineer-complex"),
              projectId: project.id,
              role: "engineer",
              content: complexSummary,
              metadata: null,
              createdAt: getEpochDate(),
            };
            currentMessages = [...currentMessages, complexEngineerMsg];
            onMessagesChange(currentMessages);
            await persistMessage("engineer", complexSummary, {
              agentName: AGENTS.engineer.name,
              agentColor: AGENTS.engineer.color,
            });

            // Save version
            const complexRound: IterationRound = {
              userPrompt: prompt,
              intent,
              pmSummary: parsedPm,
              timestamp: roundTimestamp,
            };
            const complexUpdatedCtx = appendRound(iterationContext, complexRound);
            onIterationContextChange?.(complexUpdatedCtx);
            fetchAPI(`/api/projects/${project.id}`, {
              method: "PATCH",
              body: JSON.stringify({ iterationContext: complexUpdatedCtx }),
            }).catch((err: unknown) => {
              console.error("[iterationContext] PATCH failed — context may lag DB:", err);
            });

            const res = await fetchAPI("/api/versions", {
              method: "POST",
              body: JSON.stringify({
                projectId: project.id,
                files: finalFiles,
                description: prompt.slice(0, 80),
                changedFiles: computeChangedFiles(currentFiles, finalFiles),
                iterationSnapshot: complexUpdatedCtx,
              }),
            });
            const version = await res.json();
            onFilesGenerated(finalFiles, version);

            // Break out of AGENT_ORDER loop — complex path is done
            break;
          }
        }
      }

      // Legacy single-file path
      if (lastCode) {
        // Compute updated context including this round so snapshot is complete
        const legacyRound: IterationRound = {
          userPrompt: prompt,
          intent,
          pmSummary: parsedPm,
          timestamp: roundTimestamp,
        };
        const legacyUpdatedCtx = appendRound(iterationContext, legacyRound);

        const res = await fetchAPI("/api/versions", {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            code: lastCode,
            description: prompt.slice(0, 80),
            changedFiles: computeChangedFiles(currentFiles, { "/App.js": lastCode }),
            iterationSnapshot: legacyUpdatedCtx,
          }),
        });
        const version = await res.json();
        onFilesGenerated({ "/App.js": lastCode }, version);

        onIterationContextChange?.(legacyUpdatedCtx);
        fetchAPI(`/api/projects/${project.id}`, {
          method: "PATCH",
          body: JSON.stringify({ iterationContext: legacyUpdatedCtx }),
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
            decomposer: { role: "decomposer", status: "idle", output: "" },
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
        pipelineState={pipelineState}
        transitionText={transitionText}
        currentModule={currentModule}
        moduleProgress={moduleProgress}
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
                {generationError.raw && generationError.raw !== display.description && (
                  <p className="text-xs text-red-400 mt-1 break-all">{generationError.raw}</p>
                )}
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
