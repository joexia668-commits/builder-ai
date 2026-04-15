/**
 * Unit tests for /api/versions routes — EPIC 3
 *
 * Covers:
 * API-01: GET /api/versions — auth check, projectId validation, ordered results
 * API-02: POST /api/versions — auth, validation, version number increment, 201 response
 * API-03: POST /api/versions/:id/restore — immutable pattern, description format, new version number
 */

// Mock next-auth
jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
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
    version: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/versions/route";
import { POST as RESTORE } from "@/app/api/versions/[id]/restore/route";

const mockSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockVersionFindMany = prisma.version.findMany as jest.Mock;
const mockVersionFindFirst = prisma.version.findFirst as jest.Mock;
const mockVersionCreate = prisma.version.create as jest.Mock;
const mockProjectFindFirst = prisma.project.findFirst as jest.Mock;
const mockProjectUpdate = prisma.project.update as jest.Mock;

const session = {
  user: { id: "user-1", name: "Test", email: "t@t.com" },
  expires: "2099-01-01",
};

const mockProject = { id: "proj-1", userId: "user-1" };

function makeGetRequest(projectId?: string): Request {
  const url = projectId
    ? `http://localhost:3000/api/versions?projectId=${projectId}`
    : "http://localhost:3000/api/versions";
  return new Request(url, { method: "GET" });
}

function makePostRequest(body: object): Request {
  return new Request("http://localhost:3000/api/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRestoreRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/versions/${id}/restore`, {
    method: "POST",
  });
}

// ─── GET /api/versions ─────────────────────────────────────────────────────

describe("GET /api/versions", () => {
  beforeEach(() => jest.clearAllMocks());

  // API-01a: unauthenticated → 401
  it("API-01a: 未认证时返回 401", async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(makeGetRequest("proj-1"));
    expect(res.status).toBe(401);
  });

  // API-01b: missing projectId → 400
  it("API-01b: 缺少 projectId 时返回 400", async () => {
    mockSession.mockResolvedValue(session);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
  });

  // API-01c: returns versions in ascending versionNumber order
  it("API-01c: 返回按 versionNumber 升序排列的版本列表", async () => {
    mockSession.mockResolvedValue(session);

    const versions = [
      { id: "v1", versionNumber: 1, code: "code1", projectId: "proj-1" },
      { id: "v2", versionNumber: 2, code: "code2", projectId: "proj-1" },
      { id: "v3", versionNumber: 3, code: "code3", projectId: "proj-1" },
    ];
    mockVersionFindMany.mockResolvedValue(versions);

    const res = await GET(makeGetRequest("proj-1"));
    expect(res.status).toBe(200);

    const body = await res.json() as { versions: typeof versions };
    expect(body.versions).toHaveLength(3);
    expect(body.versions[0].versionNumber).toBe(1);
    expect(body.versions[2].versionNumber).toBe(3);

    // Verify Prisma was called with ascending order
    expect(mockVersionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { versionNumber: "asc" },
      })
    );
  });

  // API-01d: scoped to user's own projects
  it("API-01d: 仅查询属于当前用户的项目版本", async () => {
    mockSession.mockResolvedValue(session);
    mockVersionFindMany.mockResolvedValue([]);

    await GET(makeGetRequest("proj-1"));

    expect(mockVersionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: { userId: "user-1" },
        }),
      })
    );
  });
});

// ─── POST /api/versions ────────────────────────────────────────────────────

