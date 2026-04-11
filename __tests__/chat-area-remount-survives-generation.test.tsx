import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { ChatArea } from "@/components/workspace/chat-area";
import { resetSession, updateSession } from "@/lib/generation-session";

window.HTMLElement.prototype.scrollIntoView = jest.fn();

const PROJECT_ID = "remount-test";

const project = {
  id: PROJECT_ID,
  name: "Test",
  userId: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

beforeEach(() => resetSession(PROJECT_ID));
afterEach(() => resetSession(PROJECT_ID));

jest.mock("@/lib/model-registry", () => ({
  DEFAULT_MODEL_ID: "gemini-2.0-flash",
  getAvailableModels: () => [{ id: "gemini-2.0-flash" }],
}));

jest.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));

jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ id: "v1", code: "code", projectId: "remount-test" }),
  }),
}));

jest.mock("@/components/agent/agent-status-bar", () => ({
  AgentStatusBar: ({
    engineerProgress,
  }: {
    engineerProgress: { currentLayer: number; totalLayers: number } | null;
  }) =>
    engineerProgress ? (
      <div data-testid="engineer-progress">
        第 {engineerProgress.currentLayer}/{engineerProgress.totalLayers} 层
      </div>
    ) : (
      <div data-testid="agent-status-bar" />
    ),
}));

jest.mock("@/components/agent/agent-message", () => ({
  AgentMessage: () => <div data-testid="agent-message" />,
}));

jest.mock("@/components/workspace/chat-input", () => ({
  ChatInput: ({ disabled }: { disabled: boolean }) => (
    <button data-testid="submit-btn" disabled={disabled}>
      Submit
    </button>
  ),
}));

describe("ChatArea remount resilience", () => {
  it("shows engineer progress after ChatArea remounts mid-generation", async () => {
    const onFilesGenerated = jest.fn();
    const { unmount } = render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={onFilesGenerated}
      />
    );

    // Simulate engineer progress being stored in session (as if generation started)
    act(() => {
      updateSession(PROJECT_ID, {
        isGenerating: true,
        engineerProgress: {
          totalLayers: 3,
          currentLayer: 1,
          totalFiles: 6,
          currentFiles: ["App.tsx"],
          completedFiles: [],
          failedFiles: [],
          retryInfo: null,
        },
        agentStates: {
          pm: { role: "pm", status: "done", output: "PRD" },
          architect: { role: "architect", status: "done", output: "Arch" },
          engineer: { role: "engineer", status: "streaming", output: "generating..." },
        },
      });
    });

    // Remount ChatArea (unmount + new render to simulate React strict mode or navigation)
    unmount();
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={onFilesGenerated}
      />
    );

    // Progress should still be visible
    await waitFor(() => {
      expect(screen.getByText(/第 1\//i)).toBeInTheDocument();
    });
  });
});
