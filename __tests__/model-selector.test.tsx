/**
 * TDD tests for components/workspace/model-selector.tsx
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
// Note: using fireEvent.change on <select> which is reliably testable in jsdom
import { ModelSelector } from "@/components/workspace/model-selector";

// Mock MODEL_REGISTRY so tests are deterministic regardless of env vars
jest.mock("@/lib/model-registry", () => ({
  MODEL_REGISTRY: [
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      provider: "gemini",
      providerModel: "gemini-2.0-flash",
      badge: "Fast",
      envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    },
    {
      id: "deepseek-chat",
      name: "DeepSeek V3",
      provider: "deepseek",
      providerModel: "deepseek-chat",
      badge: "Balanced",
      envKey: "DEEPSEEK_API_KEY",
    },
  ],
  getAvailableModels: (env: Record<string, string>) => {
    const all = [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini", badge: "Fast", envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
      { id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek", badge: "Balanced", envKey: "DEEPSEEK_API_KEY" },
    ];
    return all.filter((m) => Boolean(env[m.envKey]));
  },
}));

describe("ModelSelector", () => {
  it("renders the trigger with current model name", () => {
    render(
      <ModelSelector
        value="deepseek-chat"
        onChange={jest.fn()}
        availableModelIds={["gemini-2.0-flash", "deepseek-chat"]}
      />
    );
    expect(screen.getByTestId("model-selector-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("model-selector-trigger")).toHaveTextContent("DeepSeek V3");
  });

  it("shows model name for gemini value", () => {
    render(
      <ModelSelector
        value="gemini-2.0-flash"
        onChange={jest.fn()}
        availableModelIds={["gemini-2.0-flash", "deepseek-chat"]}
      />
    );
    expect(screen.getByTestId("model-selector-trigger")).toHaveTextContent("Gemini 2.0 Flash");
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <ModelSelector
        value="deepseek-chat"
        onChange={jest.fn()}
        availableModelIds={["deepseek-chat"]}
        disabled
      />
    );
    const trigger = screen.getByTestId("model-selector-trigger");
    expect(trigger).toBeDisabled();
  });

  it("calls onChange with correct modelId when selection changes", () => {
    const handleChange = jest.fn();
    render(
      <ModelSelector
        value="deepseek-chat"
        onChange={handleChange}
        availableModelIds={["gemini-2.0-flash", "deepseek-chat"]}
      />
    );
    fireEvent.change(screen.getByTestId("model-selector-trigger"), {
      target: { value: "gemini-2.0-flash" },
    });
    expect(handleChange).toHaveBeenCalledWith("gemini-2.0-flash");
  });

  it("shows unavailable badge for models not in availableModelIds", () => {
    render(
      <ModelSelector
        value="deepseek-chat"
        onChange={jest.fn()}
        availableModelIds={["deepseek-chat"]} // gemini not available
      />
    );
    const geminiOption = screen.getByTestId("model-option-gemini-2.0-flash");
    expect(geminiOption).toHaveAttribute("data-disabled", "true");
  });
});
