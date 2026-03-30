/**
 * EPIC 7 — AC-2 / AC-4 集成测试
 *
 * 验证项目级 preferredModel 持久化与优先级：
 *   PM-01: PATCH project 设置 preferredModel → 持久化（AC-2）
 *   PM-02: PATCH project 无效 modelId → 400（AC-7）
 *   PM-03: GET project 返回 preferredModel 字段（AC-2）
 *   PM-04: 项目模型优先于用户模型（resolveModelId AC-4）
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
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { GET, PATCH } from "@/app/api/projects/[id]/route";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { resolveModelId } from "@/lib/ai-providers";

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockFindUnique = prisma.project.findUnique as jest.MockedFunction<typeof prisma.project.findUnique>;
const mockUpdate = prisma.project.update as jest.MockedFunction<typeof prisma.project.update>;

const SESSION = { user: { id: "user-abc", name: "Test User", email: "test@test.com" } };
const PROJECT = {
  id: "proj-001",
  userId: "user-abc",
  name: "My App",
  description: null,
  currentCode: null,
  preferredModel: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createRequest(projectId: string, body: object): [Request, { params: { id: string } }] {
  return [
    new Request(`http://localhost:3000/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: projectId } },
  ];
}

describe("Project [id] route — preferredModel 持久化（EPIC 7 AC-2）", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(SESSION as never);
    mockFindUnique.mockResolvedValue(PROJECT as never);
  });

  // PM-01: PATCH 设置有效 preferredModel → DB 更新
  it("PM-01: PATCH 设置有效 preferredModel 时持久化到 DB", async () => {
    const updatedProject = { ...PROJECT, preferredModel: "gemini-2.0-flash" };
    mockUpdate.mockResolvedValue(updatedProject as never);

    const [req, ctx] = createRequest("proj-001", { preferredModel: "gemini-2.0-flash" });
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferredModel).toBe("gemini-2.0-flash");

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-001" },
        data: expect.objectContaining({ preferredModel: "gemini-2.0-flash" }),
      })
    );
  });

  // PM-02: PATCH 无效 modelId → 400
  it("PM-02: 传入非白名单 modelId 返回 400", async () => {
    const [req, ctx] = createRequest("proj-001", { preferredModel: "claude-3-opus" });
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown modelId/);
    expect(body.error).toContain("claude-3-opus");
  });

  // PM-03: GET project 返回 preferredModel 字段
  it("PM-03: GET 返回项目的 preferredModel 字段", async () => {
    const projectWithModel = { ...PROJECT, preferredModel: "llama-3.3-70b" };
    mockFindUnique.mockResolvedValue(projectWithModel as never);

    const res = await GET(
      new Request("http://localhost:3000/api/projects/proj-001"),
      { params: { id: "proj-001" } }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferredModel).toBe("llama-3.3-70b");
  });
});

// ── AC-4: 项目模型优先于用户模型（resolveModelId 集成验证）─────────────────
describe("resolveModelId — 项目级优先于用户级（EPIC 7 AC-4）", () => {
  // PM-04: 项目模型存在时，即使用户也设置了模型，项目模型优先
  it("PM-04: 项目 preferredModel 优先于用户 preferredModel", () => {
    const projectModel = "gemini-2.0-flash";
    const userModel = "llama-3.3-70b";

    // requestModelId 为 null（UI 未覆盖），项目级 > 用户级
    const resolved = resolveModelId(null, projectModel, userModel);
    expect(resolved).toBe(projectModel);
  });

  it("PM-04b: 项目未设置时使用用户偏好", () => {
    const userModel = "llama-3.3-70b";

    const resolved = resolveModelId(null, null, userModel);
    expect(resolved).toBe(userModel);
  });
});
