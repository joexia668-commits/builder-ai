import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatArea } from "@/components/workspace/chat-area";
import { updateSession, resetSession } from "@/lib/generation-session";

window.HTMLElement.prototype.scrollIntoView = jest.fn();

const PID = "stall-test";
const project = {
  id: PID,
  name: "Test",
  userId: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

beforeEach(() => resetSession(PID));
afterEach(() => resetSession(PID));

jest.mock("@/lib/model-registry", () => ({
  DEFAULT_MODEL_ID: "gemini-2.0-flash",
  getAvailableModels: () => [{ id: "gemini-2.0-flash" }],
}));

jest.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));

jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ id: "v1", code: "code", projectId: "stall-test" }),
  }),
  readSSEBody: jest.fn().mockResolvedValue(undefined),
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
    isGenerating,
    onStop,
  }: {
    onSubmit: (v: string) => void;
    disabled: boolean;
    isGenerating?: boolean;
    onStop?: () => void;
  }) => (
    <div>
      <button
        data-testid="submit-btn"
        disabled={disabled}
        onClick={() => onSubmit("test prompt")}
      >
        Submit
      </button>
      {isGenerating && onStop && (
        <button data-testid="stop-btn" onClick={onStop}>
          停止
        </button>
      )}
    </div>
  ),
}));

describe("stall warning UI", () => {
  it("shows stall warning when stallWarning is true in session", async () => {
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    updateSession(PID, { isGenerating: true, stallWarning: true });

    await waitFor(() => {
      expect(screen.getByTestId("stall-warning")).toBeInTheDocument();
    });
  });

  it("中断重试 button calls abortSession and hides warning", async () => {
    const user = userEvent.setup();
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
      />
    );

    updateSession(PID, { isGenerating: true, stallWarning: true, lastPrompt: "rebuild" });

    await waitFor(() => screen.getByTestId("stall-warning"));

    const btn = screen.getByRole("button", { name: /中断重试/ });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.queryByTestId("stall-warning")).not.toBeInTheDocument();
    });
  });
});
