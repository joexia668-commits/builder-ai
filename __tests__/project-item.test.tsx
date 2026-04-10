/**
 * TDD unit tests for ProjectItem component
 *
 * PI-01: renders project name and date
 * PI-02: links to /project/:id
 * PI-03: applies active styles when isActive=true
 * PI-04: more-options dropdown trigger is present in DOM
 * PI-05: opening dropdown and clicking delete opens confirmation dialog
 * PI-06: cancel in delete dialog closes it without calling onDelete
 * PI-07: confirm in delete dialog calls onDelete with project id
 * PI-08: opening dropdown and clicking rename opens rename dialog
 * PI-09: cancel in rename dialog closes it without calling onRename
 * PI-10: confirm in rename dialog calls onRename with id and new name
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

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

import { ProjectItem } from "@/components/sidebar/project-item";

const project = {
  id: "proj-1",
  name: "My Sidebar App",
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

describe("ProjectItem", () => {
  let onDelete: jest.Mock;
  let onRename: jest.Mock;

  beforeEach(() => {
    onDelete = jest.fn();
    onRename = jest.fn();
  });

  it("PI-01a: renders project name", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByText("My Sidebar App")).toBeInTheDocument();
  });

  it("PI-02: links to /project/:id", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/project/proj-1");
  });

  it("PI-03a: active item has data-active attribute", () => {
    const { container } = render(
      <ProjectItem project={project} isActive={true} onDelete={onDelete} onRename={onRename} />
    );
    expect(container.querySelector("[data-active='true']")).toBeInTheDocument();
  });

  it("PI-03b: inactive item does not have data-active='true'", () => {
    const { container } = render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    expect(container.querySelector("[data-active='true']")).not.toBeInTheDocument();
  });

  it("PI-04: more-options dropdown trigger is present in DOM", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    expect(screen.getByRole("button", { name: "My Sidebar App 操作" })).toBeInTheDocument();
  });

  it("PI-05: opening dropdown and clicking delete opens confirmation dialog", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/「My Sidebar App」/)).toBeInTheDocument();
  });

  it("PI-06: cancel closes delete dialog without calling onDelete", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("PI-07: confirm calls onDelete with project id", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("proj-1");
  });

  it("PI-08: opening dropdown and clicking rename opens rename dialog", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("重命名"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("My Sidebar App");
  });

  it("PI-09: cancel closes rename dialog without calling onRename", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("PI-10: confirm calls onRename with project id and new name", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed Sidebar App" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRename).toHaveBeenCalledWith("proj-1", "Renamed Sidebar App");
  });
});
