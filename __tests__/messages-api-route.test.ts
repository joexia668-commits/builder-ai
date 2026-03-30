import { POST } from "@/app/api/messages/route";

// Mock next-auth
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

// Mock auth options (just needs to exist)
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// Mock NextResponse from next/server
jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        status: (init as { status?: number })?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

// Mock prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findFirst: jest.fn(),
    },
  },
}));

// Mock message service
jest.mock("@/app/api/messages/message-service", () => ({
  saveMessage: jest.fn(),
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { saveMessage } from "@/app/api/messages/message-service";

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockFindFirst = prisma.project.findFirst as jest.MockedFunction<typeof prisma.project.findFirst>;
const mockSaveMessage = saveMessage as jest.MockedFunction<typeof saveMessage>;

function createRequest(body: object): Request {
  return new Request("http://localhost:3000/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest(): Request {
  return new Request("http://localhost:3000/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // no body — simulates E2E / network edge case
  });
}

const validBody = {
  projectId: "project-123",
  role: "pm",
  content: "这是 PM 的需求文档",
};

const mockSession = {
  user: { id: "user-123", name: "Test User", email: "test@example.com" },
  expires: "2099-01-01",
};

const mockProject = { id: "project-123" };

describe("POST /api/messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // IT-01: no auth → 401
  it("IT-01: 无认证时返回 401 Unauthorized", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const response = await POST(createRequest(validBody));
    expect(response.status).toBe(401);
  });

  // IT-00: empty body → 400 (not 500 crash)
  it("IT-00: 空请求体时返回 400 而不是崩溃", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);

    const response = await POST(createEmptyRequest());
    expect(response.status).toBe(400);
  });

  // IT-02: missing required fields → 400
  it("IT-02: 缺少 projectId 时返回 400", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);

    const response = await POST(
      createRequest({ role: "pm", content: "some content" })
    );
    expect(response.status).toBe(400);
  });

  it("IT-02: 缺少 role 时返回 400", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);

    const response = await POST(
      createRequest({ projectId: "project-123", content: "some content" })
    );
    expect(response.status).toBe(400);
  });

  it("IT-02: 缺少 content 时返回 400", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);

    const response = await POST(
      createRequest({ projectId: "project-123", role: "pm" })
    );
    expect(response.status).toBe(400);
  });

  // IT-03: project not belonging to user → 404
  it("IT-03: project 不属于当前用户时返回 404", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);
    mockFindFirst.mockResolvedValueOnce(null);

    const response = await POST(createRequest(validBody));
    expect(response.status).toBe(404);
  });

  // IT-04: valid request → 201 + message saved
  it("IT-04: 参数合法时返回 201 并保存消息", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);
    mockFindFirst.mockResolvedValueOnce(mockProject as never);

    const savedMessage = {
      id: "msg-1",
      projectId: "project-123",
      role: "pm",
      content: validBody.content,
      metadata: null,
      createdAt: new Date(),
    };
    mockSaveMessage.mockResolvedValueOnce(savedMessage);

    const response = await POST(createRequest(validBody));
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.id).toBe("msg-1");
    expect(body.role).toBe("pm");
    expect(body.content).toBe(validBody.content);
  });

  // IT-05: empty body → 400 not 500 crash
  it("IT-05: 请求 body 为空时返回 400 而非 500 崩溃", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);

    const emptyBodyRequest = new Request("http://localhost:3000/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // no body — req.json() throws SyntaxError: Unexpected end of JSON input
    });

    const response = await POST(emptyBodyRequest);
    expect(response.status).toBe(400);
  });

  it("IT-04: saveMessage 以正确参数被调用", async () => {
    mockGetServerSession.mockResolvedValueOnce(mockSession);
    mockFindFirst.mockResolvedValueOnce(mockProject as never);
    mockSaveMessage.mockResolvedValueOnce({
      id: "msg-1",
      projectId: "project-123",
      role: "pm",
      content: validBody.content,
      metadata: null,
      createdAt: new Date(),
    });

    await POST(createRequest(validBody));

    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: validBody.projectId,
        role: validBody.role,
        content: validBody.content,
      })
    );
  });
});
