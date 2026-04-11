"use client";

import { useCallback } from "react";
import { useSyncExternalStore } from "react";
import {
  getSession,
  subscribe,
  EMPTY_SESSION,
  type GenerationSession,
} from "@/lib/generation-session";

export function useGenerationSession(projectId: string): GenerationSession {
  const stableSubscribe = useCallback(
    (listener: () => void) => subscribe(projectId, listener),
    [projectId],
  );
  return useSyncExternalStore(
    stableSubscribe,
    () => getSession(projectId),
    () => EMPTY_SESSION,
  );
}
