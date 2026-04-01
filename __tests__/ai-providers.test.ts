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
  const VALID_IDS = {
    gemini: "gemini-2.0-flash",
    deepseek: "deepseek-chat",
    groq: "llama-3.3-70b",
    pro: "gemini-1.5-pro",
  };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // U-01: requestModelId 有效时直接返回（最高优先级）
  it("U-01: 返回有效的 requestModelId（优先级最高）", () => {
    expect(resolveModelId(VALID_IDS.gemini, VALID_IDS.deepseek, VALID_IDS.groq))
      .toBe(VALID_IDS.gemini);
  });

  // U-02: requestModelId 无效，回退到 projectModelId
  it("U-02: requestModelId 无效时回退到 projectModelId", () => {
    expect(resolveModelId("invalid-model", VALID_IDS.deepseek, VALID_IDS.groq))
      .toBe(VALID_IDS.deepseek);
  });

  // U-03: 前两层均无效，回退到 userModelId
  it("U-03: requestModelId 和 projectModelId 均无效时回退到 userModelId", () => {
    expect(resolveModelId("bad-1", "bad-2", VALID_IDS.groq))
      .toBe(VALID_IDS.groq);
  });

  // U-04: 前三层无效，回退到 AI_PROVIDER 环境变量
  it("U-04: 前三层均无效时回退到 AI_PROVIDER 环境变量", () => {
    process.env.AI_PROVIDER = VALID_IDS.pro;
    expect(resolveModelId("bad-1", "bad-2", "bad-3"))
      .toBe(VALID_IDS.pro);
  });

  // U-05: 全部无效，回退到 DEFAULT_MODEL_ID
  it("U-05: 全部无效时回退到 DEFAULT_MODEL_ID（deepseek-chat）", () => {
    expect(resolveModelId("bad-1", "bad-2", "bad-3"))
      .toBe("deepseek-chat");
  });

  // U-06: null 和 undefined 均被视为"无效"
  it("U-06: null 视为无效，继续往后查找", () => {
    expect(resolveModelId(null, VALID_IDS.deepseek, VALID_IDS.groq))
      .toBe(VALID_IDS.deepseek);
  });

  it("U-06b: undefined 视为无效，继续往后查找", () => {
    expect(resolveModelId(undefined, undefined, VALID_IDS.groq))
      .toBe(VALID_IDS.groq);
  });

  // U-07: 非白名单字符串视为无效
  it("U-07: 非白名单字符串（如 gpt-4）视为无效，继续回退", () => {
    expect(resolveModelId("gpt-4", "gpt-3.5-turbo", VALID_IDS.gemini))
      .toBe(VALID_IDS.gemini);
  });

  // U-08: 无参调用返回默认值
  it("U-08: 无参调用返回 DEFAULT_MODEL_ID", () => {
    expect(resolveModelId()).toBe("deepseek-chat");
  });

  // U-09: AI_PROVIDER 为无效值时跳过至 DEFAULT
  it("U-09: AI_PROVIDER 环境变量为无效值时跳过，返回 DEFAULT_MODEL_ID", () => {
    process.env.AI_PROVIDER = "unknown-provider-xyz";
    expect(resolveModelId(null, null, null))
      .toBe("deepseek-chat");
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
