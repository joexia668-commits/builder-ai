import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Groq from "groq-sdk";
import { getModelById, getAvailableModels, DEFAULT_MODEL_ID, type ModelDefinition } from "@/lib/model-registry";
import type { CompletionOptions } from "@/lib/types";

export interface CompletionMessage {
  role: "system" | "user";
  content: string;
}

export interface AIProvider {
  streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void,
    options?: CompletionOptions
  ): Promise<void>;
}

// Per-agent stream timeout: bail out cleanly rather than burning the full 300s
// Vercel maxDuration. 90s is generous for even the slowest model responses.
const STREAM_TIMEOUT_MS = 90_000;

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
  private readonly maxOutputTokens: number;

  constructor(providerModel: string, maxOutputTokens: number) {
    this.providerModel = providerModel;
    this.maxOutputTokens = maxOutputTokens;
  }

  async streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void,
    options?: CompletionOptions
  ): Promise<void> {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: this.providerModel,
      generationConfig: {
        maxOutputTokens: this.maxOutputTokens,
        ...(options?.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
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

    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(new Error("Gemini stream timeout")),
      STREAM_TIMEOUT_MS
    );

    try {
      const result = await withRetry(() =>
        model.generateContentStream(prompt, { signal: abortController.signal })
      );
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) onChunk(text);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ── DeepSeek (via OpenAI-compatible API) ───────────────────────────────────

export class DeepSeekProvider implements AIProvider {
  private readonly providerModel: string;
  private readonly maxOutputTokens: number;

  constructor(providerModel: string, maxOutputTokens: number) {
    this.providerModel = providerModel;
    this.maxOutputTokens = maxOutputTokens;
  }

  async streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void,
    options?: CompletionOptions
  ): Promise<void> {
    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseURL: "https://api.deepseek.com/v1",
    });

    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(new Error("DeepSeek stream timeout")),
      STREAM_TIMEOUT_MS
    );

    try {
      const result = await client.chat.completions.create({
        model: this.providerModel,
        messages,
        stream: true,
        max_tokens: this.maxOutputTokens,
        ...(options?.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      }, { signal: abortController.signal });

      for await (const chunk of result) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) onChunk(text);
        if (chunk.choices[0]?.finish_reason === "length") {
          throw new Error("max_tokens_exceeded");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === "max_tokens_exceeded") throw err;
      throw new Error(`DeepSeek stream error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ── Groq ───────────────────────────────────────────────────────────────────

export class GroqProvider implements AIProvider {
  private readonly providerModel: string;
  private readonly maxOutputTokens: number;

  constructor(providerModel: string, maxOutputTokens: number) {
    this.providerModel = providerModel;
    this.maxOutputTokens = maxOutputTokens;
  }

  async streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void,
    options?: CompletionOptions
  ): Promise<void> {
    const client = new Groq({
      apiKey: process.env.GROQ_API_KEY ?? "",
    });

    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(new Error("Groq stream timeout")),
      STREAM_TIMEOUT_MS
    );

    try {
      const result = await client.chat.completions.create({
        model: this.providerModel,
        messages,
        stream: true,
        max_tokens: this.maxOutputTokens,
        ...(options?.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      }, { signal: abortController.signal });

      for await (const chunk of result) {
        const choice = (chunk as { choices: Array<{ delta: { content?: string }; finish_reason?: string }> }).choices[0];
        if (choice?.delta?.content) onChunk(choice.delta.content);
        if (choice?.finish_reason === "length") {
          throw new Error("max_tokens_exceeded");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === "max_tokens_exceeded") throw err;
      throw new Error(`Groq stream error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createProvider(modelId: string): AIProvider {
  const model: ModelDefinition | undefined = getModelById(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  switch (model.provider) {
    case "gemini":
      return new GeminiProvider(model.providerModel, model.maxOutputTokens);
    case "deepseek":
      return new DeepSeekProvider(model.providerModel, model.maxOutputTokens);
    case "groq":
      return new GroqProvider(model.providerModel, model.maxOutputTokens);
  }
}

/**
 * Resolve the model ID to use, following the priority chain:
 *   requestModelId → projectModelId → userModelId → env AI_PROVIDER → DEFAULT_MODEL_ID → first available
 *
 * Each candidate is skipped if its API key env var is not set, so the resolver
 * automatically falls through to the first actually-available model.
 */
export function resolveModelId(
  requestModelId?: string | null,
  projectModelId?: string | null,
  userModelId?: string | null,
  env: Record<string, string | undefined> = process.env
): string {
  const candidates = [
    requestModelId,
    projectModelId,
    userModelId,
    env.AI_PROVIDER,
    DEFAULT_MODEL_ID,
  ];
  for (const id of candidates) {
    if (!id) continue;
    const model = getModelById(id);
    if (model && Boolean(env[model.envKey])) return id;
  }
  // Ultimate fallback: first model with a key present
  const available = getAvailableModels(env);
  return available.length > 0 ? available[0].id : DEFAULT_MODEL_ID;
}
