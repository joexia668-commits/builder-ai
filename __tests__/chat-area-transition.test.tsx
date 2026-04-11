/**
 * TDD tests for agent handoff transition text lifetime (Fix 2)
 *
 * Bug:  setTransitionText(null) called inside handoff block after 800ms delay
 *       → text disappears after exactly 800ms, E2E Playwright misses window
 *
 * Fix:  Move setTransitionText(null) to after next agent's fetch resolves
 *       (i.e., when next agent starts streaming), so text stays visible during
 *       the full network wait — not just 800ms.
 *
 * Key assertion: after 800ms delay + 1000ms extra wait, text is STILL in DOM
 *               while the next agent's fetch is held (not yet resolved).
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = jest.fn();

jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ id: "v1", code: "<h1>hi</h1>", projectId: "p1" }),
  }),
}));

jest.mock("@/components/agent/agent-status-bar", () => ({
  AgentStatusBar: () => <div data-testid="agent-status-bar" />,
}));

jest.mock("@/components/agent/agent-message", () => ({
  AgentMessage: () => <div data-testid="agent-message" />,
}));

jest.mock("@/components/workspace/chat-input", () => ({
  ChatInput: ({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) => (
    <button
      data-testid="submit-btn"
      disabled={disabled}
      onClick={() => onSubmit("build a todo app")}
    >
      Submit
    </button>
  ),
}));

import { ChatArea } from "@/components/workspace/chat-area";
import { resetSession } from "@/lib/generation-session";

const project = { id: "proj-1", name: "Test", updatedAt: new Date() } as never;

function makeSseResponse(content: string): Response {
  const sseData =
    `data: ${JSON.stringify({ type: "chunk", content })}\n\n` +
    `data: [DONE]\n\n`;
  // Buffer is always available in Node.js and is a Uint8Array subclass —
  // avoids needing TextEncoder polyfill in jsdom test environment
  const encoded = Buffer.from(sseData) as unknown as Uint8Array;

  let readCount = 0;
  const mockReader = {
    read: jest.fn().mockImplementation(() => {
      readCount++;
      if (readCount === 1) return Promise.resolve({ done: false, value: encoded });
      return Promise.resolve({ done: true, value: undefined });
    }),
    cancel: jest.fn(),
    releaseLock: jest.fn(),
  };

  return {
    body: { getReader: () => mockReader },
    status: 200,
    ok: true,
  } as unknown as Response;
}

describe("agent handoff transition text lifetime", () => {
  // TextDecoder is not provided by jsdom in this project's test environment.
  // Polyfill here (not in jest.setup.ts) so only this file is affected —
  // other tests that rely on TextDecoder being absent still work as expected.
  beforeAll(() => {
    if (typeof (global as Record<string, unknown>).TextDecoder === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (global as Record<string, unknown>).TextDecoder = require("util").TextDecoder;
    }
  });

  beforeEach(() => {
    resetSession("proj-1");
  });

  it("PM 移交文案在 800ms 延迟结束后仍然可见（arch fetch 未完成时）", async () => {
    // Arch fetch never resolves — simulates slow network / Gemini latency
    const archHeld = new Promise<Response>(() => { /* intentionally never resolves */ });

    let callCount = 0;
    (global.fetch as jest.Mock) = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeSseResponse("pm 需求文档内容"));
      return archHeld;
    });

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    // PM completes quickly; transition text should appear within 3s
    await waitFor(
      () => {
        expect(
          screen.queryByText("PM 已将需求文档移交给架构师...")
        ).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Wait 1000ms beyond the 800ms handoff delay
    // OLD (bug): text cleared at 800ms → NOT in DOM here
    // NEW (fix): text stays until arch fetch resolves → STILL in DOM here
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });

    expect(
      screen.queryByText("PM 已将需求文档移交给架构师...")
    ).toBeInTheDocument();
  }, 6000);

  it("Arch 移交文案在 800ms 延迟结束后仍然可见（engineer fetch 未完成时）", async () => {
    // Engineer fetch never resolves
    const engineerHeld = new Promise<Response>(() => { /* intentionally never resolves */ });

    let callCount = 0;
    (global.fetch as jest.Mock) = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeSseResponse("pm output"));
      if (callCount === 2) return Promise.resolve(makeSseResponse("arch output"));
      return engineerHeld;
    });

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    // Arch completes after PM's 800ms delay + Arch processing; wait up to 6s
    await waitFor(
      () => {
        expect(
          screen.queryByText("架构师已将技术方案移交给工程师...")
        ).toBeInTheDocument();
      },
      { timeout: 6000 }
    );

    // Text should persist beyond the 800ms delay while engineer is pending
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });

    expect(
      screen.queryByText("架构师已将技术方案移交给工程师...")
    ).toBeInTheDocument();
  }, 12000);
});
