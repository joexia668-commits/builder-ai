/**
 * EPIC 7 — AC-7 / RT-E5-04 行为测试
 *
 * 通过真实调用 POST handler 验证 HTTP 层 modelId 校验逻辑：
 *   G-01: 有效 modelId → provider 创建成功，开始 SSE 流
 *   G-02: 非白名单 modelId → 400 + 错误消息
 *   G-03: modelId 为 null → 回退默认，正常返回 200
 *   G-04: 未认证请求 → 401（行为验证，非静态扫描）
 */

// ── Mock next-auth/jwt (edge-compatible auth) ──────────────────────────────
jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(),
}));

// ── Mock AI providers to avoid real API calls ──────────────────────────────
const mockStreamCompletion = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/ai-providers", () => ({
  resolveModelId: jest.requireActual("@/lib/ai-providers").resolveModelId,
  createProvider: jest.fn(() => ({
    streamCompletion: mockStreamCompletion,
  })),
}));

// ── Mock extract-code ──────────────────────────────────────────────────────
jest.mock("@/lib/extract-code", () => ({
  extractReactCode: jest.fn((code: string) => code),
}));

import { POST } from "@/app/api/generate/route";
import { getToken } from "next-auth/jwt";
import { createProvider } from "@/lib/ai-providers";

const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockCreateProvider = createProvider as jest.MockedFunction<typeof createProvider>;

function createRequest(body: object): Request {
  return new Request("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  agent: "pm",
  prompt: "做一个 TODO app",
  projectId: "proj-test-123",
};

describe("Generate Route — modelId HTTP 层校验（EPIC 7 AC-7）", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: authenticated user
    mockGetToken.mockResolvedValue({ sub: "user-1", name: "Test User" } as never);
  });

  // G-04: 未认证 → 401（行为测试，非静态扫描）
  it("G-04: 未认证请求返回 401 Unauthorized", async () => {
    mockGetToken.mockResolvedValue(null);
    const req = createRequest(BASE_BODY);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // G-02: 非白名单 modelId → 400 + 错误消息
  it("G-02: 非白名单 modelId 返回 400 with error message", async () => {
    const req = createRequest({ ...BASE_BODY, modelId: "gpt-4-turbo" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown modelId/);
    expect(body.error).toContain("gpt-4-turbo");
  });

  // G-01: 有效 modelId → createProvider 以正确 modelId 调用，返回 SSE 流
  it("G-01: 有效 modelId 时调用 createProvider 并返回 SSE 流", async () => {
    const req = createRequest({ ...BASE_BODY, modelId: "gemini-2.0-flash" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(mockCreateProvider).toHaveBeenCalledWith("gemini-2.0-flash");
  });

  // G-03: modelId 为 null → 回退默认模型，正常返回 200
  it("G-03: modelId 为 null 时回退到默认模型并正常响应", async () => {
    const req = createRequest({ ...BASE_BODY, modelId: null });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // createProvider should be called with the default model (deepseek-chat)
    expect(mockCreateProvider).toHaveBeenCalledWith("deepseek-chat");
  });
});
