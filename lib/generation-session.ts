import type {
  AgentRole,
  AgentState,
  EngineerProgress,
  ErrorCode,
  LiveFileStream,
} from "@/lib/types";

export interface GenerationSession {
  projectId: string;
  abortController: AbortController;
  agentStates: Record<AgentRole, AgentState>;
  engineerProgress: EngineerProgress | null;
  liveStreams: Record<string, LiveFileStream>;
  isGenerating: boolean;
  generationError: { code: ErrorCode; raw: string } | null;
  scaffoldWarnings: readonly string[];
  transitionText: string | null;
  lastPrompt: string;
  lastEventAt: number | null;
  stallWarning: boolean;
}

function makeEmptySession(projectId: string = ""): GenerationSession {
  return {
    projectId,
    abortController: new AbortController(),
    agentStates: {
      pm: { role: "pm", status: "idle", output: "" },
      decomposer: { role: "decomposer", status: "idle", output: "" },
      architect: { role: "architect", status: "idle", output: "" },
      engineer: { role: "engineer", status: "idle", output: "" },
    },
    engineerProgress: null,
    liveStreams: {},
    isGenerating: false,
    generationError: null,
    scaffoldWarnings: [],
    transitionText: null,
    lastPrompt: "",
    lastEventAt: null,
    stallWarning: false,
  };
}

/** Sentinel value for SSR snapshot in useSyncExternalStore */
export const EMPTY_SESSION: GenerationSession = {
  projectId: "",
  abortController: new AbortController(),
  agentStates: {
    pm: { role: "pm", status: "idle", output: "" },
    decomposer: { role: "decomposer", status: "idle", output: "" },
    architect: { role: "architect", status: "idle", output: "" },
    engineer: { role: "engineer", status: "idle", output: "" },
  },
  engineerProgress: null,
  liveStreams: {},
  isGenerating: false,
  generationError: null,
  scaffoldWarnings: [],
  transitionText: null,
  lastPrompt: "",
  lastEventAt: null,
  stallWarning: false,
};

const sessions = new Map<string, GenerationSession>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Returns the current session for a project, initializing to defaults if missing.
 */
export function getSession(projectId: string): GenerationSession {
  const existing = sessions.get(projectId);
  if (existing !== undefined) {
    return existing;
  }
  const fresh = makeEmptySession(projectId);
  sessions.set(projectId, fresh);
  return fresh;
}

/**
 * Merges patch into the session and notifies all subscribers for that project.
 */
export function updateSession(
  projectId: string,
  patch: Partial<GenerationSession>,
): void {
  const current = getSession(projectId);
  const updated: GenerationSession = { ...current, ...patch };
  sessions.set(projectId, updated);
  notifyListeners(projectId);
}

/**
 * Subscribes to session changes for a project.
 * Returns an unsubscribe function.
 */
export function subscribe(projectId: string, listener: () => void): () => void {
  if (!listeners.has(projectId)) {
    listeners.set(projectId, new Set());
  }
  // Non-null assertion safe: we just set it above if missing
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  listeners.get(projectId)!.add(listener);

  return () => {
    listeners.get(projectId)?.delete(listener);
  };
}

/**
 * Calls abort() on the stored AbortController without replacing it.
 * The caller is responsible for setting a new controller before the next generation.
 */
export function abortSession(projectId: string): void {
  const session = sessions.get(projectId);
  if (session !== undefined) {
    session.abortController.abort();
    updateSession(projectId, {});
  }
}

/**
 * Resets a project's session to idle defaults and notifies subscribers.
 */
export function resetSession(projectId: string): void {
  sessions.set(projectId, makeEmptySession(projectId));
  notifyListeners(projectId);
}

function notifyListeners(projectId: string): void {
  const projectListeners = listeners.get(projectId);
  if (projectListeners !== undefined) {
    projectListeners.forEach((fn) => fn());
  }
}
