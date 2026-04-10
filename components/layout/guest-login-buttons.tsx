"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "builder_ai_guest_id";

export function GuestLoginButtons() {
  const [savedGuestId, setSavedGuestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setSavedGuestId(localStorage.getItem(STORAGE_KEY));
  }, []);

  async function handleNewGuest() {
    setIsLoading(true);
    try {
      // 1. Create guest user in DB, get the userId
      const res = await fetch("/api/auth/guest", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create guest");
      const { userId } = (await res.json()) as { userId: string };

      // 2. Persist guestId to localStorage for future session restore
      localStorage.setItem(STORAGE_KEY, userId);

      // 3. Sign in with the new guestId
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
      await signIn("credentials", {
        guestId: savedGuestId,
        callbackUrl: "/",
      });
    } catch (err) {
      console.error("[GuestLoginButtons] restore guest error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {savedGuestId && (
        <Button
          variant="outline"
          onClick={handleRestoreGuest}
          disabled={isLoading}
          className="w-full h-[40px] rounded-[10px] border-[1.5px] border-border hover:border-border/80 transition-colors"
        >
          Continue as Guest
        </Button>
      )}
      <Button
        variant="ghost"
        onClick={handleNewGuest}
        disabled={isLoading}
        className="w-full text-muted-foreground hover:text-foreground"
      >
        Try as Guest
      </Button>
    </div>
  );
}
