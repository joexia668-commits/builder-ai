"use client";

import { useEffect, useRef } from "react";
import type { SandpackRuntimeError } from "@/lib/types";

interface UseSandpackErrorOptions {
  readonly enabled: boolean;
  readonly onError: (error: SandpackRuntimeError) => void;
}

export function useSandpackError({ enabled, onError }: UseSandpackErrorOptions): void {
  const seenRef = useRef<Set<string>>(new Set());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (enabled) seenRef.current.clear();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.type !== "sandpack-runtime-error") return;

      const errorMessage = String(data.message ?? "Unknown error");
      const path = String(data.path ?? "/App.js");
      const line = Number(data.line ?? 0);
      const column = Number(data.column ?? 0);

      const key = `${path}:${errorMessage}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);

      console.log("[sandpack-error] runtime error detected:", { errorMessage, path, line, column });
      onErrorRef.current({ message: errorMessage, path, line, column });
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [enabled]);
}
