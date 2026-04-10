/**
 * TDD unit tests for RenameProjectDialog component
 * RPD-01: renders dialog title and pre-fills input with current name
 * RPD-02: confirm button disabled when name is unchanged
 * RPD-03: confirm button enabled when name is changed
 * RPD-04: calls onConfirm with trimmed new name on button click
 * RPD-05: calls onConfirm on Enter key
 * RPD-06: cancel button calls onCancel
 * RPD-07: shows '保存中...' and disables button when isLoading=true
 * RPD-08: cancel button disabled when isLoading=true
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { RenameProjectDialog } from "@/components/ui/rename-project-dialog";

describe("RenameProjectDialog", () => {
  const defaultProps = {
    projectName: "My Test App",
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => { jest.clearAllMocks(); });

  it("RPD-01a: renders dialog title '重命名项目'", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    expect(screen.getByText("重命名项目")).toBeInTheDocument();
  });

  it("RPD-01b: pre-fills input with current project name", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    expect(screen.getByRole("textbox")).toHaveValue("My Test App");
  });

  it("RPD-02: confirm button disabled when name is unchanged", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("RPD-03: confirm button enabled when name is changed", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New Name" } });
    expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled();
  });

  it("RPD-04: calls onConfirm with trimmed new name on button click", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  New Name  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith("New Name");
  });

  it("RPD-05: calls onConfirm on Enter key", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New Name" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(defaultProps.onConfirm).toHaveBeenCalledWith("New Name");
  });

  it("RPD-06: cancel button calls onCancel", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("RPD-07: shows '保存中...' and disables confirm when isLoading=true", () => {
    render(<RenameProjectDialog {...defaultProps} isLoading={true} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New Name" } });
    expect(screen.getByRole("button", { name: "保存中..." })).toBeDisabled();
  });

  it("RPD-08: cancel button disabled when isLoading=true", () => {
    render(<RenameProjectDialog {...defaultProps} isLoading={true} />);
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});
