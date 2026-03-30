/**
 * TDD tests for ChatArea error state + retry button (Epic 4)
 *
 * When AI generation fails, ChatArea should:
 * 1. Show a user-friendly error message
 * 2. Show a "重试" (retry) button
 * 3. Clear error and retry on button click
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

window.HTMLElement.prototype.scrollIntoView = jest.fn();
global.fetch = jest.fn();

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
jest.mock("@/components/workspace/chat-input", () => ({
  ChatInput: ({
    onSubmit,
    disabled,
    onStop,
  }: {
    onSubmit: (v: string) => void;
    disabled: boolean;
    onStop?: () => void;
  }) => (
    <div>
      <button
        data-testid="submit-btn"
        disabled={disabled}
        onClick={() => onSubmit("build a todo app")}
      >
        Submit
      </button>
      {onStop && (
        <button data-testid="stop-btn" onClick={onStop}>
          停止生成
        </button>
      )}
    </div>
  ),
}));

import { ChatArea } from "@/components/workspace/chat-area";

const project = { id: "proj-1", name: "Test", updatedAt: new Date() } as never;

describe("ChatArea error state", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it("shows error message when generation fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onCodeGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(screen.getAllByText(/生成失败|出错了|重试/i).length).toBeGreaterThan(0);
    });
  });

  it("shows retry button when generation fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onCodeGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("retry-btn")).toBeInTheDocument();
    });
  });

  it("clears error and re-enables input after error", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onCodeGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      // After error, submit button should be enabled (not generating)
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled();
    });
  });

  it("retries generation on retry button click", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onCodeGenerated={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("retry-btn")).toBeInTheDocument();
    });

    const callCountBefore = (global.fetch as jest.Mock).mock.calls.length;
    fireEvent.click(screen.getByTestId("retry-btn"));

    await waitFor(() => {
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(callCountBefore);
    });
  });
});
