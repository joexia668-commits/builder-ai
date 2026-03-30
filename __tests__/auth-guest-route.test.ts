/**
 * TDD tests for POST /api/auth/guest
 *
 * Tests the pure logic functions extracted from the route handler:
 * - createGuestUser: creates a new guest user with guest_ prefix
 * - findGuestUser: retrieves existing guest user by id
 */

import {
  createGuestUser,
  findGuestUser,
} from "@/app/api/auth/guest/guest-service";

// Mock Prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("createGuestUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a user with isGuest=true and guest_ prefixed id", async () => {
    const fakeUser = {
      id: "guest_abc123",
      name: "Guest",
      isGuest: true,
      email: null,
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (mockPrisma.user.create as jest.Mock).mockResolvedValue(fakeUser);

    const result = await createGuestUser();

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isGuest: true,
          name: "Guest",
        }),
      })
    );
    expect(result.isGuest).toBe(true);
    expect(result.id).toMatch(/^guest_/);
  });
});

describe("findGuestUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns user when guest user exists", async () => {
    const fakeUser = {
      id: "guest_abc123",
      name: "Guest",
      isGuest: true,
      email: null,
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue(fakeUser);

    const result = await findGuestUser("guest_abc123");

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "guest_abc123", isGuest: true },
      })
    );
    expect(result).toEqual(fakeUser);
  });

  it("returns null when guest user does not exist", async () => {
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await findGuestUser("guest_nonexistent");

    expect(result).toBeNull();
  });

  it("returns null for non-guest user ids (rejects regular users)", async () => {
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await findGuestUser("cuid_regular_user");

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isGuest: true }),
      })
    );
    expect(result).toBeNull();
  });
});
