/**
 * TDD unit tests for ProjectList component (Epic 4)
 *
 * UI-PL-01: projects=[] shows empty state CTA
 * UI-PL-02: projects>0 renders card grid
 * UI-PL-03: card displays name, description, version count, timestamp
 * UI-PL-04: new project button opens Dialog
 * UI-PL-05: successful create shows toast and navigates
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock fetchAPI
const mockFetchAPI = jest.fn();
jest.mock("@/lib/api-client", () => ({
  fetchAPI: (...args: unknown[]) => mockFetchAPI(...args),
}));

// Mock sonner toast
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => mockToastSuccess(...a), error: (...a: unknown[]) => mockToastError(...a) },
}));

import { ProjectList } from "@/components/home/project-list";

const makeProject = (overrides = {}): import("@/components/home/project-list").ProjectWithMeta => ({
  id: "proj-1",
  name: "My App",
  description: "A test project",
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  _count: { versions: 3, messages: 10 },
  messages: [{ content: "Build me a todo", role: "user" }],
  ...overrides,
});

// Export type for test helper
declare module "@/components/home/project-list" {
  interface ProjectWithMeta {
    id: string;
    name: string;
    description: string | null;
    updatedAt: Date;
    _count: { versions: number; messages: number };
    messages: { content: string; role: string }[];
  }
}

describe("ProjectList", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockFetchAPI.mockClear();
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
  });

  // UI-PL-01: empty state
  it("UI-PL-01: shows empty state CTA when no projects", () => {
    render(<ProjectList projects={[]} />);
    expect(screen.getAllByText(/第一个/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("UI-PL-01b: empty state includes a create button that opens dialog", () => {
    render(<ProjectList projects={[]} />);
    // The "创建第一个项目" or "+ 新建项目" button
    const createBtn = screen.getAllByRole("button")[0];
    fireEvent.click(createBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // UI-PL-02: card grid
  it("UI-PL-02: renders card links when projects exist", () => {
    render(<ProjectList projects={[makeProject(), makeProject({ id: "proj-2", name: "Second App" })]} />);
    expect(screen.getByText("My App")).toBeInTheDocument();
    expect(screen.getByText("Second App")).toBeInTheDocument();
  });

  it("UI-PL-02b: each card links to /project/:id", () => {
    render(<ProjectList projects={[makeProject()]} />);
    const link = screen.getByRole("link", { name: /My App/ });
    expect(link).toHaveAttribute("href", "/project/proj-1");
  });

  // UI-PL-03: card shows name, description, version count, timestamp
  it("UI-PL-03a: card shows project name", () => {
    render(<ProjectList projects={[makeProject()]} />);
    expect(screen.getByText("My App")).toBeInTheDocument();
  });

  it("UI-PL-03b: card shows description when present", () => {
    render(<ProjectList projects={[makeProject()]} />);
    expect(screen.getByText("A test project")).toBeInTheDocument();
  });

  it("UI-PL-03c: card shows version count badge", () => {
    render(<ProjectList projects={[makeProject({ _count: { versions: 5, messages: 2 } })]} />);
    expect(screen.getByText("v5")).toBeInTheDocument();
  });

  it("UI-PL-03d: card shows last message snippet", () => {
    render(<ProjectList projects={[makeProject()]} />);
    expect(screen.getByText(/Build me a todo/)).toBeInTheDocument();
  });

  it("UI-PL-03e: card shows no description row when null", () => {
    render(<ProjectList projects={[makeProject({ description: null })]} />);
    expect(screen.queryByText("A test project")).not.toBeInTheDocument();
  });

  // UI-PL-04: new project button opens Dialog
  it("UI-PL-04: + 新建项目 button opens dialog", () => {
    render(<ProjectList projects={[makeProject()]} />);
    fireEvent.click(screen.getByRole("button", { name: /新建项目/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("项目名称")).toBeInTheDocument();
  });

  it("UI-PL-04b: create button in dialog is disabled when name is empty", () => {
    render(<ProjectList projects={[]} />);
    // open dialog from empty state button first
    fireEvent.click(screen.getAllByRole("button")[0]);
    const createBtn = screen.getByRole("button", { name: /^创建$/ });
    expect(createBtn).toBeDisabled();
  });

  it("UI-PL-04c: create button enabled after typing name", () => {
    render(<ProjectList projects={[]} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.change(screen.getByPlaceholderText("项目名称"), { target: { value: "My New App" } });
    expect(screen.getByRole("button", { name: /^创建$/ })).not.toBeDisabled();
  });

  // UI-PL-05: successful create shows toast and navigates
  it("UI-PL-05: successful create calls toast.success and navigates", async () => {
    mockFetchAPI.mockResolvedValue({
      json: jest.fn().mockResolvedValue({ id: "new-proj-id" }),
    });

    render(<ProjectList projects={[]} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.change(screen.getByPlaceholderText("项目名称"), { target: { value: "Brand New App" } });
    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("项目创建成功");
      expect(mockPush).toHaveBeenCalledWith("/project/new-proj-id");
    });
  });

  it("UI-PL-04d: cancel button closes dialog", () => {
    render(<ProjectList projects={[makeProject()]} />);
    fireEvent.click(screen.getByRole("button", { name: /新建项目/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("UI-PL-04e: Enter key in name input triggers create", async () => {
    mockFetchAPI.mockResolvedValue({
      json: jest.fn().mockResolvedValue({ id: "enter-proj" }),
    });
    render(<ProjectList projects={[]} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    const nameInput = screen.getByPlaceholderText("项目名称");
    fireEvent.change(nameInput, { target: { value: "Enter Project" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await waitFor(() => {
      expect(mockFetchAPI).toHaveBeenCalled();
    });
  });

  it("UI-PL-05b: failed create shows error toast", async () => {
    mockFetchAPI.mockRejectedValue(new Error("Network error"));

    render(<ProjectList projects={[]} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.change(screen.getByPlaceholderText("项目名称"), { target: { value: "My App" } });
    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("创建失败，请重试");
    });
  });
});
