/**
 * TDD tests for isGenerating state lift (Epic 2)
 *
 * ChatArea must accept onGeneratingChange callback and call it
 * when generation starts/ends so Workspace can pass isGenerating to PreviewPanel.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// Mock fetch for SSE streaming
global.fetch = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

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
  ChatInput: ({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) => (
    <button data-testid="submit-btn" disabled={disabled} onClick={() => onSubmit("build a todo app")}>
      Submit
    </button>
  ),
}));

import { ChatArea } from "@/components/workspace/chat-area";

const project = { id: "proj-1", name: "Test", updatedAt: new Date() } as never;

describe("ChatArea onGeneratingChange", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it("accepts onGeneratingChange prop without crashing", () => {
    const onGeneratingChange = jest.fn();
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        onGeneratingChange={onGeneratingChange}
      />
    );
    expect(screen.getByTestId("submit-btn")).toBeInTheDocument();
  });

  it("calls onGeneratingChange(true) when generation starts", async () => {
    const onGeneratingChange = jest.fn();

    const mockReader = {
      read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      body: { getReader: () => mockReader },
    });

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        onGeneratingChange={onGeneratingChange}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(onGeneratingChange).toHaveBeenCalledWith(true);
    });
  });

  // WG-03: onGeneratingChange(false) called after all agents complete
  it("WG-03: calls onGeneratingChange(false) after all agents complete", async () => {
    const onGeneratingChange = jest.fn();

    // All 3 agent SSE streams end immediately
    const mockReader = {
      read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      body: { getReader: () => mockReader },
    });

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        onGeneratingChange={onGeneratingChange}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(onGeneratingChange).toHaveBeenCalledWith(false);
    });

    // Verify ordering: true before false
    const calls = onGeneratingChange.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe(true);
    expect(calls[calls.length - 1]).toBe(false);
  });

  // WG-04: onGeneratingChange(false) called even when fetch throws
  it("WG-04: calls onGeneratingChange(false) even when generation errors", async () => {
    const onGeneratingChange = jest.fn();

    // Simulate network failure on first agent call
    (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        onGeneratingChange={onGeneratingChange}
      />
    );

    fireEvent.click(screen.getByTestId("submit-btn"));

    await waitFor(() => {
      expect(onGeneratingChange).toHaveBeenCalledWith(false);
    });
  });
});
