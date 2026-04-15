import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export type GuestUser = {
  id: string;
  name: string | null;
  isGuest: boolean;
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function createGuestUser(): Promise<GuestUser> {
  const devId = process.env.DEV_GUEST_ID;
  if (devId) {
    return prisma.user.upsert({
      where: { id: devId },
      update: {},
      create: { id: devId, name: "Guest (Dev)", isGuest: true },
    });
  }
  const id = `guest_${randomUUID().replace(/-/g, "")}`;
  return prisma.user.create({
    data: {
      id,
      name: "Guest",
      isGuest: true,
    },
  });
}

export async function findGuestUser(guestId: string): Promise<GuestUser | null> {
  return prisma.user.findFirst({
    where: { id: guestId, isGuest: true },
  });
}
