"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "builder_ai_guest_id";

export function GuestLoginButtons() {
  const router = useRouter();
  const [savedGuestId, setSavedGuestId] = useState<string | null>(null);
  const [expiredSession, setExpiredSession] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const devId = process.env.NEXT_PUBLIC_DEV_GUEST_ID;
    setSavedGuestId(devId || localStorage.getItem(STORAGE_KEY));
  }, []);

  async function handleNewGuest() {
    setIsLoading(true);
    setExpiredSession(false);
    try {
      const res = await fetch("/api/auth/guest", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create guest");
      const { userId } = (await res.json()) as { userId: string };
      localStorage.setItem(STORAGE_KEY, userId);
      await signIn("credentials", { guestId: userId, callbackUrl: "/" });
    } catch (err) {
      console.error("[GuestLoginButtons] new guest error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRestoreGuest() {
    if (!savedGuestId) return;
    setIsLoading(true);
    try {
      const result = await signIn("credentials", {
        guestId: savedGuestId,
        redirect: false,
      });
      if (result?.error) {
        // Guest account no longer exists — expired and cleaned up
        localStorage.removeItem(STORAGE_KEY);
        setSavedGuestId(null);
        setExpiredSession(true);
      } else {
        router.push("/");
      }
    } catch (err) {
      console.error("[GuestLoginButtons] restore guest error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  const showContinue = !!savedGuestId && !expiredSession;

  return (
    <div className="flex flex-col gap-2 w-full">
      {expiredSession && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-[8px] px-3 py-2 text-center">
          你的访客会话已过期，之前的项目已被清除。
        </p>
      )}
      {showContinue ? (
        <Button
          variant="outline"
          onClick={handleRestoreGuest}
          disabled={isLoading}
          className="w-full h-[40px] rounded-[10px] border-[1.5px] border-border hover:border-border/80 transition-colors"
        >
          Continue as Guest
        </Button>
      ) : (
        <Button
          variant="ghost"
          onClick={handleNewGuest}
          disabled={isLoading}
          className="w-full text-muted-foreground hover:text-foreground"
        >
          Try as Guest
        </Button>
      )}
    </div>
  );
}
