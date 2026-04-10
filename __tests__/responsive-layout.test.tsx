/**
 * TDD tests for responsive workspace layout (Epic 4)
 *
 * Desktop (>1024): 3-column layout
 * Tablet (768-1024): sidebar icon-only, compact agent bar
 * Mobile (<768): single column with Chat/Preview tab switcher
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

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
jest.mock("@/components/sidebar/conversation-sidebar", () => ({
  ConversationSidebar: () => <div data-testid="conversation-sidebar">Sidebar</div>,
}));
jest.mock("@/components/workspace/chat-area", () => ({
  ChatArea: () => <div data-testid="chat-area">ChatArea</div>,
}));
jest.mock("@/components/preview/preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel">PreviewPanel</div>,
}));

import { Workspace } from "@/components/workspace/workspace";

const project = {
  id: "p1",
  name: "Test",
  updatedAt: new Date(),
  messages: [],
  versions: [],
} as never;

describe("Responsive workspace layout", () => {
  it("renders all three panels", () => {
    render(<Workspace project={project} allProjects={[]} />);
    expect(screen.getByTestId("conversation-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    expect(screen.getByTestId("preview-panel")).toBeInTheDocument();
  });

  it("shows mobile tab switcher with 对话 and 预览 tabs", () => {
    render(<Workspace project={project} allProjects={[]} />);
    // Mobile tab bar should exist in DOM (hidden on larger screens via CSS)
    expect(screen.getByTestId("mobile-tab-chat")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-tab-preview")).toBeInTheDocument();
  });

  it("mobile tab defaults to chat view", () => {
    render(<Workspace project={project} allProjects={[]} />);
    const chatTab = screen.getByTestId("mobile-tab-chat");
    // Chat tab should be the active/selected tab by default
    expect(chatTab).toHaveAttribute("data-active", "true");
  });

  it("switches to preview on mobile tab click", () => {
    render(<Workspace project={project} allProjects={[]} />);
    const previewTab = screen.getByTestId("mobile-tab-preview");
    fireEvent.click(previewTab);
    expect(previewTab).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("mobile-tab-chat")).toHaveAttribute("data-active", "false");
  });
});
