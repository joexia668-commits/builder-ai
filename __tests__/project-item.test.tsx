/**
 * TDD unit tests for ProjectItem component (EPIC 6)
 *
 * PI-01: renders project name and date
 * PI-02: links to /project/:id
 * PI-03: applies active styles when isActive=true
 * PI-04: delete button exists in DOM (hidden via CSS, not conditional)
 * PI-05: clicking delete button opens confirmation dialog
 * PI-06: cancel in dialog closes it without calling onDelete
 * PI-07: confirm in dialog calls onDelete with project id
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
  const onDelete = jest.fn();

  beforeEach(() => {
    onDelete.mockClear();
  });

  // PI-01: content
  it("PI-01a: renders project name", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} />);
    expect(screen.getByText("My Sidebar App")).toBeInTheDocument();
  });

  // PI-02: link
  it("PI-02: links to /project/:id", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/project/proj-1");
  });

  // PI-03: active styles
  it("PI-03a: active item has data-active attribute", () => {
    const { container } = render(
      <ProjectItem project={project} isActive={true} onDelete={onDelete} />
    );
    expect(container.querySelector("[data-active='true']")).toBeInTheDocument();
  });

  it("PI-03b: inactive item does not have data-active='true'", () => {
    const { container } = render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} />
    );
    expect(container.querySelector("[data-active='true']")).not.toBeInTheDocument();
  });

  // PI-04: delete button in DOM
  it("PI-04: delete button is present in DOM", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} />);
    expect(screen.getByRole("button", { name: /删除/ })).toBeInTheDocument();
  });

  // PI-05: delete button opens dialog
  it("PI-05: clicking delete button opens confirmation dialog", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/「My Sidebar App」/)).toBeInTheDocument();
  });

  // PI-06: cancel closes dialog
  it("PI-06: cancel closes dialog without calling onDelete", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  // PI-07: confirm calls onDelete
  it("PI-07: confirm calls onDelete with project id", () => {
    render(<ProjectItem project={project} isActive={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("proj-1");
  });
});
