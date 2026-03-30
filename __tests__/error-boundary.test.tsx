/**
 * TDD tests for SandpackErrorBoundary (Epic 2 — AC-8)
 *
 * Verifies the error boundary:
 *   EB-01: Renders fallback UI when child throws
 *   EB-02: Retry button resets error state and re-renders children
 *   EB-03: Renders children normally when no error occurs
 *   EB-04: Uses custom fallback prop when provided
 */

import React, { type ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SandpackErrorBoundary } from "@/components/preview/error-boundary";

// Suppress expected React error output in test logs
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

// Component that throws on first render, recovers after reset
let shouldThrow = false;
function BombChild() {
  if (shouldThrow) throw new Error("Sandpack render explosion");
  return <div data-testid="child-content">Rendered OK</div>;
}

// Component that always throws
function AlwaysBombChild() {
  throw new Error("Always explodes");
  return null;
}

describe("SandpackErrorBoundary", () => {
  // EB-03: Normal render — children visible, no fallback
  it("EB-03: renders children when no error occurs", () => {
    shouldThrow = false;
    render(
      <SandpackErrorBoundary>
        <BombChild />
      </SandpackErrorBoundary>
    );
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.queryByText("渲染失败")).not.toBeInTheDocument();
  });

  // EB-01: Error thrown → default fallback UI displayed
  it("EB-01: renders default fallback UI when child throws", () => {
    render(
      <SandpackErrorBoundary>
        <AlwaysBombChild />
      </SandpackErrorBoundary>
    );
    expect(screen.getByText("渲染失败")).toBeInTheDocument();
    expect(screen.getByText(/语法错误/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  // EB-02: Retry resets hasError → children re-render
  it("EB-02: retry button resets error state and re-renders children", () => {
    shouldThrow = true;
    render(
      <SandpackErrorBoundary>
        <BombChild />
      </SandpackErrorBoundary>
    );
    // Error state: fallback visible
    expect(screen.getByText("渲染失败")).toBeInTheDocument();

    // Fix the bomb before retry
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    // Children should render again
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.queryByText("渲染失败")).not.toBeInTheDocument();
  });

  // EB-02 (extended): onRetry callback is invoked
  it("EB-02b: calls onRetry prop when retry button is clicked", () => {
    const onRetry = jest.fn();
    render(
      <SandpackErrorBoundary onRetry={onRetry}>
        <AlwaysBombChild />
      </SandpackErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // EB-04: Custom fallback prop is used instead of default
  it("EB-04: renders custom fallback prop when provided", () => {
    const customFallback = <div data-testid="custom-fallback">Custom Error UI</div>;
    render(
      <SandpackErrorBoundary fallback={customFallback}>
        <AlwaysBombChild />
      </SandpackErrorBoundary>
    );
    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.queryByText("渲染失败")).not.toBeInTheDocument();
  });

  // EB-01 (extended): componentDidCatch logs the error
  it("EB-01b: logs error via console.error", () => {
    render(
      <SandpackErrorBoundary>
        <AlwaysBombChild />
      </SandpackErrorBoundary>
    );
    expect(console.error).toHaveBeenCalledWith(
      "[SandpackErrorBoundary]",
      expect.any(Error)
    );
  });
});
