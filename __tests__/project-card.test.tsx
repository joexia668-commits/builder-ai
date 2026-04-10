/**
 * TDD unit tests for ProjectCard component (EPIC 6)
 *
 * PC-01: renders project name, description, version badge, timestamp
 * PC-02: card links to /project/:id
 * PC-03: DropdownMenu trigger is visible
 * PC-04: clicking dropdown shows "删除项目" option
 * PC-05: clicking "删除项目" opens DeleteProjectDialog
 * PC-06: cancel in dialog closes it without calling onDelete
 * PC-07: confirm in dialog calls onDelete with project id
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

import { ProjectCard } from "@/components/home/project-card";

const project = {
  id: "proj-1",
  name: "My App",
  description: "A test project",
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  _count: { versions: 3, messages: 10 },
  messages: [{ content: "Build me a todo app", role: "user" }],
};

describe("ProjectCard", () => {
  const onDelete = jest.fn();
  const onRename = jest.fn();

  beforeEach(() => {
    onDelete.mockClear();
    onRename.mockClear();
  });

  // PC-01: content rendering
  it("PC-01a: renders project name", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByText("My App")).toBeInTheDocument();
  });

  it("PC-01b: renders description", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByText("A test project")).toBeInTheDocument();
  });

  it("PC-01c: renders version badge", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("PC-01d: hides description when null", () => {
    render(
      <ProjectCard project={{ ...project, description: null }} onDelete={onDelete} onRename={onRename} />
    );
    expect(screen.queryByText("A test project")).not.toBeInTheDocument();
  });

  // PC-02: link
  it("PC-02: card links to /project/:id", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/project/proj-1");
  });

  // PC-03: dropdown trigger
  it("PC-03: dropdown trigger button is present", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByRole("button", { name: "项目操作" })).toBeInTheDocument();
  });

  // PC-04: dropdown shows delete option
  it("PC-04: clicking dropdown shows '删除项目' menu item", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    expect(screen.getByText("删除项目")).toBeInTheDocument();
  });

  // PC-05: opens DeleteProjectDialog
  it("PC-05: clicking '删除项目' opens confirmation dialog with project name", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // Dialog description contains the project name in 「」
    expect(screen.getByText(/「My App」/)).toBeInTheDocument();
  });

  // PC-06: cancel closes dialog without calling onDelete
  it("PC-06: cancel closes dialog without calling onDelete", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  // PC-07: confirm calls onDelete with project id
  it("PC-07: confirm calls onDelete with project id", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("proj-1");
  });

  it("PC-04b: clicking dropdown shows '重命名' menu item", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    expect(screen.getByText("重命名")).toBeInTheDocument();
  });

  it("PC-08: clicking '重命名' opens rename dialog", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("重命名"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("My App");
  });

  it("PC-09: cancel in rename dialog closes it without calling onRename", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("PC-10: confirm in rename dialog calls onRename with id and new name", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed App" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRename).toHaveBeenCalledWith("proj-1", "Renamed App");
  });
});
