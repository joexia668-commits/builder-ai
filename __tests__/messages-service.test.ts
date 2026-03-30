/**
 * TDD tests for message service — saveMessage and getProjectMessages
 *
 * RED: Tests define expected behavior before implementation.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { saveMessage, getProjectMessages } from "@/app/api/messages/message-service";
import { prisma } from "@/lib/prisma";

const mockCreate = prisma.message.create as jest.Mock;
const mockFindMany = prisma.message.findMany as jest.Mock;

describe("saveMessage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates a message with required fields", async () => {
    const fakeMsg = {
      id: "msg_1",
      projectId: "proj_1",
      role: "pm",
      content: "## PRD 分析",
      metadata: null,
      createdAt: new Date(),
    };
    mockCreate.mockResolvedValue(fakeMsg);

    const result = await saveMessage({
      projectId: "proj_1",
      role: "pm",
      content: "## PRD 分析",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        projectId: "proj_1",
        role: "pm",
        content: "## PRD 分析",
        metadata: undefined,
      },
    });
    expect(result).toEqual(fakeMsg);
  });

  it("passes metadata when provided", async () => {
    const meta = { agentName: "PM Agent", agentColor: "#6366f1" };
    mockCreate.mockResolvedValue({ id: "msg_2", metadata: meta });

    await saveMessage({
      projectId: "proj_1",
      role: "pm",
      content: "content",
      metadata: meta,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: meta }),
    });
  });

  it("supports all agent roles", async () => {
    mockCreate.mockResolvedValue({ id: "msg_3" });

    for (const role of ["user", "pm", "architect", "engineer"]) {
      await saveMessage({ projectId: "p", role, content: "test" });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role }) })
      );
    }
  });
});

describe("getProjectMessages", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns messages ordered by createdAt asc", async () => {
    const fakeMessages = [
      { id: "1", role: "user", content: "hi", projectId: "proj_1", metadata: null, createdAt: new Date("2024-01-01") },
      { id: "2", role: "pm", content: "prd", projectId: "proj_1", metadata: null, createdAt: new Date("2024-01-02") },
    ];
    mockFindMany.mockResolvedValue(fakeMessages);

    const result = await getProjectMessages("proj_1");

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { projectId: "proj_1" },
      orderBy: { createdAt: "asc" },
    });
    expect(result).toEqual(fakeMessages);
  });

  it("returns empty array when no messages", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await getProjectMessages("proj_empty");
    expect(result).toEqual([]);
  });
});
