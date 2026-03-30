/**
 * TDD tests for ProjectList delete functionality (EPIC 6)
 *
 * PLD-01: each project card has a delete trigger (DropdownMenu button)
 * PLD-02: successful delete removes card from list (optimistic update)
 * PLD-03: failed delete shows toast.error and card remains in list
 * PLD-04: delete calls fetchAPI with DELETE method and correct path
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
const mockToastSuccess = jest.fn();
jest.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mockToastSuccess(...a),
    error: (...a: unknown[]) => mockToastError(...a),
  },
}));

import { ProjectList } from "@/components/home/project-list";

const makeProject = (id: string, name: string) => ({
  id,
  name,
  description: null,
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  _count: { versions: 1, messages: 0 },
  messages: [],
});

describe("ProjectList — delete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function openDeleteDialog(name: string) {
    // Find the card wrapper that contains the project name
    const cards = screen.getAllByTestId("project-card");
    const card = cards.find((c) => c.textContent?.includes(name));
    const trigger = card?.querySelector("[aria-label='项目操作']") as HTMLElement;
    fireEvent.click(trigger!);
    fireEvent.click(screen.getByText("删除项目"));
  }

  // PLD-01: dropdown trigger visible per card
  it("PLD-01: each project card has a dropdown trigger", () => {
    render(
      <ProjectList
        projects={[makeProject("p1", "App One"), makeProject("p2", "App Two")]}
      />
    );
    const triggers = screen.getAllByLabelText("项目操作");
    expect(triggers).toHaveLength(2);
  });

  // PLD-02: successful delete removes card
  it("PLD-02: successful delete removes the card from list", async () => {
    mockFetchAPI.mockResolvedValue({ ok: true });

    render(
      <ProjectList
        projects={[makeProject("p1", "App One"), makeProject("p2", "App Two")]}
      />
    );

    openDeleteDialog("App One");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("App One")).not.toBeInTheDocument();
    });
    expect(screen.getByText("App Two")).toBeInTheDocument();
  });

  // PLD-03: failed delete shows toast.error and list unchanged
  it("PLD-03: failed delete shows error toast and keeps card in list", async () => {
    mockFetchAPI.mockRejectedValue(new Error("Server error"));

    render(<ProjectList projects={[makeProject("p1", "App One")]} />);

    openDeleteDialog("App One");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("删除失败，请重试");
    });
    expect(screen.getByText("App One")).toBeInTheDocument();
  });

  // PLD-04: correct API call
  it("PLD-04: calls fetchAPI DELETE /api/projects/:id", async () => {
    mockFetchAPI.mockResolvedValue({ ok: true });

    render(<ProjectList projects={[makeProject("proj-abc", "My App")]} />);

    openDeleteDialog("My App");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    await waitFor(() => {
      expect(mockFetchAPI).toHaveBeenCalledWith("/api/projects/proj-abc", {
        method: "DELETE",
      });
    });
  });
});
