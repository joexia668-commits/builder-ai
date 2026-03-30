/**
 * TDD tests for CodeEditor debounce (Epic 2)
 *
 * Verifies that onChange is called with debounce (500ms),
 * preventing high-frequency state updates on every keystroke.
 */

import React from "react";
import { render, act } from "@testing-library/react";
import { useDebounce } from "@/lib/use-debounce";
import { renderHook } from "@testing-library/react";

// Monaco is loaded via next/dynamic — mock dynamic to be synchronous
jest.mock("next/dynamic", () => () => {
  const MockEditor = ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  MockEditor.displayName = "MockMonacoEditor";
  return MockEditor;
});

// Test the debounce hook in isolation
describe("useDebounce", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("hello", 500));
    expect(result.current).toBe("hello");
  });

  it("does not update value before delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: "hello" } }
    );
    rerender({ value: "world" });
    // Not updated yet
    expect(result.current).toBe("hello");
  });

  it("updates value after delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: "hello" } }
    );
    rerender({ value: "world" });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toBe("world");
  });

  it("CE-coalesce: coalesces multiple rapid updates into one final value", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: "a" } }
    );
    rerender({ value: "ab" });
    rerender({ value: "abc" });
    rerender({ value: "abcd" });
    // Still the initial value
    expect(result.current).toBe("a");
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // Only the last value propagated
    expect(result.current).toBe("abcd");
  });
});

// CodeEditor component integration tests
import { CodeEditor } from "@/components/preview/code-editor";
import { screen, fireEvent, waitFor } from "@testing-library/react";

describe("CodeEditor component", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // CE-05: External code prop change syncs into the editor
  it("CE-05: syncs external code prop change into editor value", () => {
    const onChange = jest.fn();
    const { rerender } = render(<CodeEditor code="initial code" onChange={onChange} />);

    // Verify initial value shown
    expect(screen.getByTestId("monaco-editor")).toHaveValue("initial code");

    // Parent passes new code (e.g. version restore)
    rerender(<CodeEditor code="restored code" onChange={onChange} />);

    expect(screen.getByTestId("monaco-editor")).toHaveValue("restored code");
  });

  // CE-06: onChange not propagated to parent before debounce delay
  it("CE-06: does not call onChange before 500ms debounce elapses", () => {
    const onChange = jest.fn();
    render(<CodeEditor code="hello" onChange={onChange} />);

    // Simulate typing
    fireEvent.change(screen.getByTestId("monaco-editor"), {
      target: { value: "hello world" },
    });

    // No propagation yet
    expect(onChange).not.toHaveBeenCalledWith("hello world");
  });

  // CE-07: onChange propagated exactly once after 500ms
  it("CE-07: calls onChange exactly once after 500ms debounce", async () => {
    const onChange = jest.fn();
    render(<CodeEditor code="hello" onChange={onChange} />);

    fireEvent.change(screen.getByTestId("monaco-editor"), {
      target: { value: "hello world" },
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("hello world");
    });
    // Must be called exactly once, not on every keystroke
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
