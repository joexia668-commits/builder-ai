import { renderHook, act } from "@testing-library/react";
import { useGenerationSession } from "@/hooks/use-generation-session";
import { updateSession, resetSession } from "@/lib/generation-session";

const PID = "hook-test-project";

beforeEach(() => resetSession(PID));

describe("useGenerationSession", () => {
  it("returns current session state", () => {
    const { result } = renderHook(() => useGenerationSession(PID));
    expect(result.current.isGenerating).toBe(false);
  });

  it("re-renders when session updates", () => {
    const { result } = renderHook(() => useGenerationSession(PID));
    act(() => {
      updateSession(PID, { isGenerating: true });
    });
    expect(result.current.isGenerating).toBe(true);
  });
});
