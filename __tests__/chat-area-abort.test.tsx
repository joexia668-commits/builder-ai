/**
 * TDD tests for stop generation with AbortController (Epic 4)
 *
 * When generating, user can stop:
 * 1. ChatInput receives onStop callback
 * 2. Calling onStop aborts the fetch
 * 3. All agent states reset to idle
 * 4. isGenerating becomes false (input re-enabled)
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = jest.fn();

jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ id: "v1", code: "code", projectId: "p1" }),
  }),
}));

jest.mock("@/components/agent/agent-status-bar", () => ({
  AgentStatusBar: () => <div>AgentStatusBar</div>,
}));
jest.mock("@/components/agent/agent-message", () => ({
  AgentMessage: () => <div>AgentMessage</div>,
}));

// ChatInput mock that exposes onStop
let capturedOnStop: (() => void) | undefined;
jest.mock("@/components/workspace/chat-input", () => ({
  ChatInput: ({
    onSubmit,
    disabled,
    onStop,
    isGenerating,
  }: {
    onSubmit: (v: string) => void;
    disabled: boolean;
    onStop?: () => void;
    isGenerating?: boolean;
  }) => {
    capturedOnStop = onStop;
    return (
      <div>
        <button
          data-testid="submit-btn"
          disabled={disabled}
          onClick={() => onSubmit("build a todo app")}
        >
          Submit
        </button>
        {isGenerating && onStop && (
          <button data-testid="stop-btn" onClick={onStop}>
            停止生成
          </button>
        )}
      </div>
    );
  },
}));

import { ChatArea } from "@/components/workspace/chat-area";

const project = { id: "proj-1", name: "Test", updatedAt: new Date() } as never;

describe("ChatArea stop generation", () => {
  beforeEach(() => {
    capturedOnStop = undefined;
  });

  it("passes onStop to ChatInput", async () => {
    // slow stream — never resolves naturally
    (global.fetch as jest.Mock) = jest.fn().mockReturnValue(
      new Promise(() => {}) // never resolves
    );

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(capturedOnStop).toBeDefined();
    });
  });

  it("shows stop button during generation", async () => {
    (global.fetch as jest.Mock) = jest.fn().mockReturnValue(
      new Promise(() => {}) // never resolves
    );

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("stop-btn")).toBeInTheDocument();
    });
  });

  it("resets isGenerating to false after stop", async () => {
    let rejectFetch!: (reason?: Error) => void;
    (global.fetch as jest.Mock) = jest.fn().mockReturnValue(
      new Promise<never>((_, reject) => {
        rejectFetch = reject;
      })
    );

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("stop-btn")).toBeInTheDocument();
    });

    // Trigger stop
    await act(async () => {
      fireEvent.click(screen.getByTestId("stop-btn"));
      rejectFetch(new DOMException("AbortError", "AbortError"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled();
    });
  });
});
