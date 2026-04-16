export type AgentRole = "pm" | "architect" | "engineer" | "decomposer";
export type MessageRole = "user" | "system" | AgentRole;

export interface Agent {
  id: AgentRole;
  name: string;
  avatar: string;
  role: string;
  color: string;
  bgColor: string;
  description: string;
}

export const AGENTS: Record<AgentRole, Agent> = {
  pm: {
    id: "pm",
    name: "PM Agent",
    avatar: "📋",
    role: "Product Manager",
    color: "#6366f1",
    bgColor: "bg-indigo-50 border-indigo-200",
    description: "分析需求，输出结构化 PRD",
  },
  architect: {
    id: "architect",
    name: "Architect Agent",
    avatar: "🏗️",
    role: "System Architect",
    color: "#f59e0b",
    bgColor: "bg-amber-50 border-amber-200",
    description: "设计技术方案，规划组件结构",
  },
  engineer: {
    id: "engineer",
    name: "Engineer Agent",
    avatar: "👨‍💻",
    role: "Full-Stack Engineer",
    color: "#10b981",
    bgColor: "bg-emerald-50 border-emerald-200",
    description: "生成完整可运行的代码",
  },
  decomposer: {
    id: "decomposer",
    name: "Decomposer",
    avatar: "🧩",
    role: "decomposer",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    description: "模块拆解器",
  },
};

export const AGENT_ORDER: AgentRole[] = ["pm", "decomposer", "architect", "engineer"];

export interface ProjectMessage {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  metadata?: {
    agentName?: string;
    agentColor?: string;
    thinkingDuration?: number;
    type?: string;
  } | null;
  createdAt: Date;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  code: string;
  description?: string | null;
  agentMessages?: unknown;
  createdAt: Date;
  parentVersionId?: string | null;
  changedFiles?: ChangedFiles | null;
  iterationSnapshot?: IterationContext | null;
}

export interface ChangedFiles {
  readonly added: Record<string, string>;
  readonly modified: Record<string, string>;
  readonly removed: readonly string[];
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  userId: string;
  preferredModel?: string | null;
  iterationContext?: IterationContext | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: ProjectMessage[];
  versions?: ProjectVersion[];
}

export type AgentStatus = "idle" | "thinking" | "streaming" | "done";

export interface AgentState {
  role: AgentRole;
  status: AgentStatus;
  output: string;
}

// SSE event types from /api/generate
export type SSEEventType =
  | "thinking"
  | "chunk"
  | "code_chunk"
  | "code_complete"
  | "files_complete"
  | "partial_files_complete"
  | "reset"
  | "done"
  | "error"
  | "file_start"
  | "file_chunk"
  | "file_end"
  | "pipeline_state" | "skeleton_ready"
  | "module_start" | "module_complete" | "module_failed";

export type ErrorCode =
  | "rate_limited"
  | "context_overflow"
  | "provider_unavailable"
  | "generation_timeout"
  | "parse_failed"
  | "missing_imports"
  | "scaffold_warning"
  | "unknown";

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  code?: string;
  files?: Record<string, string>;
  failed?: readonly string[];
  truncatedTail?: string;
  failedFiles?: readonly string[];
  messageId?: string;
  error?: string;
  errorCode?: ErrorCode;
  // Live-stream fields (engineer multi-file observational tap)
  path?: string;
  delta?: string;
  attempt?: number;
  // Pipeline controller fields
  state?: PipelineState;
  module?: string;
  index?: number;
  total?: number;
  dependencies?: Record<string, string>;
  summary?: { total: number; succeeded: number; failed: number };
}

// ---------------------------------------------------------------
// Engineer multi-file partial-salvage types (spec 2026-04-11)
// ---------------------------------------------------------------

export interface PartialExtractResult {
  readonly ok: Record<string, string>;
  readonly failed: readonly string[];
  readonly truncatedTail: string | null;
}

export interface RequestMeta {
  readonly attempt: number;        // 1-indexed
  readonly priorFailed: readonly string[];
}

export interface RequestResult {
  readonly files: Record<string, string>;
  readonly failed: readonly string[];
}

export type AttemptReason =
  | "initial"
  | "parse_failed"
  | "string_truncated"
  | "http_error"
  | "per_file_fallback";

export interface AttemptInfo {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly reason: AttemptReason;
  readonly failedSubset: readonly string[];
  readonly phase: "layer" | "per_file";
}

export interface ImportExportMismatch {
  readonly importerPath: string;
  readonly exporterPath: string;
  readonly missingNamed: readonly string[];   // named imports with no matching named export
  readonly missingDefault: boolean;  // default import with no default export
}

export interface DisallowedImport {
  readonly filePath: string;
  readonly packageName: string;
}

export interface LucideIconFix {
  readonly filePath: string;
  readonly original: string;
  readonly replacement: string;
}

// Structured output schemas for PM and Architect agents
export interface PmOutput {
  readonly intent: string;
  readonly features: readonly string[];
  readonly persistence: "none" | "localStorage" | "supabase";
  readonly modules: readonly string[];
  readonly dataModel?: readonly string[];
  readonly complexity?: Complexity;
  readonly gameType?: string;
}

export interface ArchOutput {
  readonly components: readonly string[];
  readonly state: string;
  readonly storage?: string;
  readonly icons?: readonly string[];
}

