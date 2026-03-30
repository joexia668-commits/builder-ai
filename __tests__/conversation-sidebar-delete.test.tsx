/**
 * TDD tests for ConversationSidebar delete functionality (EPIC 6)
 *
 * CSD-01: each project item has a delete button
 * CSD-02: successful delete removes item from sidebar list
 * CSD-03: deleting current project navigates to /
 * CSD-04: failed delete shows toast.error and item remains
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockFetchAPI = jest.fn();
jest.mock("@/lib/api-client", () => ({
  fetchAPI: (...args: unknown[]) => mockFetchAPI(...args),
}));

const mockToastError = jest.fn();
jest.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a) },
}));

import { ConversationSidebar } from "@/components/sidebar/conversation-sidebar";

const projects = [
  { id: "p1", name: "Alpha", updatedAt: new Date("2024-01-10") },
  { id: "p2", name: "Beta", updatedAt: new Date("2024-01-11") },
];

describe("ConversationSidebar — delete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function openDeleteDialog(name: string) {
    const cards = screen.getAllByTestId("project-item");
    const card = cards.find((c) => c.textContent?.includes(name));
    const btn = card?.querySelector("[aria-label^='删除']") as HTMLElement;
    fireEvent.click(btn!);
    // wait for React to render the dialog
    await waitFor(() => screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
  }

  // CSD-01: delete buttons present
  it("CSD-01: each project item has a delete button", () => {
    render(<ConversationSidebar currentProjectId="p1" projects={projects} />);
    const deleteBtns = screen.getAllByRole("button", { name: /^删除/ });
    expect(deleteBtns).toHaveLength(2);
  });

  // CSD-02: successful delete removes item
  it("CSD-02: successful delete removes item from list", async () => {
    mockFetchAPI.mockResolvedValue({ ok: true });
    render(<ConversationSidebar currentProjectId="p1" projects={projects} />);

    await openDeleteDialog("Alpha");

    await waitFor(() => {
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  // CSD-03: deleting current project navigates home
  it("CSD-03: deleting current project navigates to /", async () => {
    mockFetchAPI.mockResolvedValue({ ok: true });
    render(<ConversationSidebar currentProjectId="p1" projects={projects} />);

    await openDeleteDialog("Alpha");

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  // CSD-04: failed delete shows error toast, item remains
  it("CSD-04: failed delete shows error toast and keeps item", async () => {
    mockFetchAPI.mockRejectedValue(new Error("fail"));
    render(<ConversationSidebar currentProjectId="p1" projects={projects} />);

    // open and click confirm
    const cards = screen.getAllByTestId("project-item");
    const card = cards.find((c) => c.textContent?.includes("Alpha"));
    const btn = card?.querySelector("[aria-label^='删除']") as HTMLElement;
    fireEvent.click(btn!);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("删除失败，请重试");
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
