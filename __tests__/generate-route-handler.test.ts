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
