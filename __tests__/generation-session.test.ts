import {
  getSession,
  updateSession,
  subscribe,
  abortSession,
  resetSession,
  EMPTY_SESSION,
} from "@/lib/generation-session";

const P1 = "project-1";
const P2 = "project-2";

beforeEach(() => {
  resetSession(P1);
  resetSession(P2);
});

describe("getSession", () => {
  it("returns default session for unknown project", () => {
    const s = getSession(P1);
    expect(s.isGenerating).toBe(false);
    expect(s.agentStates.pm.status).toBe("idle");
    expect(s.engineerProgress).toBeNull();
  });
});

describe("updateSession", () => {
  it("merges patch into session", () => {
    updateSession(P1, { isGenerating: true, lastPrompt: "hello" });
    expect(getSession(P1).isGenerating).toBe(true);
    expect(getSession(P1).lastPrompt).toBe("hello");
  });

  it("does not affect other projects", () => {
    updateSession(P1, { isGenerating: true });
    expect(getSession(P2).isGenerating).toBe(false);
  });
});

describe("subscribe", () => {
  it("calls listener when session updates", () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(P1, listener);
    updateSession(P1, { isGenerating: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    updateSession(P1, { isGenerating: false });
    expect(listener).toHaveBeenCalledTimes(1); // not called after unsubscribe
  });

  it("does not call listener for other project updates", () => {
    const listener = jest.fn();
    subscribe(P1, listener);
    updateSession(P2, { isGenerating: true });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("abortSession", () => {
  it("calls abort on the stored AbortController", () => {
    const controller = new AbortController();
    updateSession(P1, { abortController: controller });
    abortSession(P1);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("resetSession", () => {
  it("returns session to idle defaults", () => {
    updateSession(P1, { isGenerating: true, lastPrompt: "test" });
    resetSession(P1);
    const s = getSession(P1);
    expect(s.isGenerating).toBe(false);
    expect(s.lastPrompt).toBe("");
  });
});
