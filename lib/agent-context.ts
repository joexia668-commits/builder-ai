import type { PmOutput } from "@/lib/types";

/**
 * Builds the full context string passed to the Engineer agent.
 * Combines the user's original prompt, PM's PRD, and Architect's technical plan.
 * Used as fallback when PM output is not structured JSON.
 */
export function buildEngineerContext(
  userPrompt: string,
  pmOutput: string,
  archOutput: string
): string {
  return [
    `用户原始需求：\n${userPrompt}`,
    `PM 需求文档（PRD）：\n${pmOutput}`,
    `架构师技术方案：\n${archOutput}`,
  ].join("\n\n");
}

/**
 * Builds a compact, token-efficient context for the Engineer agent from structured PM output.
 * Uses labeled format that LLMs parse well while minimising token count.
 */
export function buildEngineerContextFromStructured(
  userPrompt: string,
  pm: PmOutput,
  archOutput: string
): string {
  const lines = [
    `用户原始需求：\n${userPrompt}`,
    [
      `[意图]: ${pm.intent}`,
      `[功能]: ${pm.features.join(" / ")}`,
      `[持久化]: ${pm.persistence}`,
      `[模块]: ${pm.modules.join(" / ")}`,
      ...(pm.dataModel && pm.dataModel.length > 0
        ? [`[数据模型]: ${pm.dataModel.join(" / ")}`]
        : []),
    ].join("\n"),
    `架构师技术方案：\n${archOutput}`,
  ];
  return lines.join("\n\n");
}
