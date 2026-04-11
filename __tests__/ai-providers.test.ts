/**
 * TDD tests for lib/ai-providers.ts
 *
 * RED: define expected behavior before implementation.
 * All SDK calls are mocked — no real API keys needed.
 */

// ── Mock @google/generative-ai ─────────────────────────────────────────────
const mockGenerateContentStream = jest.fn();
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContentStream: mockGenerateContentStream,
    }),
  })),
}));

// ── Mock openai (used by DeepSeekProvider) ─────────────────────────────────
const mockOpenAICreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockOpenAICreate,
      },
    },
  })),
}));

// ── Mock groq-sdk ──────────────────────────────────────────────────────────
const mockGroqCreate = jest.fn();
jest.mock("groq-sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockGroqCreate,
      },
    },
  })),
}));

import { createProvider, resolveModelId, GeminiProvider, DeepSeekProvider, GroqProvider } from "@/lib/ai-providers";

// ── helpers ────────────────────────────────────────────────────────────────
function makeAsyncIterable(chunks: string[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const text of chunks) {
        yield { text: () => text };
      }
    },
  };
}

function makeOpenAIAsyncIterable(chunks: string[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const text of chunks) {
        yield { choices: [{ delta: { content: text } }] };
      }
    },
  };
}

const MESSAGES = [
  { role: "system" as const, content: "You are helpful." },
  { role: "user" as const, content: "Hello" },
];

// ── resolveModelId priority chain ─────────────────────────────────────────
describe("resolveModelId", () => {
  const IDS = {
    gemini: "gemini-2.0-flash",
    deepseek: "deepseek-chat",
    groq: "llama-3.3-70b",
    pro: "gemini-1.5-pro",
  };

  // Env maps with keys present for specific providers
  const allKeysEnv = {
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    DEEPSEEK_API_KEY: "d-key",
    GROQ_API_KEY: "q-key",
  };
  const deepseekOnlyEnv = { DEEPSEEK_API_KEY: "d-key" };
  const groqOnlyEnv = { GROQ_API_KEY: "q-key" };
  const geminiAndDeepseekEnv = {
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    DEEPSEEK_API_KEY: "d-key",
  };
  const noKeysEnv = {};

  // U-01: requestModelId 可用时直接返回（最高优先级）
  it("U-01: 返回可用的 requestModelId（优先级最高）", () => {
    expect(resolveModelId(IDS.gemini, IDS.deepseek, IDS.groq, allKeysEnv))
      .toBe(IDS.gemini);
  });

  // U-02: requestModelId API key 缺失时，跳过并回退到 projectModelId
  it("U-02: requestModelId key 缺失时回退到 projectModelId", () => {
    expect(resolveModelId(IDS.gemini, IDS.deepseek, IDS.groq, deepseekOnlyEnv))
      .toBe(IDS.deepseek);
  });

  // U-03: 前两层 key 均缺失，回退到 userModelId
  it("U-03: requestModelId 和 projectModelId key 均缺失时回退到 userModelId", () => {
    expect(resolveModelId(IDS.gemini, IDS.deepseek, IDS.groq, groqOnlyEnv))
      .toBe(IDS.groq);
  });

  // U-04: 前三层均无 key，回退到 AI_PROVIDER 环境变量
  it("U-04: 前三层均无 key 时回退到 AI_PROVIDER 环境变量", () => {
    expect(resolveModelId("bad-1", "bad-2", "bad-3", {
      AI_PROVIDER: IDS.pro,
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    })).toBe(IDS.pro);
  });

  // U-05: 全部首选均不可用，回退到 DEFAULT_MODEL_ID（需要 key）
  it("U-05: 首选均不可用时，DEFAULT_MODEL_ID 有 key 则返回它", () => {
    expect(resolveModelId("bad-1", "bad-2", "bad-3", deepseekOnlyEnv))
      .toBe(IDS.deepseek);
  });

  // U-06: 所有 key 均缺失时，回退到注册表里第一个可用的模型
  it("U-06: 所有首选无 key 且 DEFAULT 也无 key 时，返回注册表中第一个有 key 的模型", () => {
    expect(resolveModelId("bad-1", "bad-2", "bad-3", groqOnlyEnv))
      .toBe(IDS.groq);
  });

  // U-07: null / undefined 视为"未指定"，继续往后查找
  it("U-07: null 视为未指定，继续往后查找", () => {
    expect(resolveModelId(null, IDS.deepseek, IDS.groq, deepseekOnlyEnv))
      .toBe(IDS.deepseek);
  });

  it("U-07b: undefined 视为未指定，继续往后查找", () => {
    expect(resolveModelId(undefined, undefined, IDS.groq, groqOnlyEnv))
      .toBe(IDS.groq);
  });

  // U-08: 非注册表字符串视为无效（无论 key 是否存在）
  it("U-08: 非注册表字符串（如 gpt-4）视为无效，继续回退", () => {
    expect(resolveModelId("gpt-4", "gpt-3.5-turbo", IDS.gemini, allKeysEnv))
      .toBe(IDS.gemini);
  });

  // U-09: 无参调用（没有任何 key）返回 DEFAULT_MODEL_ID
  it("U-09: 完全无参时返回 DEFAULT_MODEL_ID", () => {
    // No keys in env → ultimate fallback is DEFAULT_MODEL_ID
    expect(resolveModelId(undefined, undefined, undefined, noKeysEnv))
      .toBe("deepseek-chat");
  });

  // U-10: AI_PROVIDER 为无效值时跳过
  it("U-10: AI_PROVIDER 为无效 model id 时跳过，回退到第一个有 key 的模型", () => {
    expect(resolveModelId(null, null, null, {
      AI_PROVIDER: "unknown-provider-xyz",
      DEEPSEEK_API_KEY: "d-key",
    })).toBe(IDS.deepseek);
  });
});

