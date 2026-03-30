export type AgentRole = "pm" | "architect" | "engineer";
export type MessageRole = "user" | AgentRole;

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
};

export const AGENT_ORDER: AgentRole[] = ["pm", "architect", "engineer"];

export interface ProjectMessage {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  metadata?: {
    agentName?: string;
    agentColor?: string;
    thinkingDuration?: number;
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
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  userId: string;
  preferredModel?: string | null;
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
  | "done"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  code?: string;
  messageId?: string;
  error?: string;
}

// CodeRenderer interface — enables future Sandpack extension
export interface CodeRenderer {
  render(code: string): void;
  refresh(): void;
  getMode(): "html" | "sandpack";
  destroy(): void;
}
