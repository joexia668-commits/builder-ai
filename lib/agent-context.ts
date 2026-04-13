import type { Intent, PmOutput, IterationRound, ArchDecisions } from "@/lib/types";

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
 * Instructs the LLM to output ONLY the files it actually modifies.
 * Unchanged files are NOT re-emitted — the caller merges { ...currentFiles, ...llmOutput }
 * so unmodified files are preserved automatically without going through the LLM.
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

  return `你是一位全栈工程师。根据用户反馈，精准修改以下多文件 React 应用。

用户反馈：${userPrompt}

当前应用文件列表：
${fileList}

当前版本代码（逐文件参考）：
${filesSection}

输出格式（严格遵守）：
- 只输出你实际需要修改的文件，未修改的文件不要输出——它们会被自动保留
- 每个修改的文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整修改后代码
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

const INTENT_LABELS: Record<Intent, string> = {
  new_project: "新建项目",
  feature_add: "功能迭代",
  bug_fix: "Bug 修复",
  style_change: "样式调整",
};

/**
 * Builds a multi-round history context string for PM.
 * Replaces the single-round buildPmIterationContext.
 */
export function buildPmHistoryContext(rounds: readonly IterationRound[]): string {
  if (rounds.length === 0) return "";

  const header = "当前应用的迭代历史（请在此基础上分析增量需求，不要重新设计已有功能）：\n";

  const roundLines = rounds.map((r, i) => {
    const label = INTENT_LABELS[r.intent] ?? r.intent;
    const parts: string[] = [];
    if (r.pmSummary) {
      const features = r.pmSummary.features.join("、");
      parts.push(`[第${i + 1}轮] 用户："${r.userPrompt}"\n  意图：${r.pmSummary.intent} / 功能：${features} / 持久化：${r.pmSummary.persistence}`);
    } else {
      parts.push(`[第${i + 1}轮] 用户："${r.userPrompt}" (${label}，跳过PM)`);
    }
    if (r.archDecisions) {
      parts.push(`  架构：${r.archDecisions.componentTree} | 状态：${r.archDecisions.stateStrategy} | 持久化：${r.archDecisions.persistenceSetup}`);
    }
    return parts.join("\n");
  });

  return header + "\n" + roundLines.join("\n\n");
}

/**
 * Builds context for Architect showing its own previous decisions.
 */
export function buildArchIterationContext(archDecisions: ArchDecisions): string {
  const lines = [
    "上次架构方案（请在此基础上增量修改，保留已有文件结构）：",
    `文件数：${archDecisions.fileCount}`,
    `组件结构：${archDecisions.componentTree}`,
    `状态管理：${archDecisions.stateStrategy}`,
    `持久化：${archDecisions.persistenceSetup}`,
  ];
  if (archDecisions.keyDecisions.length > 0) {
    lines.push(`关键决策：${archDecisions.keyDecisions.join(" / ")}`);
  }
  return lines.join("\n");
}
