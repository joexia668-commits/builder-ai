import type { Intent, PmOutput, IterationRound } from "@/lib/types";

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

输出格式（严格遵守，违反将导致解析失败）：
- 只输出你实际需要修改的文件，未修改的文件不要输出——它们会被自动保留
- 每个修改的文件必须以分隔符开头：// === FILE: /path ===（即使只改了一行也必须输出完整文件）
- 紧接着是该文件的完整修改后代码
- 严禁输出 \`\`\`jsx、\`\`\`js、\`\`\` 等任何 Markdown 代码围栏
- 严禁输出解释性文字、摘要、注释说明
- 第一个字符必须是 /（分隔符的斜杠），不得有任何前置文字`;
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
    if (r.pmSummary) {
      const features = r.pmSummary.features.join("、");
      return `[第${i + 1}轮] 用户："${r.userPrompt}"\n  意图：${r.pmSummary.intent} / 功能：${features} / 持久化：${r.pmSummary.persistence}`;
    }
    return `[第${i + 1}轮] 用户："${r.userPrompt}" (${label}，跳过PM)`;
  });

  return header + "\n" + roundLines.join("\n\n");
}

/**
 * Builds context for the triage phase.
 * Asks the LLM to analyze which files need modification based on user feedback.
 * Returns a structured prompt that expects JSON array output.
 */
export function buildTriageContext(
  userPrompt: string,
  filePaths: string[]
): string {
  const pathList = filePaths.map((p) => `- ${p}`).join("\n");

  return `你是一位代码分析助手。根据用户反馈，判断以下 React 应用中哪些文件需要修改。

用户反馈：${userPrompt}

文件列表：
${pathList}

只输出一个 JSON 数组，包含需要修改的文件路径，不输出其他内容。
示例：["/App.js", "/components/Layout.js"]`;
}

/**
 * Derives a structured architecture summary from existing source files.
 * Pure string analysis — zero LLM calls. Replaces the old buildArchIterationContext
 * which relied on saved archDecisions from iterationContext.
 */
export function deriveArchFromFiles(files: Record<string, string>): string {
  const entries = Object.entries(files);
  if (entries.length === 0) return "";

  const EXPORT_RE = /export\s+(default\s+)?(?:function|const|class)\s+(\w+)/g;
  const IMPORT_RE = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  const STATE_KEYWORDS = ["useState", "useReducer", "useContext", "createContext"] as const;

  const fileInfos: Array<{
    path: string;
    lines: number;
    exports: string[];
    localDeps: string[];
  }> = [];

  const allCode = entries.map(([, code]) => code).join("\n");

  for (const [path, code] of entries) {
    const lines = code.split("\n").length;

    const exports: string[] = [];
    let m: RegExpExecArray | null;
    const exportRe = new RegExp(EXPORT_RE.source, EXPORT_RE.flags);
    while ((m = exportRe.exec(code)) !== null) {
      const isDefault = Boolean(m[1]?.trim());
      exports.push(isDefault ? `${m[2]} (default)` : m[2]);
    }

    const localDeps: string[] = [];
    const importRe = new RegExp(IMPORT_RE.source, IMPORT_RE.flags);
    while ((m = importRe.exec(code)) !== null) {
      const source = m[1];
      if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) {
        if (source !== "/supabaseClient.js") {
          localDeps.push(source);
        }
      }
    }

    fileInfos.push({ path, lines, exports, localDeps });
  }

  const fileListLines = fileInfos.map((f) => {
    const exportsStr = f.exports.length > 0 ? f.exports.join(", ") : "(no exports)";
    return `  ${f.path} (${f.lines} lines) — exports: ${exportsStr}`;
  });

  const depLines = fileInfos
    .filter((f) => f.localDeps.length > 0)
    .map((f) => `  ${f.path} → [${f.localDeps.join(", ")}]`);

  const detectedState = STATE_KEYWORDS.filter((kw) => allCode.includes(kw));
  const stateStr = detectedState.length > 0 ? detectedState.join(", ") : "none detected";

  const persistence: string[] = [];
  if (allCode.includes("supabase")) persistence.push("Supabase");
  if (allCode.includes("localStorage")) persistence.push("localStorage");
  const persistStr = persistence.length > 0 ? persistence.join(", ") : "none";

  const sections = [
    `当前应用架构（从代码实时分析，请在此基础上增量修改）：`,
    ``,
    `文件结构（${entries.length} 个文件）：`,
    ...fileListLines,
  ];

  if (depLines.length > 0) {
    sections.push(``, `依赖关系：`, ...depLines);
  }

  sections.push(``, `状态管理：${stateStr}`);
  sections.push(`持久化：${persistStr}`);

  return sections.join("\n");
}
