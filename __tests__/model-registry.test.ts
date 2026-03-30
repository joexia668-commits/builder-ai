/**
 * TDD tests for lib/model-registry.ts
 *
 * RED: these tests define expected behavior before implementation.
 */

import {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  getModelById,
  getAvailableModels,
  isValidModelId,
  type ModelDefinition,
  type ProviderId,
} from "@/lib/model-registry";

describe("MODEL_REGISTRY structure", () => {
  it("contains at least 4 models", () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThanOrEqual(4);
  });

  it("every model has required fields", () => {
    for (const model of MODEL_REGISTRY) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.provider).toMatch(/^(gemini|deepseek|groq)$/);
      expect(model.providerModel).toBeTruthy();
      expect(model.envKey).toBeTruthy();
    }
  });

  it("all model ids are unique", () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes gemini-2.0-flash", () => {
    expect(MODEL_REGISTRY.find((m) => m.id === "gemini-2.0-flash")).toBeDefined();
  });

  it("includes deepseek-chat", () => {
    expect(MODEL_REGISTRY.find((m) => m.id === "deepseek-chat")).toBeDefined();
  });

  it("includes llama-3.3-70b", () => {
    expect(MODEL_REGISTRY.find((m) => m.id === "llama-3.3-70b")).toBeDefined();
  });
});

describe("DEFAULT_MODEL_ID", () => {
  it("points to a valid model in the registry", () => {
    const model = MODEL_REGISTRY.find((m) => m.id === DEFAULT_MODEL_ID);
    expect(model).toBeDefined();
  });

  it("is deepseek-chat (backward-compatible default)", () => {
    expect(DEFAULT_MODEL_ID).toBe("deepseek-chat");
  });
});

describe("getModelById", () => {
  it("returns the correct model for a valid id", () => {
    const model = getModelById("gemini-2.0-flash");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("gemini");
  });

  it("returns undefined for unknown id", () => {
    expect(getModelById("unknown-model")).toBeUndefined();
  });
});

describe("getAvailableModels", () => {
  it("returns all models when all env keys are set", () => {
    const env: Record<string, string> = {
      GOOGLE_GENERATIVE_AI_API_KEY: "key",
      DEEPSEEK_API_KEY: "key",
      GROQ_API_KEY: "key",
    };
    const available = getAvailableModels(env);
    expect(available.length).toBe(MODEL_REGISTRY.length);
  });

  it("excludes models whose envKey is not in the provided env", () => {
    const env: Record<string, string> = {
      DEEPSEEK_API_KEY: "key",
    };
    const available = getAvailableModels(env);
    expect(available.every((m) => m.provider === "deepseek")).toBe(true);
    expect(available.find((m) => m.provider === "gemini")).toBeUndefined();
  });

  it("returns empty array when no env keys are set", () => {
    const available = getAvailableModels({});
    expect(available).toHaveLength(0);
  });
});

describe("isValidModelId", () => {
  it("returns true for known model ids", () => {
    expect(isValidModelId("gemini-2.0-flash")).toBe(true);
    expect(isValidModelId("deepseek-chat")).toBe(true);
    expect(isValidModelId("llama-3.3-70b")).toBe(true);
  });

  it("returns false for unknown ids", () => {
    expect(isValidModelId("gpt-4")).toBe(false);
    expect(isValidModelId("")).toBe(false);
    expect(isValidModelId(undefined)).toBe(false);
  });
});
