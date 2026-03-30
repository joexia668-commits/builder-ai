/**
 * TDD unit tests for DeleteProjectDialog component (EPIC 6)
 *
 * DPD-01: renders dialog with correct title and project name
 * DPD-02: cancel button calls onCancel
 * DPD-03: confirm button calls onConfirm
 * DPD-04: confirm button shows loading state when isLoading=true
 * DPD-05: confirm button is disabled when isLoading=true
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";

describe("DeleteProjectDialog", () => {
  const defaultProps = {
    projectName: "My Test App",
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    isLoading: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // DPD-01: title and project name
  it("DPD-01a: renders dialog title '删除项目'", () => {
    render(<DeleteProjectDialog {...defaultProps} />);
    expect(screen.getByText("删除项目")).toBeInTheDocument();
  });

  it("DPD-01b: renders project name in confirmation text", () => {
    render(<DeleteProjectDialog {...defaultProps} />);
    expect(screen.getByText(/My Test App/)).toBeInTheDocument();
  });

  it("DPD-01c: renders warning about irreversible action", () => {
    render(<DeleteProjectDialog {...defaultProps} />);
    expect(screen.getByText(/不可撤销/)).toBeInTheDocument();
  });

  // DPD-02: cancel button
  it("DPD-02: cancel button calls onCancel", () => {
    render(<DeleteProjectDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  // DPD-03: confirm button
  it("DPD-03: confirm button calls onConfirm", () => {
    render(<DeleteProjectDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  // DPD-04: loading state text
  it("DPD-04: shows '删除中...' when isLoading=true", () => {
    render(<DeleteProjectDialog {...defaultProps} isLoading={true} />);
    expect(screen.getByText("删除中...")).toBeInTheDocument();
  });

  // DPD-05: disabled when loading
  it("DPD-05: confirm button disabled when isLoading=true", () => {
    render(<DeleteProjectDialog {...defaultProps} isLoading={true} />);
    expect(screen.getByRole("button", { name: "删除中..." })).toBeDisabled();
  });

  it("DPD-05b: cancel button disabled when isLoading=true", () => {
    render(<DeleteProjectDialog {...defaultProps} isLoading={true} />);
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});
