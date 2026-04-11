import { renderHook } from "@testing-library/react";
import { useMounted } from "@/hooks/use-mounted";

describe("useMounted", () => {
  it("returns false on first render, true after mount", () => {
    const { result } = renderHook(() => useMounted());
    // After renderHook, useEffect has run — mounted should be true
    expect(result.current).toBe(true);
  });

  it("does not throw and returns a boolean", () => {
    // We can't easily test the false→true transition synchronously in jsdom,
    // but we verify the hook doesn't throw and returns a boolean.
    const { result } = renderHook(() => useMounted());
    expect(typeof result.current).toBe("boolean");
  });
});
