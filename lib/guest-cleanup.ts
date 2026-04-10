import { prisma } from "@/lib/prisma";

const STALE_DAYS = 5;

/**
 * Deletes guest users with no activity in the past STALE_DAYS days.
 * "Activity" is defined as User.updatedAt or any Project.updatedAt within the window.
 * Cascade delete removes all associated Projects, Messages, Versions, Deployments.
 * @returns number of deleted users
 */
export async function deleteStaleGuestUsers(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);

  const staleGuests = await prisma.user.findMany({
    where: {
      isGuest: true,
      updatedAt: { lt: cutoff },
      projects: {
        none: { updatedAt: { gte: cutoff } },
      },
    },
    select: { id: true },
  });

  if (staleGuests.length === 0) return 0;

  const ids = staleGuests.map((u) => u.id);
  const { count } = await prisma.user.deleteMany({
    where: { id: { in: ids } },
  });

  return count;
}
