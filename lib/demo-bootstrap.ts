import { prisma } from "@/lib/prisma";

/**
 * Ensures a demo viewer account exists in the DB.
 * Call once at module init (imported by lib/auth.ts).
 *
 * If DEMO_VIEWER_ID is set but the user doesn't exist, creates it.
 * If DEMO_VIEWER_ID is not set, logs a warning — demo login will fail gracefully.
 */
export async function ensureDemoViewer(): Promise<void> {
  const id = process.env.DEMO_VIEWER_ID;
  if (!id) {
    console.warn("[demo-bootstrap] DEMO_VIEWER_ID is not set — demo login disabled");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    await prisma.user.create({
      data: { id, name: "Demo Viewer", isDemoViewer: true },
    });
    console.log(`[demo-bootstrap] Created demo viewer with id: ${id}`);
  }
}
