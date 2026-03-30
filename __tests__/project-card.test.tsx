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

  beforeEach(() => {
    onDelete.mockClear();
  });

  // PC-01: content rendering
  it("PC-01a: renders project name", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    expect(screen.getByText("My App")).toBeInTheDocument();
  });

  it("PC-01b: renders description", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    expect(screen.getByText("A test project")).toBeInTheDocument();
  });

  it("PC-01c: renders version badge", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("PC-01d: hides description when null", () => {
    render(
      <ProjectCard project={{ ...project, description: null }} onDelete={onDelete} />
    );
    expect(screen.queryByText("A test project")).not.toBeInTheDocument();
  });

  // PC-02: link
  it("PC-02: card links to /project/:id", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/project/proj-1");
  });

  // PC-03: dropdown trigger
  it("PC-03: dropdown trigger button is present", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  // PC-04: dropdown shows delete option
  it("PC-04: clicking dropdown shows '删除项目' menu item", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("删除项目")).toBeInTheDocument();
  });

  // PC-05: opens DeleteProjectDialog
  it("PC-05: clicking '删除项目' opens confirmation dialog with project name", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("删除项目"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // Dialog description contains the project name in 「」
    expect(screen.getByText(/「My App」/)).toBeInTheDocument();
  });

  // PC-06: cancel closes dialog without calling onDelete
  it("PC-06: cancel closes dialog without calling onDelete", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  // PC-07: confirm calls onDelete with project id
  it("PC-07: confirm calls onDelete with project id", () => {
    render(<ProjectCard project={project} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("proj-1");
  });
});
