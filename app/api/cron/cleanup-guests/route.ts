import { NextResponse } from "next/server";
import { deleteStaleGuestUsers } from "@/lib/guest-cleanup";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteStaleGuestUsers();
    console.log(`[cron/cleanup-guests] deleted ${deleted} stale guest users`);
    return NextResponse.json({ deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cron/cleanup-guests] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
