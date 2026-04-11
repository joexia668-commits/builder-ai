"use client";

import { useState, useEffect } from "react";

/**
 * Returns false on the first server-side (or hydration) render, true after
 * the component has mounted client-side. Use this to defer time- or locale-
 * dependent rendering so that SSR output matches client hydration output.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
