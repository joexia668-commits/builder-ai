import type { Intent, PmOutput, IterationRound, Scene, SkeletonDefinition, ModuleDefinition } from "@/lib/types";

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
  currentFiles: Record<string, string>,
  archSummary?: string
): string {
  const fileList = Object.keys(currentFiles)
    .map((p) => `- ${p}`)
    .join("\n");

  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `<source file="${path}">\n${code}\n</source>`)
    .join("\n\n");

  const archBlock = archSummary
    ? `\n${archSummary}\n\n重要约束：你的任务是定向修复上述反馈中的问题，严禁重写、重构或添加未提及的功能。保持应用的整体架构、功能和 UI 不变。所有现有 import 必须保留，除非 import 的目标文件确实不存在。\n`
    : "";

  return `你是一位全栈工程师。根据用户反馈，精准修改以下多文件 React 应用。

用户反馈：${userPrompt}
${archBlock}
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
 * Builds context for the Decomposer agent from structured PM output.
 * Formats PM PRD summary, existing file paths, and scene types.
 */
export function buildDecomposerContext(
  pmOutput: PmOutput,
  existingFiles: string[],
  sceneTypes: Scene[]
): string {
  const sections: string[] = [];

  // PM PRD summary
  const prdLines = [
    `[意图]: ${pmOutput.intent}`,
    `[功能]: ${pmOutput.features.join(" / ")}`,
    `[持久化]: ${pmOutput.persistence}`,
    `[模块]: ${pmOutput.modules.join(" / ")}`,
  ];
  if (pmOutput.dataModel && pmOutput.dataModel.length > 0) {
    prdLines.push(`[数据模型]: ${pmOutput.dataModel.join(" / ")}`);
  }
  if (pmOutput.gameType) {
    prdLines.push(`[游戏类型]: ${pmOutput.gameType}`);
  }
  sections.push(`PM 产品需求文档（PRD）：\n${prdLines.join("\n")}`);

  // Existing file paths (for feature_add scenario)
  if (existingFiles.length > 0) {
    const fileList = existingFiles.map((p) => `- ${p}`).join("\n");
    sections.push(`当前已有文件（迭代时保留现有模块，只拆解新增部分）：\n${fileList}`);
  }

  // Scene types (if not general)
  const nonGeneralScenes = sceneTypes.filter((s) => s !== "general");
  if (nonGeneralScenes.length > 0) {
    sections.push(`场景类型：${nonGeneralScenes.join(", ")}`);
  }

  return sections.join("\n\n");
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

/**
 * Builds Architect context for the skeleton phase of the complex pipeline.
 * Instructs the Architect to produce only skeleton/layout files with placeholder modules.
 */
export function buildSkeletonArchitectContext(
  pmOutput: PmOutput,
  skeleton: SkeletonDefinition,
  existingFiles: Record<string, string>,
  sceneTypes: Scene[]
): string {
  const parts: string[] = [];
  parts.push("## 项目 PRD");
  parts.push(`意图: ${pmOutput.intent}`);
  parts.push(`功能: ${pmOutput.features.join(", ")}`);
  parts.push(`持久化: ${pmOutput.persistence}`);

  parts.push("\n## 骨架要求");
  parts.push(`描述: ${skeleton.description}`);
  parts.push(`文件: ${skeleton.files.join(", ")}`);
  if (skeleton.sharedTypes) {
    parts.push(`共享类型:\n${skeleton.sharedTypes}`);
  }

  if (Object.keys(existingFiles).length > 0) {
    const archSummary = deriveArchFromFiles(existingFiles);
    if (archSummary) parts.push(`\n## 已有架构\n${archSummary}`);
  }

  const nonGeneral = sceneTypes.filter((s) => s !== "general");
  if (nonGeneral.length > 0) {
    parts.push(`\n## 场景类型: ${nonGeneral.join(", ")}`);
  }

  parts.push("\n## 注意");
  parts.push("只生成骨架文件。功能模块用 placeholder 组件（显示模块名称即可）。");
  return parts.join("\n");
}

