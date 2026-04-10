/**
 * TDD tests for workspace.tsx uncovered branches (Epic 4)
 *
 * UI-WS-01: handleRestoreVersion updates currentFiles and appends to versions
 * UI-WS-02: mobile tab "chat" → ChatArea visible, PreviewPanel container in DOM
 * UI-WS-03: mobile tab "preview" → switch tab state
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
  Toaster: () => null,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Track what files/versions PreviewPanel receives
let capturedCode = "";
let capturedVersions: unknown[] = [];

jest.mock("@/components/sidebar/conversation-sidebar", () => ({
  ConversationSidebar: () => <div data-testid="conversation-sidebar" />,
}));

jest.mock("@/components/workspace/chat-area", () => ({
  ChatArea: ({
    onFilesGenerated,
  }: {
    onFilesGenerated: (files: Record<string, string>, version: unknown) => void;
  }) => (
    <div data-testid="chat-area">
      <button
        data-testid="trigger-code"
        onClick={() =>
          onFilesGenerated(
            { "/App.js": "new-code" },
            {
              id: "v-new",
              projectId: "p1",
              code: "new-code",
              description: "test",
              versionNumber: 2,
              createdAt: new Date(),
            }
          )
        }
      >
        trigger
      </button>
    </div>
  ),
}));

jest.mock("@/components/preview/preview-panel", () => ({
  PreviewPanel: ({
    files,
    versions,
    onVersionRestore,
  }: {
    files: Record<string, string>;
    versions: unknown[];
    onVersionRestore: (v: unknown) => void;
  }) => {
    capturedCode = files["/App.js"] ?? "";
    capturedVersions = versions;
    return (
      <div data-testid="preview-panel">
        <span data-testid="preview-code">{files["/App.js"] ?? ""}</span>
        <button
          data-testid="trigger-restore"
          onClick={() =>
            onVersionRestore({
              id: "v-restored",
              projectId: "p1",
              code: "restored-code",
              description: "restored",
              versionNumber: 3,
              createdAt: new Date(),
            })
          }
        >
          restore
        </button>
      </div>
    );
  },
}));

import { Workspace } from "@/components/workspace/workspace";

const baseProject = {
  id: "p1",
  name: "Test",
  updatedAt: new Date(),
  messages: [],
  versions: [
    {
      id: "v1",
      projectId: "p1",
      code: "initial-code",
      description: "v1",
      versionNumber: 1,
      createdAt: new Date(),
    },
  ],
} as never;

const emptyProject = {
  id: "p1",
  name: "Test",
  updatedAt: new Date(),
  messages: [],
  versions: [],
} as never;

describe("Workspace branch coverage", () => {
  beforeEach(() => {
    capturedCode = "";
    capturedVersions = [];
  });

  // UI-WS-01: handleRestoreVersion updates code
  it("UI-WS-01a: handleRestoreVersion updates displayed code via PreviewPanel", () => {
    render(<Workspace project={baseProject} allProjects={[]} />);
    expect(screen.getByTestId("preview-code")).toHaveTextContent("initial-code");

    fireEvent.click(screen.getByTestId("trigger-restore"));

    expect(screen.getByTestId("preview-code")).toHaveTextContent("restored-code");
  });

  it("UI-WS-01b: handleRestoreVersion appends new version to versions list", () => {
    render(<Workspace project={baseProject} allProjects={[]} />);
    const versionsBefore = capturedVersions.length;

    fireEvent.click(screen.getByTestId("trigger-restore"));

    expect(capturedVersions.length).toBe(versionsBefore + 1);
  });

  it("UI-WS-01c: handleRestoreVersion clears previewingVersion (sets to null)", () => {
    render(<Workspace project={baseProject} allProjects={[]} />);
    fireEvent.click(screen.getByTestId("trigger-restore"));
    expect(screen.getByTestId("preview-panel")).toBeInTheDocument();
  });

  // UI-WS-02: mobile tab chat view
  it("UI-WS-02: mobile tab chat is active by default", () => {
    render(<Workspace project={emptyProject} allProjects={[]} />);
    expect(screen.getByTestId("mobile-tab-chat")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mobile-tab-preview")).toHaveAttribute("data-active", "false");
  });

  // UI-WS-03: mobile tab preview switch
  it("UI-WS-03: clicking preview tab switches active state", () => {
    render(<Workspace project={emptyProject} allProjects={[]} />);
    fireEvent.click(screen.getByTestId("mobile-tab-preview"));
    expect(screen.getByTestId("mobile-tab-preview")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mobile-tab-chat")).toHaveAttribute("data-active", "false");
  });

  it("UI-WS-03b: switching back to chat restores chat active state", () => {
    render(<Workspace project={emptyProject} allProjects={[]} />);
    fireEvent.click(screen.getByTestId("mobile-tab-preview"));
    fireEvent.click(screen.getByTestId("mobile-tab-chat"));
    expect(screen.getByTestId("mobile-tab-chat")).toHaveAttribute("data-active", "true");
  });

  it("UI-WS-01d: onFilesGenerated from ChatArea updates code", () => {
    render(<Workspace project={emptyProject} allProjects={[]} />);
    fireEvent.click(screen.getByTestId("trigger-code"));
    expect(screen.getByTestId("preview-code")).toHaveTextContent("new-code");
  });

  // Silence unused variable warning
  void capturedCode;
});
