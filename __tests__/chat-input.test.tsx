/**
 * TDD unit tests for ChatInput component (Epic 4 — full coverage)
 *
 * UI-CI-01: Enter triggers onSubmit; Shift+Enter does not
 * UI-CI-02: Empty value → send button disabled
 * UI-CI-03: isGenerating=true + onStop → shows stop button
 * UI-CI-04: isGenerating=false → shows send button
 * UI-CI-05: isPreviewingHistory=true → correct placeholder
 * UI-CI-06: Clicking stop button calls onStop
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "@/components/workspace/chat-input";

// ── Mock ModelSelector to isolate ChatInput behavior ──────────────────────
jest.mock("@/components/workspace/model-selector", () => ({
  ModelSelector: jest.fn(({ value, onChange, availableModelIds, disabled }) => (
    <select
      data-testid="model-selector-trigger"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="选择 AI 模型"
    >
      {(availableModelIds ?? []).map((id: string) => (
        <option key={id} value={id}>{id}</option>
      ))}
    </select>
  )),
}));

describe("ChatInput", () => {
  // UI-CI-02: Empty value → send button disabled
  it("UI-CI-02: send button is disabled when input is empty", () => {
    render(<ChatInput onSubmit={jest.fn()} />);
    const btn = screen.getByRole("button", { name: /발송|发送/i });
    expect(btn).toBeDisabled();
  });

  it("UI-CI-02b: send button is enabled when input has text", () => {
    render(<ChatInput onSubmit={jest.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(screen.getByRole("button", { name: /发送/i })).not.toBeDisabled();
  });

  // UI-CI-01: Enter triggers onSubmit; Shift+Enter does not
  it("UI-CI-01a: Enter key calls onSubmit with trimmed value", () => {
    const onSubmit = jest.fn();
    render(<ChatInput onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  build a todo app  " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith("build a todo app");
  });

  it("UI-CI-01b: Shift+Enter does NOT call onSubmit", () => {
    const onSubmit = jest.fn();
    render(<ChatInput onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("UI-CI-01c: Enter on empty input does NOT call onSubmit", () => {
    const onSubmit = jest.fn();
    render(<ChatInput onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("UI-CI-01d: clicking send button calls onSubmit and clears input", () => {
    const onSubmit = jest.fn();
    render(<ChatInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "test prompt" } });
    fireEvent.click(screen.getByRole("button", { name: /发送/i }));
    expect(onSubmit).toHaveBeenCalledWith("test prompt");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  // UI-CI-04: isGenerating=false → shows send button
  it("UI-CI-04: shows send button when not generating", () => {
    render(<ChatInput onSubmit={jest.fn()} isGenerating={false} />);
    expect(screen.getByRole("button", { name: /发送|生成中/i })).toBeInTheDocument();
    expect(screen.queryByTestId("stop-btn")).not.toBeInTheDocument();
  });

  // UI-CI-03: isGenerating=true + onStop → shows stop button
  it("UI-CI-03: shows stop button when isGenerating=true and onStop provided", () => {
    render(
      <ChatInput
        onSubmit={jest.fn()}
        isGenerating={true}
        onStop={jest.fn()}
      />
    );
    expect(screen.getByTestId("stop-btn")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /发送/i })).not.toBeInTheDocument();
  });

  it("UI-CI-03b: does NOT show stop button when isGenerating=true but no onStop", () => {
    render(<ChatInput onSubmit={jest.fn()} isGenerating={true} />);
    expect(screen.queryByTestId("stop-btn")).not.toBeInTheDocument();
  });

  // UI-CI-06: Clicking stop button calls onStop
  it("UI-CI-06: clicking stop button calls onStop", () => {
    const onStop = jest.fn();
    render(
      <ChatInput
        onSubmit={jest.fn()}
        isGenerating={true}
        onStop={onStop}
      />
    );
    fireEvent.click(screen.getByTestId("stop-btn"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  // UI-CI-05: isPreviewingHistory=true → correct placeholder
  it("UI-CI-05: shows history preview placeholder when isPreviewingHistory=true", () => {
    render(
      <ChatInput
        onSubmit={jest.fn()}
        isPreviewingHistory={true}
        disabled={true}
      />
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/历史版本|返回当前/)
    );
  });

  it("UI-CI-05b: shows generating placeholder when disabled (not history)", () => {
    render(<ChatInput onSubmit={jest.fn()} disabled={true} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("placeholder", expect.stringMatching(/生成中/));
  });

  it("UI-CI-05c: shows default prompt placeholder normally", () => {
    render(<ChatInput onSubmit={jest.fn()} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("placeholder", expect.stringMatching(/描述|应用/));
  });
});

// ── EPIC 7: ModelSelector 集成 ─────────────────────────────────────────────
describe("ChatInput — ModelSelector 集成（EPIC 7 AC-1 / AC-5 / AC-6）", () => {
  // CI-07: selectedModel prop 存在时渲染 ModelSelector
  it("CI-07: 传入 selectedModel + onModelChange 时渲染 ModelSelector", () => {
    render(
      <ChatInput
        onSubmit={jest.fn()}
        selectedModel="deepseek-chat"
        onModelChange={jest.fn()}
      />
    );
    expect(screen.getByTestId("model-selector-trigger")).toBeInTheDocument();
    expect(screen.getByText(/模型：/)).toBeInTheDocument();
  });

  // CI-08: 不传 selectedModel 时不渲染 ModelSelector
  it("CI-08: 不传 selectedModel 时不渲染 ModelSelector", () => {
    render(<ChatInput onSubmit={jest.fn()} />);
    expect(screen.queryByTestId("model-selector-trigger")).not.toBeInTheDocument();
  });

  // CI-08b: 传 selectedModel 但不传 onModelChange 时也不渲染（两者必须同时存在）
  it("CI-08b: 仅传 selectedModel 而不传 onModelChange 时不渲染 ModelSelector", () => {
    render(<ChatInput onSubmit={jest.fn()} selectedModel="deepseek-chat" />);
    expect(screen.queryByTestId("model-selector-trigger")).not.toBeInTheDocument();
  });

  // CI-09: 选择模型时触发 onModelChange 回调
  it("CI-09: 切换模型时触发 onModelChange 回调", () => {
    const onModelChange = jest.fn();
    render(
      <ChatInput
        onSubmit={jest.fn()}
        selectedModel="deepseek-chat"
        onModelChange={onModelChange}
        availableModelIds={["deepseek-chat", "gemini-2.0-flash"]}
      />
    );
    fireEvent.change(screen.getByTestId("model-selector-trigger"), {
      target: { value: "gemini-2.0-flash" },
    });
    expect(onModelChange).toHaveBeenCalledWith("gemini-2.0-flash");
  });

  // CI-10: isGenerating=true 时 ModelSelector disabled
  it("CI-10: isGenerating=true 时 ModelSelector 处于 disabled 状态", () => {
    render(
      <ChatInput
        onSubmit={jest.fn()}
        selectedModel="deepseek-chat"
        onModelChange={jest.fn()}
        isGenerating={true}
        onStop={jest.fn()}
      />
    );
    expect(screen.getByTestId("model-selector-trigger")).toBeDisabled();
  });

  // CI-11: isGenerating=false 时 ModelSelector 可操作
  it("CI-11: isGenerating=false 时 ModelSelector 不 disabled", () => {
    render(
      <ChatInput
        onSubmit={jest.fn()}
        selectedModel="deepseek-chat"
        onModelChange={jest.fn()}
        isGenerating={false}
      />
    );
    expect(screen.getByTestId("model-selector-trigger")).not.toBeDisabled();
  });

  // CI-12: availableModelIds 正确透传给 ModelSelector
  it("CI-12: availableModelIds 正确透传给 ModelSelector", () => {
    const { ModelSelector } = require("@/components/workspace/model-selector");
    render(
      <ChatInput
        onSubmit={jest.fn()}
        selectedModel="deepseek-chat"
        onModelChange={jest.fn()}
        availableModelIds={["deepseek-chat", "llama-3.3-70b"]}
      />
    );
    expect(ModelSelector).toHaveBeenCalledWith(
      expect.objectContaining({
        availableModelIds: ["deepseek-chat", "llama-3.3-70b"],
      }),
      expect.anything()
    );
  });
});
