// __tests__/guest-cleanup.test.ts
import { deleteStaleGuestUsers } from "@/lib/guest-cleanup";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("deleteStaleGuestUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-11T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deletes guests with no activity in the past 5 days", async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: "guest_stale1" },
      { id: "guest_stale2" },
    ]);
    (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await deleteStaleGuestUsers();

    const cutoff = new Date("2026-04-06T10:00:00Z");

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isGuest: true,
        updatedAt: { lt: cutoff },
        projects: {
          none: { updatedAt: { gte: cutoff } },
        },
      },
      select: { id: true },
    });

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["guest_stale1", "guest_stale2"] } },
    });

    expect(result).toBe(2);
  });

  it("returns 0 and skips deleteMany when no stale guests found", async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    const result = await deleteStaleGuestUsers();

    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(result).toBe(0);
  });

  it("propagates errors from prisma", async () => {
    (prisma.user.findMany as jest.Mock).mockRejectedValue(
      new Error("DB connection failed")
    );

    await expect(deleteStaleGuestUsers()).rejects.toThrow("DB connection failed");
  });
});