describe("POST /api/versions", () => {
  beforeEach(() => jest.clearAllMocks());

  // API-02a: unauthenticated → 401
  it("API-02a: 未认证时返回 401", async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(makePostRequest({ projectId: "proj-1", code: "x" }));
    expect(res.status).toBe(401);
  });

  // API-02b: missing projectId or code → 400
  it("API-02b: 缺少 projectId 时返回 400", async () => {
    mockSession.mockResolvedValue(session);
    const res = await POST(makePostRequest({ code: "x" }));
    expect(res.status).toBe(400);
  });

  it("API-02b: 缺少 code 时返回 400", async () => {
    mockSession.mockResolvedValue(session);
    const res = await POST(makePostRequest({ projectId: "proj-1" }));
    expect(res.status).toBe(400);
  });

  // API-02c: project not found / not owned → 404
  it("API-02c: 项目不属于当前用户时返回 404", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(null);
    const res = await POST(makePostRequest({ projectId: "proj-1", code: "x" }));
    expect(res.status).toBe(404);
  });

  // API-02d: first version gets versionNumber = 1 (no prior versions)
  it("API-02d: 项目首个版本的 versionNumber 为 1", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue(null); // no prior versions
    mockVersionCreate.mockResolvedValue({
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "code",
      description: "initial",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(makePostRequest({ projectId: "proj-1", code: "code", description: "initial" }));
    expect(res.status).toBe(201);

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ versionNumber: 1 }) })
    );
  });

  // API-02e: subsequent versions increment correctly (MAX + 1)
  it("API-02e: 后续版本号正确自增（MAX + 1）", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue({ versionNumber: 3 }); // last = v3
    mockVersionCreate.mockResolvedValue({
      id: "v4",
      projectId: "proj-1",
      versionNumber: 4,
      code: "code-v4",
      description: "fourth",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(makePostRequest({ projectId: "proj-1", code: "code-v4", description: "fourth" }));
    expect(res.status).toBe(201);

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ versionNumber: 4 }) })
    );
  });

  // API-02-multi: accepts files field and writes both code and files
  it("API-02-multi: accepts files field, writes code from /App.js + files", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue(null);
    mockVersionCreate.mockResolvedValue({
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "app code",
      files: { "/App.js": "app code", "/components/Header.js": "header code" },
      description: "multi",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const files = { "/App.js": "app code", "/components/Header.js": "header code" };
    const res = await POST(makePostRequest({ projectId: "proj-1", files, description: "multi" }));
    expect(res.status).toBe(201);

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "app code",
          files: { "/App.js": "app code", "/components/Header.js": "header code" },
        }),
      })
    );
  });

  it("API-02g: stores changedFiles and iterationSnapshot when provided", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue(null);
    const changedFiles = {
      added: { "/New.js": "new" },
      modified: { "/App.js": "updated" },
      removed: ["/Old.js"],
    };
    const iterationSnapshot = {
      rounds: [{ userPrompt: "test", intent: "new_project", pmSummary: null, timestamp: "2026-04-15T00:00:00Z" }],
    };
    mockVersionCreate.mockResolvedValue({
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "app code",
      files: { "/App.js": "app code" },
      changedFiles,
      iterationSnapshot,
      description: "test",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(
      makePostRequest({
        projectId: "proj-1",
        files: { "/App.js": "app code" },
        description: "test",
        changedFiles,
        iterationSnapshot,
      })
    );
    expect(res.status).toBe(201);

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changedFiles,
          iterationSnapshot,
        }),
      })
    );
  });

  it("API-02h: omitted changedFiles and iterationSnapshot default to undefined (backward compat)", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue(null);
    mockVersionCreate.mockResolvedValue({
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "code",
      description: "no extras",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(makePostRequest({ projectId: "proj-1", code: "code", description: "no extras" }));
    expect(res.status).toBe(201);

    const createCall = mockVersionCreate.mock.calls[0][0];
    expect(createCall.data.changedFiles).toBeUndefined();
    expect(createCall.data.iterationSnapshot).toBeUndefined();
  });

  // API-02f: returns 201 with the created version object
  it("API-02f: 成功时返回 201 和新版本对象", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue({ versionNumber: 1 });
    const created = {
      id: "v2",
      projectId: "proj-1",
      versionNumber: 2,
      code: "new-code",
      description: "second",
      createdAt: new Date(),
    };
    mockVersionCreate.mockResolvedValue(created);
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(makePostRequest({ projectId: "proj-1", code: "new-code", description: "second" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.versionNumber).toBe(2);
    expect(body.code).toBe("new-code");
  });
});

// ─── POST /api/versions/:id/restore ───────────────────────────────────────

