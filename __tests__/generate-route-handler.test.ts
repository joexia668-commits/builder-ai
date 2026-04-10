/**
 * Behavioral tests for the generate route handler.
 * Uses createHandler(deps) to inject mock providers — no jest.mock for provider behavior.
 * Tests cover all 9 scenarios from the DI design spec.
 */

import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn().mockResolvedValue({ sub: "user-1" }),
}));

jest.mock("@/lib/extract-code", () => ({
  extractReactCode: jest.fn(),
  extractMultiFileCode: jest.fn(),
}));

import { createHandler } from "@/app/api/generate/route";
import { extractReactCode, extractMultiFileCode } from "@/lib/extract-code";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: object): NextRequest {
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function collectSSE(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

function makeSuccessProvider(chunks: string[] = ["hello"]) {
  return {
    streamCompletion: jest.fn(async (_msgs: unknown, onChunk: (t: string) => void) => {
      for (const chunk of chunks) onChunk(chunk);
    }),
  };
}

// ── Auth & validation ────────────────────────────────────────────────────────

describe("Generate Route Handler — auth and validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
  });

  it("test 8: returns 401 when no auth token", async () => {
    (getToken as jest.Mock).mockResolvedValue(null);
    const mockCreateProvider = jest.fn();
    const handler = createHandler({ createProvider: mockCreateProvider });

    const res = await handler(makeReq({ agent: "pm", prompt: "test", projectId: "p1" }));

    expect(res.status).toBe(401);
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it("test 9: returns 400 for invalid modelId", async () => {
    const mockCreateProvider = jest.fn();
    const handler = createHandler({ createProvider: mockCreateProvider });

    const res = await handler(makeReq({
      agent: "pm",
      prompt: "test",
      projectId: "p1",
      modelId: "nonexistent-model-xyz",
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("nonexistent-model-xyz");
  });
});

// ── Normal generation ────────────────────────────────────────────────────────

describe("Generate Route Handler — normal generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
  });

  it("test 1: PM agent streams chunks and sends done", async () => {
    const provider = makeSuccessProvider(["feature1", " feature2"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });

    const res = await handler(makeReq({ agent: "pm", prompt: "build a todo app", projectId: "p1" }));
    const events = await collectSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("chunk");
    expect(types).toContain("done");
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.map((e) => e.content).join("")).toBe("feature1 feature2");
  });

  it("test 2: Architect agent streams chunks and sends done", async () => {
    const provider = makeSuccessProvider(["arch output"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });

    const res = await handler(makeReq({ agent: "architect", prompt: "design system", projectId: "p1", context: "pm output" }));
    const events = await collectSSE(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("chunk");
    expect(types).toContain("done");
  });

  it("test 3: Engineer single-file sends code_complete", async () => {
    const provider = makeSuccessProvider(["function App() { return <div /> }"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });
    (extractReactCode as jest.Mock).mockReturnValue("function App() { return <div /> }");

    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx" }));
    const events = await collectSSE(res);

    const codeEvent = events.find((e) => e.type === "code_complete");
    expect(codeEvent).toBeDefined();
    expect(typeof codeEvent?.code).toBe("string");
    expect((codeEvent?.code as string).length).toBeGreaterThan(0);
  });

  it("test 4: Engineer multi-file sends files_complete", async () => {
    const provider = makeSuccessProvider(["// FILE: /App.js\nfunction App(){}"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });
    (extractMultiFileCode as jest.Mock).mockReturnValue({ "/App.js": "function App(){}" });

    const targetFiles = [{ path: "/App.js", description: "main", exports: ["App"], deps: [], hints: "" }];
    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx", targetFiles }));
    const events = await collectSSE(res);

    const filesEvent = events.find((e) => e.type === "files_complete");
    expect(filesEvent).toBeDefined();
    expect((filesEvent?.files as Record<string, string>)["/App.js"]).toBeDefined();
  });
});

// ── Behavioral branches ──────────────────────────────────────────────────────

describe("Generate Route Handler — behavioral branches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue({ sub: "user-1" });
  });

  it("test 5: rate limit triggers Groq fallback", async () => {
    // Primary provider throws 429; Groq provider succeeds
    const primaryProvider = {
      streamCompletion: jest.fn().mockRejectedValue(new Error("429 rate limit exceeded")),
    };
    const groqProvider = makeSuccessProvider(["groq response"]);
    const mockCreateProvider = jest.fn()
      .mockReturnValueOnce(primaryProvider)  // first call: primary model
      .mockReturnValueOnce(groqProvider);    // second call: llama-3.3-70b fallback

    const originalKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-groq-key";

    try {
      const handler = createHandler({ createProvider: mockCreateProvider });
      const res = await handler(makeReq({ agent: "pm", prompt: "build", projectId: "p1" }));
      const events = await collectSSE(res);

      // createProvider called twice: once for primary, once for Groq
      expect(mockCreateProvider).toHaveBeenCalledTimes(2);
      expect(mockCreateProvider.mock.calls[1][0]).toBe("llama-3.3-70b");

      // SSE has reset (discard partial) then done
      const types = events.map((e) => e.type);
      expect(types).toContain("reset");
      expect(types).toContain("done");
    } finally {
      if (originalKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalKey;
    }
  });

  it("test 6: max_tokens triggers conciseness retry for engineer", async () => {
    (extractReactCode as jest.Mock).mockReturnValue("function App(){}");

    const provider = {
      streamCompletion: jest.fn()
        .mockRejectedValueOnce(new Error("max_tokens_exceeded"))         // first attempt fails
        .mockImplementationOnce(async (_: unknown, onChunk: (t: string) => void) => {
          onChunk("function App(){}");                                    // retry succeeds
        }),
    };
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });

    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx" }));
    const events = await collectSSE(res);

    // streamCompletion called twice: original + retry
    expect(provider.streamCompletion).toHaveBeenCalledTimes(2);
    // Retry request contains the conciseness instruction
    const retryCall = provider.streamCompletion.mock.calls[1];
    expect(JSON.stringify(retryCall[0])).toContain("280 行以内");

    // SSE has reset then code_complete
    const types = events.map((e) => e.type);
    expect(types).toContain("reset");
    expect(types).toContain("code_complete");
  });

  it("test 7: parse failure emits parse_failed error code", async () => {
    // streamCompletion succeeds but extractReactCode returns null (garbage output)
    const provider = makeSuccessProvider(["GARBAGE_OUTPUT_NOT_CODE"]);
    const handler = createHandler({ createProvider: jest.fn().mockReturnValue(provider) });
    (extractReactCode as jest.Mock).mockReturnValue(null);

    const res = await handler(makeReq({ agent: "engineer", prompt: "build", projectId: "p1", context: "ctx" }));
    const events = await collectSSE(res);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.errorCode).toBe("parse_failed");
  });
});
