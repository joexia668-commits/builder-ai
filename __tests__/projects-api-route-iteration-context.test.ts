import { PATCH } from "@/app/api/projects/[id]/route";

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

// Mock model-registry so isValidModelId doesn't error
jest.mock("@/lib/model-registry", () => ({
  isValidModelId: jest.fn(() => true),
}));

// Mock prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockFindUnique = prisma.project.findUnique as jest.MockedFunction<
  typeof prisma.project.findUnique
>;
const mockUpdate = prisma.project.update as jest.MockedFunction<
  typeof prisma.project.update
>;

const mockSession = {
  user: { id: "user-123", name: "Test User", email: "test@example.com", isDemo: false },
  expires: "2099-01-01",
};

const mockProject = {
  id: "project-123",
  userId: "user-123",
  name: "Test Project",
  description: null,
  preferredModel: null,
  iterationContext: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockIterationContext = {
  rounds: [
    {
      userPrompt: "做一个待办应用",
      intent: "new_project",
      pmSummary: null,
      archDecisions: null,
      timestamp: "2026-04-13T00:00:00.000Z",
    },
  ],
};

function createRequest(body: object): Request {
  return new Request("http://localhost:3000/api/projects/project-123", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/projects/[id] — iterationContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue(mockSession);
    mockFindUnique.mockResolvedValue(mockProject as never);
    mockUpdate.mockResolvedValue({ ...mockProject } as never);
  });

  it("PATCH with iterationContext present → prisma.project.update called with iterationContext in data", async () => {
    const request = createRequest({ iterationContext: mockIterationContext });
    const params = { id: "project-123" };

    const response = await PATCH(request, { params });
    expect(response.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          iterationContext: mockIterationContext,
        }),
      })
    );
  });

  it("PATCH without iterationContext (field omitted) → prisma.project.update called WITHOUT iterationContext key in data", async () => {
    const request = createRequest({ name: "Updated Name" });
    const params = { id: "project-123" };

    const response = await PATCH(request, { params });
    expect(response.status).toBe(200);

    const callArg = mockUpdate.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty("iterationContext");
  });

  it("PATCH with iterationContext: null → prisma.project.update called with iterationContext: null in data", async () => {
    const request = createRequest({ iterationContext: null });
    const params = { id: "project-123" };

    const response = await PATCH(request, { params });
    expect(response.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          iterationContext: null,
        }),
      })
    );
  });
});
