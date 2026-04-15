"use client";

import { useEffect, useRef } from "react";
import { useSandpack } from "@codesandbox/sandpack-react";
import type { SandpackRuntimeError } from "@/lib/types";

interface UseSandpackErrorOptions {
  readonly enabled: boolean;
  readonly onError: (error: SandpackRuntimeError) => void;
}

export function useSandpackError({ enabled, onError }: UseSandpackErrorOptions): void {
  const seenRef = useRef<Set<string>>(new Set());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Reset dedup set when re-enabled (new fix round)
  useEffect(() => {
    if (enabled) seenRef.current.clear();
  }, [enabled]);

  const { listen } = useSandpack();

  useEffect(() => {
    if (!enabled) return;

    const unsub = listen((message) => {
      if (
        message.type === "action" &&
        (message as unknown as Record<string, unknown>).action === "show-error"
      ) {
        const msg = message as unknown as Record<string, unknown>;
        const errorMessage = String(msg.message ?? msg.title ?? "Unknown error");
        const path = String(msg.path ?? "/App.js");
        const line = Number(msg.line ?? 0);
        const column = Number(msg.column ?? 0);

        const key = `${path}:${errorMessage}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);

        onErrorRef.current({ message: errorMessage, path, line, column });
      }
    });

    return unsub;
  }, [enabled, listen]);
}