// Options passed to AIProvider.streamCompletion
export interface CompletionOptions {
  readonly jsonMode?: boolean;
  readonly maxOutputTokens?: number;
}

// Intent of a user's follow-up prompt — drives pipeline routing
export type Intent = "new_project" | "bug_fix" | "feature_add" | "style_change";

// Game subtype for fine-grained game architecture templates
export type GameSubtype = "match3" | "snake" | "tetris" | "platformer" | "card" | "board" | "generic";

// Scene type for prompt injection categorization
export type Scene =
  | "game" | "game-engine" | "game-canvas"
  | "dashboard" | "crud" | "multiview"
  | "animation" | "persistence" | "general";

// --- Pipeline Controller types ---

export type PipelineState =
  | "IDLE"
  | "CLASSIFYING"
  | "ARCHITECTING"
  | "ENGINEERING"
  | "DECOMPOSING"
  | "SKELETON"
  | "MODULE_FILLING"
  | "POST_PROCESSING"
  | "COMPLETE"
  | "ERROR";

export interface ModuleInterface {
  readonly exports: string[];
  readonly consumes: string[];
  readonly stateContract: string;
}

export interface ModuleDefinition {
  readonly name: string;
  readonly description: string;
  readonly estimatedFiles: number;
  readonly deps: readonly string[];
  readonly interface: ModuleInterface;
  readonly sceneType?: Scene;
  readonly engineeringHints?: string;
}

export interface SkeletonDefinition {
  readonly description: string;
  readonly files: readonly string[];
  readonly sharedTypes: string;
}

export interface DecomposerOutput {
  readonly skeleton: SkeletonDefinition;
  readonly modules: readonly ModuleDefinition[];
  readonly generateOrder: readonly (readonly string[])[];
}

// --- Orchestrator types ---

export interface ExportEntry {
  readonly name: string;
  readonly kind: "function" | "class" | "const" | "type" | "interface" | "default" | "unknown";
  readonly filePath: string;
}

export type ModuleStatus = "pending" | "generating" | "completed" | "failed" | "degraded";

export interface ModuleContract {
  readonly declared: {
    readonly exports: readonly string[];
    readonly consumes: readonly string[];
    readonly stateContract: string;
  };
  actual: {
    readonly exports: readonly ExportEntry[];
    readonly filePaths: readonly string[];
  } | null;
  status: ModuleStatus;
  failureReason?: string;
  degradedExports?: readonly string[];
}

export interface ContractVerifyResult {
  readonly satisfied: boolean;
  readonly missingExports: readonly string[];
  readonly extraExports: readonly string[];
}

export interface PlanRevision {
  readonly type: "absorb" | "skip_cascade" | "stub" | "retry";
  readonly description: string;
  readonly timestamp: number;
  readonly affected: readonly string[];
}

export interface FailedModule {
  readonly name: string;
  readonly reason: string;
  readonly attempt: number;
}

export interface ExecutionPlan {
  readonly original: DecomposerOutput;
  modules: ModuleDefinition[];
  pending: string[];
  executing: string | null;
  completed: string[];
  failed: FailedModule[];
  skipped: Array<{ name: string; reason: string }>;
  revisions: PlanRevision[];
}

export type Complexity = "simple" | "complex";

// Multi-file scaffold types (Architect agent output)
export interface ScaffoldFile {
  readonly path: string;
  readonly description: string;
  readonly exports: readonly string[];
  readonly deps: readonly string[];
  readonly hints: string;
  readonly maxLines?: number;
  readonly complexity?: "normal" | "high";
}

export interface ScaffoldData {
  readonly files: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly designNotes: string;
  readonly removeFiles?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
}

export interface ScaffoldValidationResult {
  readonly scaffold: ScaffoldData;
  readonly warnings: readonly string[];
}

// Cross-round iteration context (V2)
export interface IterationRound {
  readonly userPrompt: string;
  readonly intent: Intent;
  readonly pmSummary: PmOutput | null;
  readonly timestamp: string;
}

export interface IterationContext {
  readonly rounds: readonly IterationRound[];
}

// Engineer multi-file generation progress
export interface EngineerProgress {
  readonly totalLayers: number;
  readonly currentLayer: number;
  readonly totalFiles: number;
  readonly currentFiles: readonly string[];
  readonly completedFiles: readonly string[];
  readonly failedFiles: readonly string[];
  readonly retryInfo: {
    readonly layerIdx: number;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly reason: AttemptReason;
    readonly failedSubset: readonly string[];
    readonly phase: "layer" | "per_file";
  } | null;
}

// CodeRenderer interface — enables future Sandpack extension
export interface CodeRenderer {
  render(code: string): void;
  refresh(): void;
  getMode(): "html" | "sandpack";
  destroy(): void;
}

export interface Deployment {
  id: string;
  projectId: string;
  versionId: string;
  vercelProjectId: string;
  vercelDeployId: string;
  url: string;
  status: 'building' | 'ready' | 'error';
  createdAt: Date;
}

export interface LiveFileStream {
  readonly path: string;
  readonly content: string;
  readonly status: "streaming" | "done" | "failed";
  readonly attempt: number;
  readonly failedAttempts: ReadonlyArray<{
    readonly content: string;
    readonly reason: string;
  }>;
}
