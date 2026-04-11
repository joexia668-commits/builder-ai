export type ProviderId = "gemini" | "deepseek" | "groq";

export interface ModelDefinition {
  id: string;
  name: string;
  provider: ProviderId;
  /** Exact model string passed to the underlying SDK */
  providerModel: string;
  badge?: "Fast" | "Best" | "Balanced";
  description?: string;
  /** Environment variable key that must be non-empty for this model to be usable */
  envKey: string;
  /** Maximum output tokens the model supports */
  maxOutputTokens: number;
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    providerModel: "gemini-2.0-flash",
    badge: "Fast",
    description: "Google 最新快速模型，适合大多数任务",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    maxOutputTokens: 8192,
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "gemini",
    providerModel: "gemini-1.5-pro",
    badge: "Best",
    description: "高质量、强推理能力",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    maxOutputTokens: 8192,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    providerModel: "deepseek-chat",
    badge: "Balanced",
    description: "当前默认模型，代码生成能力强",
    envKey: "DEEPSEEK_API_KEY",
    maxOutputTokens: 8192,
  },
  {
    id: "llama-3.3-70b",
    name: "Groq Llama 3.3 70B",
    provider: "groq",
    providerModel: "llama-3.3-70b-versatile",
    badge: "Fast",
    description: "超低延迟，适合快速迭代",
    envKey: "GROQ_API_KEY",
    maxOutputTokens: 8192,
  },
];

/** Default fallback model — used only when no preferred model has a valid API key */
export const DEFAULT_MODEL_ID = "deepseek-chat";

export function getModelById(id: string | undefined): ModelDefinition | undefined {
  if (!id) return undefined;
  return MODEL_REGISTRY.find((m) => m.id === id);
}

/**
 * Returns models whose required API key is present in the given env map.
 * Pass `process.env` in production; pass a plain object in tests.
 */
export function getAvailableModels(
  env: Record<string, string | undefined>
): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => Boolean(env[m.envKey]));
}

export function isValidModelId(id: string | undefined): boolean {
  if (!id) return false;
  return MODEL_REGISTRY.some((m) => m.id === id);
}
