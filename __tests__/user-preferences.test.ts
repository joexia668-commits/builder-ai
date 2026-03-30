/**
 * EPIC 7 — AC-3 集成测试
 *
 * 验证 /api/user/preferences GET + PATCH 路由：
 *   UP-01: GET 无 session → 401
 *   UP-02: GET 有 session → 返回 preferredModel（含 null）
 *   UP-03: PATCH 无效 modelId → 400
 *   UP-04: PATCH 有效 modelId → 200 + DB 更新
 *   UP-05: PATCH null → 清除偏好
 */

// ── Mock next-auth ─────────────────────────────────────────────────────────
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// ── Mock NextResponse ──────────────────────────────────────────────────────
jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        status: (init as { status?: number })?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

// ── Mock Prisma ────────────────────────────────────────────────────────────
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { GET, PATCH } from "@/app/api/user/preferences/route";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockUpdate = prisma.user.update as jest.MockedFunction<typeof prisma.user.update>;

const SESSION = { user: { id: "user-abc", name: "Test User", email: "test@example.com" } };

function createPatchRequest(body: object): Request {
  return new Request("http://localhost:3000/api/user/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/user/preferences — GET", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // UP-01: GET 无 session → 401
  it("UP-01: 无 session 时返回 401 Unauthorized", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  // UP-02a: GET 有 session，用户有 preferredModel
  it("UP-02: 返回用户设置的 preferredModel", async () => {
    mockGetServerSession.mockResolvedValue(SESSION as never);
    mockFindUnique.mockResolvedValue({ preferredModel: "gemini-2.0-flash" } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferredModel).toBe("gemini-2.0-flash");
  });

  // UP-02b: GET 有 session，用户未设置 preferredModel → 返回 null
  it("UP-02b: 用户未设置偏好时返回 preferredModel: null", async () => {
    mockGetServerSession.mockResolvedValue(SESSION as never);
    mockFindUnique.mockResolvedValue({ preferredModel: null } as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferredModel).toBeNull();
  });
});

describe("/api/user/preferences — PATCH", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // UP-03: PATCH 无效 modelId → 400
  it("UP-03: 传入非白名单 modelId 返回 400", async () => {
    mockGetServerSession.mockResolvedValue(SESSION as never);
    const req = createPatchRequest({ preferredModel: "gpt-4-turbo" });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown modelId/);
    expect(body.error).toContain("gpt-4-turbo");
  });

  // UP-04: PATCH 有效 modelId → 200 + DB 更新
  it("UP-04: 有效 modelId 更新 DB 并返回 200", async () => {
    mockGetServerSession.mockResolvedValue(SESSION as never);
    mockUpdate.mockResolvedValue({ preferredModel: "deepseek-chat" } as never);

    const req = createPatchRequest({ preferredModel: "deepseek-chat" });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferredModel).toBe("deepseek-chat");

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SESSION.user.id },
        data: expect.objectContaining({ preferredModel: "deepseek-chat" }),
      })
    );
  });

  // UP-05: PATCH null → 清除偏好（设为 null）
  it("UP-05: preferredModel 为 null 时清除偏好", async () => {
    mockGetServerSession.mockResolvedValue(SESSION as never);
    mockUpdate.mockResolvedValue({ preferredModel: null } as never);

    const req = createPatchRequest({ preferredModel: null });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferredModel).toBeNull();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ preferredModel: null }),
      })
    );
  });
});
