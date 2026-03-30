/**
 * Builds the full context string passed to the Engineer agent.
 * Combines the user's original prompt, PM's PRD, and Architect's technical plan.
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
