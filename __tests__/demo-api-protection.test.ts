import { GET as projectsGET, POST as projectsPOST } from "@/app/api/projects/route";
import { POST as messagesPOST } from "@/app/api/messages/route";
import { POST as versionsPOST } from "@/app/api/versions/route";

const mockGetServerSession = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        status: (init as { status?: number })?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    message: { create: jest.fn() },
    version: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("@/app/api/messages/message-service", () => ({
  saveMessage: jest.fn(),
}));

const demoSession = { user: { id: "demo_viewer_id", isDemo: true } };

function makeReq(body?: object): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Demo mode API protection", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockGetServerSession.mockResolvedValue(demoSession);
  });

  it("POST /api/projects returns 403 for demo user", async () => {
    const res = await projectsPOST(makeReq({ name: "New Project" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/messages returns 403 for demo user", async () => {
    const res = await messagesPOST(
      makeReq({ projectId: "p1", role: "user", content: "hi" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/versions returns 403 for demo user", async () => {
    const res = await versionsPOST(makeReq({ projectId: "p1", code: "x" }));
    expect(res.status).toBe(403);
  });

  it("GET /api/projects queries with DEMO_USER_ID for demo user", async () => {
    process.env.DEMO_USER_ID = "developer_id";
    const { prisma } = jest.requireMock("@/lib/prisma");
    (prisma.project.findMany as jest.Mock).mockResolvedValue([]);
    const res = await projectsGET();
    expect(res.status).not.toBe(403);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "developer_id" } })
    );
  });

  it("GET /api/projects returns 503 when DEMO_USER_ID is not configured", async () => {
    const saved = process.env.DEMO_USER_ID;
    delete process.env.DEMO_USER_ID;
    const res = await projectsGET();
    expect(res.status).toBe(503);
    process.env.DEMO_USER_ID = saved;
  });
});
