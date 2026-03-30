import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Groq from "groq-sdk";
import { getModelById, DEFAULT_MODEL_ID, type ModelDefinition } from "@/lib/model-registry";

export interface CompletionMessage {
  role: "system" | "user";
  content: string;
}

export interface AIProvider {
  streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void
  ): Promise<void>;
}

// ── Rate-limit retry helpers ───────────────────────────────────────────────

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("quota exceeded")
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === maxAttempts) throw err;
      await new Promise<void>((r) =>
        setTimeout(r, baseDelayMs * 2 ** (attempt - 1))
      );
    }
  }
  // unreachable — loop always throws or returns
  throw new Error("withRetry: exhausted attempts");
}

// ── Gemini ─────────────────────────────────────────────────────────────────

export class GeminiProvider implements AIProvider {
  private readonly providerModel: string;

  constructor(providerModel: string) {
    this.providerModel = providerModel;
  }

  async streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void
  ): Promise<void> {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: this.providerModel,
      generationConfig: { maxOutputTokens: 8192 },
    });

    // Split system prompt from user messages
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user");

    const prompt = [
      systemMsg ? `System: ${systemMsg.content}` : "",
      userMsg?.content ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await withRetry(() => model.generateContentStream(prompt));

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) onChunk(text);
    }
  }
}

// ── DeepSeek (via OpenAI-compatible API) ───────────────────────────────────

export class DeepSeekProvider implements AIProvider {
  private readonly providerModel: string;

  constructor(providerModel: string) {
    this.providerModel = providerModel;
  }

  async streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void
  ): Promise<void> {
    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseURL: "https://api.deepseek.com/v1",
    });

    const result = await client.chat.completions.create({
      model: this.providerModel,
      messages,
      stream: true,
      max_tokens: 8192,
    });

    for await (const chunk of result) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  }
}

// ── Groq ───────────────────────────────────────────────────────────────────

export class GroqProvider implements AIProvider {
  private readonly providerModel: string;

  constructor(providerModel: string) {
    this.providerModel = providerModel;
  }

  async streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void
  ): Promise<void> {
    const client = new Groq({
      apiKey: process.env.GROQ_API_KEY ?? "",
    });

    const result = await client.chat.completions.create({
      model: this.providerModel,
      messages,
      stream: true,
      max_tokens: 8192,
    });

    for await (const chunk of result) {
      const text = (chunk as { choices: Array<{ delta: { content?: string } }> })
        .choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createProvider(modelId: string): AIProvider {
  const model: ModelDefinition | undefined = getModelById(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  switch (model.provider) {
    case "gemini":
      return new GeminiProvider(model.providerModel);
    case "deepseek":
      return new DeepSeekProvider(model.providerModel);
    case "groq":
      return new GroqProvider(model.providerModel);
  }
}

/**
 * Resolve the model ID to use, following the priority chain:
 *   requestModelId → projectModelId → userModelId → env AI_PROVIDER → DEFAULT_MODEL_ID
 */
export function resolveModelId(
  requestModelId?: string | null,
  projectModelId?: string | null,
  userModelId?: string | null
): string {
  const candidates = [
    requestModelId,
    projectModelId,
    userModelId,
    process.env.AI_PROVIDER,
    DEFAULT_MODEL_ID,
  ];
  for (const id of candidates) {
    if (id && getModelById(id)) return id;
  }
  return DEFAULT_MODEL_ID;
}