describe("POST /api/versions/[id]/restore", () => {
  beforeEach(() => jest.clearAllMocks());

  // API-03a: unauthenticated → 401
  it("API-03a: 未认证时返回 401", async () => {
    mockSession.mockResolvedValue(null);
    const res = await RESTORE(makeRestoreRequest("v2"), { params: { id: "v2" } });
    expect(res.status).toBe(401);
  });

  // API-03b: version not found / not owned → 404
  it("API-03b: 版本不存在或不属于当前用户时返回 404", async () => {
    mockSession.mockResolvedValue(session);
    mockVersionFindFirst.mockResolvedValueOnce(null);
    const res = await RESTORE(makeRestoreRequest("v999"), { params: { id: "v999" } });
    expect(res.status).toBe(404);
  });

  // API-03c: creates NEW version (immutable principle — never overwrites)
  it("API-03c: 恢复时创建新版本（不可变原则，不覆盖原版本）", async () => {
    mockSession.mockResolvedValue(session);

    // Source version (v2)
    const sourceVersion = { id: "v2", projectId: "proj-1", versionNumber: 2, code: "v2-code" };
    mockVersionFindFirst
      .mockResolvedValueOnce(sourceVersion)      // find source version
      .mockResolvedValueOnce({ versionNumber: 4 }); // find last version
    mockVersionCreate.mockResolvedValue({
      id: "v5",
      projectId: "proj-1",
      versionNumber: 5,
      code: "v2-code",
      description: "从 v2 恢复",
      createdAt: new Date(),
    });

    const res = await RESTORE(makeRestoreRequest("v2"), { params: { id: "v2" } });
    expect(res.status).toBe(201);

    // Must create, not update
    expect(mockVersionCreate).toHaveBeenCalledTimes(1);
    expect(mockVersionCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() }) // no update-style call
    );
  });

  // API-03d: description follows "从 v{n} 恢复" format
  it('API-03d: 新版本描述格式为"从 v{n} 恢复"', async () => {
    mockSession.mockResolvedValue(session);

    const sourceVersion = { id: "v2", projectId: "proj-1", versionNumber: 2, code: "v2-code" };
    mockVersionFindFirst
      .mockResolvedValueOnce(sourceVersion)
      .mockResolvedValueOnce({ versionNumber: 3 });
    mockVersionCreate.mockResolvedValue({
      id: "v4",
      projectId: "proj-1",
      versionNumber: 4,
      code: "v2-code",
      description: "从 v2 恢复",
      createdAt: new Date(),
    });

    await RESTORE(makeRestoreRequest("v2"), { params: { id: "v2" } });

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: "从 v2 恢复" }) })
    );
  });

  // API-03e: new version gets correct incremented version number
  it("API-03e: 新版本号 = 当前最大版本号 + 1", async () => {
    mockSession.mockResolvedValue(session);

    mockVersionFindFirst
      .mockResolvedValueOnce({ id: "v3", projectId: "proj-1", versionNumber: 3, code: "v3-code" })
      .mockResolvedValueOnce({ versionNumber: 5 }); // current max is 5
    mockVersionCreate.mockResolvedValue({
      id: "v6",
      projectId: "proj-1",
      versionNumber: 6,
      code: "v3-code",
      description: "从 v3 恢复",
      createdAt: new Date(),
    });

    await RESTORE(makeRestoreRequest("v3"), { params: { id: "v3" } });

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ versionNumber: 6 }) })
    );
  });

  // API-03f: restored version carries source code, not new code
  it("API-03f: 恢复的版本包含原版本代码", async () => {
    mockSession.mockResolvedValue(session);

    const sourceCode = "<!DOCTYPE html><html>original code</html>";
    mockVersionFindFirst
      .mockResolvedValueOnce({ id: "v1", projectId: "proj-1", versionNumber: 1, code: sourceCode })
      .mockResolvedValueOnce({ versionNumber: 3 });
    mockVersionCreate.mockResolvedValue({
      id: "v4",
      projectId: "proj-1",
      versionNumber: 4,
      code: sourceCode,
      description: "从 v1 恢复",
      createdAt: new Date(),
    });

    const res = await RESTORE(makeRestoreRequest("v1"), { params: { id: "v1" } });
    const body = await res.json();

    expect(body.code).toBe(sourceCode);
    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: sourceCode }) })
    );
  });
});
