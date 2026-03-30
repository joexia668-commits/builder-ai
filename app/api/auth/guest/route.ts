import { NextResponse } from "next/server";
import { createGuestUser, findGuestUser } from "./guest-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      guestId?: string;
    };

    if (body.guestId) {
      const existing = await findGuestUser(body.guestId);
      if (existing) {
        return NextResponse.json({ userId: existing.id });
      }
      // Guest not found — create a fresh one
    }

    const guest = await createGuestUser();
    return NextResponse.json({ userId: guest.id });
  } catch (error) {
    const err = error as Error & { code?: string; detail?: string; hint?: string };
    console.error("[guest route] error:", err.message, "| code:", err.code, "| detail:", err.detail);
    return NextResponse.json(
      { error: "Failed to create guest session" },
      { status: 500 }
    );
  }
}