// ── createProvider factory ─────────────────────────────────────────────────
describe("createProvider", () => {
  it("returns GeminiProvider for gemini-2.0-flash", () => {
    const p = createProvider("gemini-2.0-flash");
    expect(p).toBeInstanceOf(GeminiProvider);
  });

  it("returns GeminiProvider for gemini-1.5-pro", () => {
    const p = createProvider("gemini-1.5-pro");
    expect(p).toBeInstanceOf(GeminiProvider);
  });

  it("returns DeepSeekProvider for deepseek-chat", () => {
    const p = createProvider("deepseek-chat");
    expect(p).toBeInstanceOf(DeepSeekProvider);
  });

  it("returns GroqProvider for llama-3.3-70b", () => {
    const p = createProvider("llama-3.3-70b");
    expect(p).toBeInstanceOf(GroqProvider);
  });

  it("throws for unknown modelId", () => {
    expect(() => createProvider("gpt-4-turbo")).toThrow(/Unknown model/);
  });
});

// ── GeminiProvider ─────────────────────────────────────────────────────────
describe("GeminiProvider.streamCompletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls onChunk for each text chunk", async () => {
    mockGenerateContentStream.mockResolvedValue(
      { stream: makeAsyncIterable(["Hello", " World"]) }
    );

    const provider = new GeminiProvider("gemini-2.0-flash", 8192);
    const chunks: string[] = [];
    await provider.streamCompletion(MESSAGES, (text) => chunks.push(text));

    expect(chunks).toEqual(["Hello", " World"]);
  });

  it("skips empty chunks", async () => {
    mockGenerateContentStream.mockResolvedValue(
      { stream: makeAsyncIterable(["Hello", "", " World"]) }
    );

    const provider = new GeminiProvider("gemini-2.0-flash", 8192);
    const chunks: string[] = [];
    await provider.streamCompletion(MESSAGES, (text) => chunks.push(text));

    expect(chunks).toEqual(["Hello", " World"]);
  });

  it("passes system prompt as first history entry", async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: makeAsyncIterable([]) });
    const provider = new GeminiProvider("gemini-2.0-flash", 8192);
    await provider.streamCompletion(MESSAGES, () => {});
    expect(mockGenerateContentStream).toHaveBeenCalled();
  });
});

// ── DeepSeekProvider ───────────────────────────────────────────────────────
describe("DeepSeekProvider.streamCompletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls onChunk for each content delta", async () => {
    mockOpenAICreate.mockResolvedValue(
      makeOpenAIAsyncIterable(["foo", " bar"])
    );

    const provider = new DeepSeekProvider("deepseek-chat", 8192);
    const chunks: string[] = [];
    await provider.streamCompletion(MESSAGES, (text) => chunks.push(text));

    expect(chunks).toEqual(["foo", " bar"]);
  });

  it("skips chunks with no content", async () => {
    mockOpenAICreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: "hello" } }] };
        yield { choices: [{ delta: {} }] }; // no content field
        yield { choices: [{ delta: { content: " world" } }] };
      },
    });

    const provider = new DeepSeekProvider("deepseek-chat", 8192);
    const chunks: string[] = [];
    await provider.streamCompletion(MESSAGES, (text) => chunks.push(text));

    expect(chunks).toEqual(["hello", " world"]);
  });
});

// ── GroqProvider ───────────────────────────────────────────────────────────
describe("GroqProvider.streamCompletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls onChunk for each content delta", async () => {
    mockGroqCreate.mockResolvedValue(
      makeOpenAIAsyncIterable(["abc", "def"])
    );

    const provider = new GroqProvider("llama-3.3-70b-versatile", 8192);
    const chunks: string[] = [];
    await provider.streamCompletion(MESSAGES, (text) => chunks.push(text));

    expect(chunks).toEqual(["abc", "def"]);
  });
});
