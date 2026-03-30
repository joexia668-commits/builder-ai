/**
 * TDD tests for network disconnect/reconnect toast (Epic 4)
 *
 * Workspace should show toast when:
 * 1. Browser goes offline → toast.error("网络已断开")
 * 2. Browser comes back online → toast.success("网络已恢复")
 */

import React from "react";
import { render, act } from "@testing-library/react";

// Mock sonner toast
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
jest.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
  Toaster: () => null,
}));

// Mock next-auth
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

// Mock child components
jest.mock("@/components/sidebar/conversation-sidebar", () => ({
  ConversationSidebar: () => <div>Sidebar</div>,
}));
jest.mock("@/components/workspace/chat-area", () => ({
  ChatArea: () => <div>ChatArea</div>,
}));
jest.mock("@/components/preview/preview-panel", () => ({
  PreviewPanel: () => <div>PreviewPanel</div>,
}));

import { Workspace } from "@/components/workspace/workspace";

const project = {
  id: "p1",
  name: "Test",
  updatedAt: new Date(),
  messages: [],
  versions: [],
} as never;

describe("Network disconnect toast", () => {
  beforeEach(() => {
    mockToastError.mockClear();
    mockToastSuccess.mockClear();
  });

  it("shows error toast when browser goes offline", () => {
    render(<Workspace project={project} allProjects={[]} />);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/网络|断开|离线/));
  });

  it("shows success toast when browser comes back online", () => {
    render(<Workspace project={project} allProjects={[]} />);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringMatching(/网络|恢复|连接/));
  });
});
