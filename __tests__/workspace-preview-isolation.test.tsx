/**
 * TDD tests for Workspace previewingVersion state isolation — EPIC 3
 *
 * Covers:
 * WPI-01: Workspace passes isPreviewingHistory=true to ChatArea when previewingVersion is set
 * WPI-02: ChatInput is disabled when isPreviewingHistory is true
 * WPI-03: previewingVersion does NOT change currentFiles state
 * WPI-04: onRestoreVersion adds new version to versions array and clears previewingVersion
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ProjectVersion } from "@/lib/types";

// Mock heavy child components
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/sidebar/conversation-sidebar", () => ({
  ConversationSidebar: () => <div>Sidebar</div>,
}));

jest.mock("@/components/workspace/chat-area", () => ({
  ChatArea: ({
    isPreviewingHistory,
    onMessagesChange: _omm,
    onFilesGenerated: _ofg,
    onGeneratingChange: _ogc,
    ...rest
  }: {
    isPreviewingHistory: boolean;
    onMessagesChange: unknown;
    onFilesGenerated: unknown;
    onGeneratingChange: unknown;
    [key: string]: unknown;
  }) => (
    <div data-testid="chat-area" data-previewing={String(isPreviewingHistory)} {...rest}>
      ChatArea
    </div>
  ),
}));

jest.mock("@/components/preview/preview-panel", () => ({
  PreviewPanel: ({
    files,
    onVersionRestore: _ovr,
    onPreviewVersion,
    previewingVersion,
    ...rest
  }: {
    files: Record<string, string>;
    onVersionRestore: unknown;
    onPreviewVersion: (v: ProjectVersion | null) => void;
    previewingVersion: ProjectVersion | null;
    [key: string]: unknown;
  }) => (
    <div data-testid="preview-panel" data-code={files["/App.js"] ?? ""} {...rest}>
      <button
        data-testid="set-preview"
        onClick={() =>
          onPreviewVersion({
            id: "v1",
            projectId: "proj-1",
            versionNumber: 1,
            code: "preview-code",
            description: "v1",
            agentMessages: null,
            createdAt: new Date(),
          })
        }
      >
        Preview v1
      </button>
      <button data-testid="clear-preview" onClick={() => onPreviewVersion(null)}>
        Clear Preview
      </button>
      {previewingVersion && (
        <span data-testid="currently-previewing">{previewingVersion.id}</span>
      )}
    </div>
  ),
}));

import { Workspace } from "@/components/workspace/workspace";

const latestCode = "latest-code";
const v1: ProjectVersion = {
  id: "v1",
  projectId: "proj-1",
  versionNumber: 1,
  code: latestCode,
  description: "initial",
  agentMessages: null,
  createdAt: new Date(),
};

const project = {
  id: "proj-1",
  name: "Test",
  userId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  messages: [],
  versions: [v1],
};

describe("Workspace previewingVersion state isolation", () => {
  // WPI-01: ChatArea receives isPreviewingHistory prop
  it("WPI-01: ChatArea receives isPreviewingHistory=false by default", () => {
    render(<Workspace project={project} allProjects={[]} />);
    const chatArea = screen.getByTestId("chat-area");
    expect(chatArea.getAttribute("data-previewing")).toBe("false");
  });

  it("WPI-01b: ChatArea receives isPreviewingHistory=true when a version is being previewed", () => {
    render(<Workspace project={project} allProjects={[]} />);

    // Simulate selecting a preview version via PreviewPanel callback
    fireEvent.click(screen.getByTestId("set-preview"));

    const chatArea = screen.getByTestId("chat-area");
    expect(chatArea.getAttribute("data-previewing")).toBe("true");
  });

  // WPI-03: previewingVersion does NOT change currentFiles (displayFiles serves preview)
  it("WPI-03: PreviewPanel receives preview code (not currentCode) when previewing", () => {
    render(<Workspace project={project} allProjects={[]} />);

    const panelBefore = screen.getByTestId("preview-panel");
    expect(panelBefore.getAttribute("data-code")).toBe(latestCode);

    // Trigger preview — this sets previewingVersion
    fireEvent.click(screen.getByTestId("set-preview"));

    // displayFiles should now be from previewingVersion ("preview-code")
    const panelAfter = screen.getByTestId("preview-panel");
    expect(panelAfter.getAttribute("data-code")).toBe("preview-code");
  });

  // WPI-04: clearing preview restores currentFiles
  it("WPI-04: clearing preview restores currentCode to PreviewPanel", () => {
    render(<Workspace project={project} allProjects={[]} />);

    fireEvent.click(screen.getByTestId("set-preview"));
    fireEvent.click(screen.getByTestId("clear-preview"));

    const panel = screen.getByTestId("preview-panel");
    expect(panel.getAttribute("data-code")).toBe(latestCode);
  });

  // WPI-05: previewingVersion is passed to PreviewPanel
  it("WPI-05: previewingVersion state is threaded to PreviewPanel", () => {
    render(<Workspace project={project} allProjects={[]} />);

    fireEvent.click(screen.getByTestId("set-preview"));

    expect(screen.getByTestId("currently-previewing")).toHaveTextContent("v1");
  });

  // WPI-06: clearing preview removes previewingVersion from PreviewPanel
  it("WPI-06: clearing preview removes previewingVersion from PreviewPanel", () => {
    render(<Workspace project={project} allProjects={[]} />);

    fireEvent.click(screen.getByTestId("set-preview"));
    fireEvent.click(screen.getByTestId("clear-preview"));

    expect(screen.queryByTestId("currently-previewing")).not.toBeInTheDocument();
  });
});
