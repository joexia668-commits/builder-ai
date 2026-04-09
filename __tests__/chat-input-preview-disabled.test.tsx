/**
 * TDD tests for ChatArea isPreviewingHistory prop — EPIC 3
 *
 * Covers:
 * CIP-01: ChatInput disabled when isPreviewingHistory=true
 * CIP-02: ChatInput enabled when isPreviewingHistory=false and not generating
 * CIP-03: Placeholder text shows preview hint when isPreviewingHistory=true
 */

import React from "react";
import { render, screen } from "@testing-library/react";

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

// Use real ChatInput to verify disabled state is correctly passed
import { ChatArea } from "@/components/workspace/chat-area";

const project = { id: "proj-1", name: "Test", updatedAt: new Date() } as never;

describe("ChatArea isPreviewingHistory → ChatInput disabled", () => {
  // CIP-01: ChatInput disabled when isPreviewingHistory=true
  it("CIP-01: ChatInput textarea is disabled when isPreviewingHistory=true", () => {
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        isPreviewingHistory={true}
      />
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeDisabled();
  });

  // CIP-02: ChatInput enabled when isPreviewingHistory=false
  it("CIP-02: ChatInput textarea is enabled when isPreviewingHistory=false", () => {
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        isPreviewingHistory={false}
      />
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).not.toBeDisabled();
  });

  // CIP-03: Placeholder communicates preview mode to user
  it("CIP-03: placeholder text indicates preview mode when isPreviewingHistory=true", () => {
    render(
      <ChatArea
        project={project}
        messages={[]}
        onMessagesChange={jest.fn()}
        onFilesGenerated={jest.fn()}
        isPreviewingHistory={true}
      />
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("placeholder", expect.stringMatching(/预览|历史/));
  });
});
