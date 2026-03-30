/**
 * TDD: Gemini 429 rate-limit retry + Groq fallback
 * RT-R-01: 429 → retry succeeds on attempt 2
 * RT-R-02: 429 × 3 consecutive → throws RateLimitError
 * RT-R-03: non-429 error (500) → no retry, throws immediately
 * RT-R-04: first attempt succeeds → no retry invoked
 */

import { GeminiProvider, isRateLimitError, withRetry } from "@/lib/ai-providers";

// Suppress timer warnings in tests
jest.useFakeTimers();

const mockGenerateContentStream = jest.fn();

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContentStream: mockGenerateContentStream,
    }),
  })),
}));

// Helper: fake async iterable that yields chunks
function makeStream(chunks: string[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) {
            return { value: { text: () => chunks[i++] }, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

describe("isRateLimitError", () => {
  it("detects '429' in message", () => {
    expect(isRateLimitError(new Error("Request failed with status 429"))).toBe(true);
  });

  it("detects 'rate limit' (case-insensitive)", () => {
    expect(isRateLimitError(new Error("Rate Limit exceeded"))).toBe(true);
  });

  it("detects 'quota exceeded'", () => {
    expect(isRateLimitError(new Error("QUOTA_EXCEEDED: daily quota exceeded"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isRateLimitError(new Error("Internal Server Error 500"))).toBe(false);
  });
});

describe("withRetry", () => {
  beforeEach(() => jest.clearAllTimers());

  it("RT-R-04: returns immediately on first success — no retry", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("RT-R-01: retries on 429 and succeeds on attempt 2", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce("success");

    const promise = withRetry(fn, 3, 100);
    // Advance past the first backoff (100ms * 2^0 = 100ms)
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("RT-R-02: throws after exhausting all 3 attempts on 429", async () => {
    const rateLimitErr = new Error("429 quota exceeded");
    const fn = jest.fn().mockRejectedValue(rateLimitErr);

    const promise = withRetry(fn, 3, 100);
    // Bind rejects handler BEFORE advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow("429 quota exceeded");
    // Advance through all backoffs: 100ms + 200ms
    await jest.advanceTimersByTimeAsync(300);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("RT-R-03: does not retry on non-429 error", async () => {
    const serverErr = new Error("Internal Server Error 500");
    const fn = jest.fn().mockRejectedValue(serverErr);

    await expect(withRetry(fn)).rejects.toThrow("Internal Server Error 500");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("GeminiProvider — retry integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  });

  it("RT-R-01 (integration): streams content after one 429 retry", async () => {
    mockGenerateContentStream
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockResolvedValueOnce({ stream: makeStream(["hello", " world"]) });

    const provider = new GeminiProvider("gemini-2.0-flash");
    const chunks: string[] = [];

    const promise = provider.streamCompletion(
      [{ role: "user", content: "hi" }],
      (t) => chunks.push(t)
    );
    await jest.advanceTimersByTimeAsync(1000);
    await promise;

    expect(chunks).toEqual(["hello", " world"]);
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(2);
  });

  it("RT-R-02 (integration): throws after 3 failed 429 attempts", async () => {
    mockGenerateContentStream.mockRejectedValue(new Error("429 quota exceeded"));

    const provider = new GeminiProvider("gemini-2.0-flash");
    const promise = provider.streamCompletion(
      [{ role: "user", content: "hi" }],
      () => {}
    );
    // Bind rejects handler BEFORE advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow("429 quota exceeded");
    await jest.advanceTimersByTimeAsync(7000); // 1000 + 2000 + 4000
    await assertion;
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(3);
  });
});