/**
 * Builds Architect context for a single module in the complex pipeline.
 * Provides the module definition, skeleton files for context, and export signatures
 * of already-completed modules so the Architect can define correct interfaces.
 */
export function buildModuleArchitectContext(
  pmOutput: PmOutput,
  module: ModuleDefinition,
  skeletonFiles: Record<string, string>,
  completedModuleFiles: Record<string, string>,
  sceneTypes: Scene[],
  registrySummary?: string,
  planPosition?: { layer: number; totalLayers: number },
  consumers?: string[],
  failedModules?: Array<{ name: string; reason: string }>
): string {
  const parts: string[] = [];
  parts.push("## 项目 PRD（摘要）");
  parts.push(`意图: ${pmOutput.intent}`);
  parts.push(`持久化: ${pmOutput.persistence}`);

  parts.push("\n## 当前模块");
  parts.push(`名称: ${module.name}`);
  parts.push(`描述: ${module.description}`);
  parts.push(`预计文件数: ${module.estimatedFiles}`);
  parts.push(`导出: ${module.interface.exports.join(", ")}`);
  parts.push(`消费: ${module.interface.consumes.join(", ")}`);
  parts.push(`状态契约: ${module.interface.stateContract}`);

  parts.push("\n## 骨架文件（已完成）");
  for (const [path, code] of Object.entries(skeletonFiles)) {
    parts.push(`// === ${path} ===\n${code}`);
  }

  if (registrySummary) {
    parts.push(`\n${registrySummary}`);
  } else if (Object.keys(completedModuleFiles).length > 0) {
    parts.push("\n## 已完成模块的导出签名");
    for (const [path, code] of Object.entries(completedModuleFiles)) {
      const exportLines = code.match(/^export\s+.+$/gm);
      if (exportLines) parts.push(`// ${path}: ${exportLines.join("; ")}`);
    }
  }

  if (planPosition) {
    parts.push(`\n## 当前模块在生成计划中的位置`);
    parts.push(`第 ${planPosition.layer} 层 / 共 ${planPosition.totalLayers} 层`);
  }

  if (consumers && consumers.length > 0) {
    parts.push(`\n## 下游消费者`);
    parts.push(`以下模块将消费你的导出:`);
    for (const c of consumers) {
      parts.push(`- ${c}`);
    }
  }

  if (failedModules && failedModules.length > 0) {
    parts.push(`\n## 失败模块`);
    for (const f of failedModules) {
      parts.push(`${f.name}: ${f.reason}`);
    }
  }

  const nonGeneral = sceneTypes.filter((s) => s !== "general");
  if (nonGeneral.length > 0) {
    parts.push(`\n## 场景类型: ${nonGeneral.join(", ")}`);
  }

  return parts.join("\n");
}

/**
 * Builds Engineer context for the auto-fix loop.
 * Receives formatted error strings from the error-collector and current source files.
 * Instructs the Engineer to surgically fix only the reported errors.
 */
export function buildAutoFixContext(
  formattedErrors: string,
  currentFiles: Record<string, string>
): string {
  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `// === FILE: ${path} ===\n${code}`)
    .join("\n\n");

  return `【自动修复模式 — WebContainer 检测到以下错误】

${formattedErrors}

当前代码：
${filesSection}

修复要求：
1. 只修改导致上述错误的文件，未受影响的文件不要输出
2. 不要重构、不要加新功能、不要修改 UI 样式
3. 确保所有 import 路径正确，引用的文件确实存在
4. 确保所有变量在使用前已定义
5. 确保所有括号/花括号/方括号配对

输出格式：
- 每个修改的文件以 // === FILE: /path === 开头
- 紧接完整修改后代码
- 不输出 Markdown 围栏或解释文字`;
}
