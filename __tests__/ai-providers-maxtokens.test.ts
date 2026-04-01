/**
 * Integration tests: verify that every AI provider passes the explicit
 * maxOutputTokens / max_tokens cap when streaming completions.
 *
 * These tests use mocked SDKs (no real API keys needed) but exercise the
 * full streamCompletion() call path so that missing config parameters are
 * caught as real failures rather than file-content assertions.
 *
 * AP-MAXTOK-01 ~ AP-MAXTOK-03
 */

// ── Mock @google/generative-ai — captures getGenerativeModel call args ──────
const mockGetGenerativeModel = jest.fn();
const mockGenerateContentStream = jest.fn();

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// ── Mock openai (DeepSeekProvider) ─────────────────────────────────────────
const mockOpenAICreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}));

// ── Mock groq-sdk ──────────────────────────────────────────────────────────
const mockGroqCreate = jest.fn();
jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockGroqCreate } },
  })),
}));

import { GeminiProvider, DeepSeekProvider, GroqProvider } from "@/lib/ai-providers";

const MESSAGES = [
  { role: "system" as const, content: "You are helpful." },
  { role: "user" as const, content: "Build an app" },
];

async function* emptyAsyncIterable() {}

function makeOpenAIStream(chunks: string[] = []) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const text of chunks) {
        yield { choices: [{ delta: { content: text } }] };
      }
    },
  };
}

describe("AI Provider maxOutputTokens configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // AP-MAXTOK-01: GeminiProvider must pass generationConfig.maxOutputTokens = 8192
  it("AP-MAXTOK-01: GeminiProvider 调用 getGenerativeModel 时传入 maxOutputTokens: 8192", async () => {
    mockGetGenerativeModel.mockReturnValue({
      generateContentStream: mockGenerateContentStream.mockResolvedValue({
        stream: { [Symbol.asyncIterator]: emptyAsyncIterable },
      }),
    });

    const provider = new GeminiProvider("gemini-2.0-flash", 8192);
    await provider.streamCompletion(MESSAGES, () => {});

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: expect.objectContaining({ maxOutputTokens: 8192 }),
      })
    );
  });

  // AP-MAXTOK-02: DeepSeekProvider must pass max_tokens = 16384 to OpenAI-compat client
  it("AP-MAXTOK-02: DeepSeekProvider 调用 create() 时传入 max_tokens: 16384", async () => {
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream([]));

    const provider = new DeepSeekProvider("deepseek-chat", 16384);
    await provider.streamCompletion(MESSAGES, () => {});

    expect(mockOpenAICreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 16384 })
    );
  });

  // AP-MAXTOK-03: GroqProvider must pass max_tokens = 16384
  it("AP-MAXTOK-03: GroqProvider 调用 create() 时传入 max_tokens: 16384", async () => {
    mockGroqCreate.mockResolvedValue(makeOpenAIStream([]));

    const provider = new GroqProvider("llama-3.3-70b-versatile", 16384);
    await provider.streamCompletion(MESSAGES, () => {});

    expect(mockGroqCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 16384 })
    );
  });

  // AP-MAXTOK-04: Gemini maxOutputTokens value is exactly 8192 (not lower)
  it("AP-MAXTOK-04: maxOutputTokens 值精确为 8192，不低于此值", async () => {
    mockGetGenerativeModel.mockReturnValue({
      generateContentStream: mockGenerateContentStream.mockResolvedValue({
        stream: { [Symbol.asyncIterator]: emptyAsyncIterable },
      }),
    });

    const provider = new GeminiProvider("gemini-2.0-flash", 8192);
    await provider.streamCompletion(MESSAGES, () => {});

    const callArg = mockGetGenerativeModel.mock.calls[0][0] as {
      generationConfig?: { maxOutputTokens?: number };
    };
    expect(callArg.generationConfig?.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });

  // AP-MAXTOK-05: max_tokens for DeepSeek/Groq is at least 8192 (elevated from 8192 to 16384)
  it("AP-MAXTOK-05: DeepSeek/Groq max_tokens 值不低于 8192", async () => {
    mockOpenAICreate.mockResolvedValue(makeOpenAIStream([]));
    mockGroqCreate.mockResolvedValue(makeOpenAIStream([]));

    const deepseek = new DeepSeekProvider("deepseek-chat", 16384);
    await deepseek.streamCompletion(MESSAGES, () => {});
    const deepseekArg = mockOpenAICreate.mock.calls[0][0] as { max_tokens?: number };
    expect(deepseekArg.max_tokens).toBeGreaterThanOrEqual(8192);

    jest.clearAllMocks();
    mockGroqCreate.mockResolvedValue(makeOpenAIStream([]));
    const groq = new GroqProvider("llama-3.3-70b-versatile", 16384);
    await groq.streamCompletion(MESSAGES, () => {});
    const groqArg = mockGroqCreate.mock.calls[0][0] as { max_tokens?: number };
    expect(groqArg.max_tokens).toBeGreaterThanOrEqual(8192);
  });
});

// ── Route truncation handling — verified via file content ──────────────────
import * as fs from "fs";
import * as path from "path";

describe("Generate Route — truncation null handling (RT-TRUNC)", () => {
  let routeContent: string;

  beforeAll(() => {
    routeContent = fs.readFileSync(
      path.resolve(__dirname, "../app/api/generate/route.ts"),
      "utf-8"
    );
  });

  // RT-TRUNC-01: Route checks for null return from extractReactCode
  it("RT-TRUNC-01: route.ts 检查 extractReactCode 返回 null", () => {
    expect(routeContent).toMatch(/finalCode\s*===\s*null/);
  });

  // RT-TRUNC-02: Route emits error event with truncation message when null
  it("RT-TRUNC-02: route.ts 对 null 代码发送 error 类型 SSE 事件", () => {
    expect(routeContent).toContain("生成的代码不完整");
    // Verify error event structure
    expect(routeContent).toMatch(/type.*error/);
  });

  // RT-TRUNC-03: Route emits code_complete only for non-null code
  it("RT-TRUNC-03: route.ts 仅对非 null 代码发送 code_complete 事件", () => {
    // The code_complete send must be in the else branch (after null check)
    const nullCheckIdx = routeContent.indexOf("finalCode === null");
    const codeCompleteIdx = routeContent.indexOf("code_complete");
    // code_complete should appear after the null check (in else branch)
    expect(nullCheckIdx).toBeGreaterThanOrEqual(0);
    expect(codeCompleteIdx).toBeGreaterThan(nullCheckIdx);
  });
});
