import type { PmOutput } from "@/lib/types";

/**
 * Builds the full context string passed to the Engineer agent.
 * Combines the user's original prompt, PM's PRD, and Architect's technical plan.
 * Used as fallback when PM output is not structured JSON.
 */
export function buildEngineerContext(
  userPrompt: string,
  pmOutput: string,
  archOutput: string,
  currentFiles?: Record<string, string>
): string {
  const sections = [
    `用户原始需求：\n${userPrompt}`,
    `PM 需求文档（PRD）：\n${pmOutput}`,
    `架构师技术方案：\n${archOutput}`,
  ];

  if (currentFiles && Object.keys(currentFiles).length > 0) {
    const filesSection = Object.entries(currentFiles)
      .map(([path, code]) => `// === EXISTING FILE: ${path} ===\n${code}`)
      .join("\n\n");
    sections.push(
      `当前版本代码（请在此基础上修改，保留已有功能逻辑）：\n${filesSection}`
    );
  }

  return sections.join("\n\n");
}

/**
 * Builds a compact, token-efficient context for the Engineer agent from structured PM output.
 * Uses labeled format that LLMs parse well while minimising token count.
 */
export function buildEngineerContextFromStructured(
  userPrompt: string,
  pm: PmOutput,
  archOutput: string,
  currentFiles?: Record<string, string>
): string {
  const sections = [
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

  if (currentFiles && Object.keys(currentFiles).length > 0) {
    const filesSection = Object.entries(currentFiles)
      .map(([path, code]) => `// === EXISTING FILE: ${path} ===\n${code}`)
      .join("\n\n");
    sections.push(
      `当前版本代码（请在此基础上修改，保留已有功能逻辑）：\n${filesSection}`
    );
  }

  return sections.join("\n\n");
}

/**
 * Builds Engineer context for the direct bug-fix / style-change path.
 * Skips PM and Architect — sends V1 code directly with user feedback.
 *
 * Uses XML-style <source> tags intentionally: they look nothing like the
 * multi-file output marker "// === FILE: /path ===" so the LLM won't
 * pattern-match and emit multi-file output when we need single-file.
 */
export function buildDirectEngineerContext(
  userPrompt: string,
  currentFiles: Record<string, string>
): string {
  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `<source file="${path}">\n${code}\n</source>`)
    .join("\n\n");

  return [
    `用户反馈：${userPrompt}`,
    `当前版本代码（参考，请在此基础上定向修复/调整，最小化改动范围）：\n${filesSection}`,
    `输出要求（严格遵守）：将所有组件内联合并为单个文件，输出完整可运行的 export default function App() {}，不得使用多文件格式（禁止输出 // === FILE: 分隔符），不得使用 \`\`\` 代码围栏，代码即全部内容。`,
  ].join("\n\n");
}

/**
 * Builds Engineer context for the direct bug-fix / style-change path on multi-file V1 apps.
 * Instructs the LLM to output ALL files in FILE separator format so extractMultiFileCode
 * can parse the result. Even unchanged files must be re-emitted verbatim.
 */
export function buildDirectMultiFileEngineerContext(
  userPrompt: string,
  currentFiles: Record<string, string>
): string {
  const fileList = Object.keys(currentFiles)
    .map((p) => `- ${p}`)
    .join("\n");

  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `<source file="${path}">\n${code}\n</source>`)
    .join("\n\n");

  return `你是一位全栈工程师。根据用户反馈，修复以下多文件 React 应用的问题。

用户反馈：${userPrompt}

当前应用文件列表：
${fileList}

当前版本代码（逐文件参考）：
${filesSection}

输出格式（严格遵守）：
- 每个文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整代码
- 必须输出全部文件（未修改的文件原样复制，不得省略）
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容`;
}

/**
 * Builds supplementary context injected into PM when iterating on an existing app.
 * PM sees a structured summary of what already exists so it generates a delta PRD,
 * not a full-rebuild PRD.
 */
export function buildPmIterationContext(pm: PmOutput): string {
  const lines = [
    `当前应用已有以下功能（请在此基础上分析增量需求，不要重新设计已有功能）：`,
    `[意图]: ${pm.intent}`,
    `[功能]: ${pm.features.join(" / ")}`,
    `[持久化]: ${pm.persistence}`,
    `[模块]: ${pm.modules.join(" / ")}`,
  ];

  if (pm.dataModel && pm.dataModel.length > 0) {
    lines.push(`[数据模型]: ${pm.dataModel.join(" / ")}`);
  }

  return lines.join("\n");
}
