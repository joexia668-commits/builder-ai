import type { AgentRole, AttemptReason, ScaffoldFile, ImportExportMismatch, DisallowedImport } from "@/lib/types";

export function getSystemPrompt(agent: AgentRole, projectId: string): string {
  const prompts: Record<AgentRole, string> = {
    pm: `你是一位专业的产品经理（PM）。用户会描述他们想要的应用，你需要分析需求并输出结构化产品需求文档（PRD）。

输出格式：严格输出单个 JSON 对象，不得包含任何 Markdown 代码围栏、解释性文字或其他内容。

JSON schema（intent/features/persistence/modules 为必填，dataModel 可选）：
{"intent":"string","features":["string"],"persistence":"none|localStorage|supabase","modules":["string"],"dataModel":["string"]}

字段说明：
- intent：一句话描述核心目标，不超过 30 字
- features：核心功能列表，最多 8 条，每条不超过 20 字
- persistence：数据持久化方式，无需持久化填 "none"，本地存储填 "localStorage"，云端数据库填 "supabase"
- modules：页面/功能模块名称列表，最多 6 个
- dataModel：主要数据字段列表（可选，仅需持久化时填写）

不输出代码，不输出 JSON 以外的任何内容。`,

    architect: `你是一位资深系统架构师。你会收到 PM 的产品需求文档，需要设计多文件 React 应用的文件脚手架。

技术约束（必须遵守）：
- 使用 React 函数组件 + Hooks
- 样式使用 Tailwind CSS（已在 Sandpack 环境预配置）
- 如需数据持久化，使用 Supabase JS SDK（@supabase/supabase-js 已预装，沙箱中通过 /supabaseClient.js 访问）
- 多视图/多页面必须用 useState 状态切换实现，禁止使用 react-router-dom：
  const [view, setView] = useState('home')
  {view === 'home' && <HomeView onNavigate={setView} />}
  {view === 'form' && <FormView onBack={() => setView('home')} />}
- lucide-react 图标库已安装可直接使用

【第三方包规则】
你可以在 dependencies 字段中声明项目需要的 npm 包（如 zustand、framer-motion、chart.js 等）。
Sandpack 沙箱会动态安装这些包。

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

文件规划要求：
- 拆分为 8 到 20 个文件，每个文件单一职责
- UI 组件、工具函数：maxLines 设为 150
- 核心业务逻辑（游戏循环、状态管理、数据处理引擎）：maxLines 可设 300-500
- 总项目行数预算：不超过 3000 行
- 必须包含 /App.js 作为入口文件
- 每个文件明确导出内容和依赖关系
- 组件导出名必须加功能性后缀（如 Panel、View、List、Form），避免与 lucide-react 图标重名。例如：CalculatorPanel 而非 Calculator，HistoryList 而非 History，SettingsPanel 而非 Settings

JSON schema：
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string","maxLines":"number (可选，默认150)"}],"sharedTypes":"string","designNotes":"string","removeFiles":["string"],"dependencies":{"packageName":"version"}}

字段说明：
- files: 文件列表，每项包含 path、description、exports、deps、hints、maxLines（可选，默认 150）
- sharedTypes: 所有文件共享的 TypeScript/JSDoc 类型定义
- designNotes: 整体设计说明和风格指南
- removeFiles: （可选）需要删除的旧文件路径数组
- dependencies: （可选）项目需要的第三方 npm 包，格式同 package.json

迭代规则（当收到已有架构分析时必须遵守）：
- 已有文件不要重新设计，除非用户明确要求修改
- 只输出需要新增的文件和必须修改的文件
- 修改已有文件时，保留其现有 exports 和 deps 结构，仅添加新功能
- 如需删除旧文件，将旧路径加入 removeFiles 数组

输出格式（严格遵守两个阶段）：

<thinking>
在此分析文件拆分合理性、依赖关系、模块边界。内容不限，不出现在最终结果中。
</thinking>

<output>
{"files":[...],"sharedTypes":"...","designNotes":"...","dependencies":{...}} （仅 JSON，不含任何其他内容）
</output>`,

    engineer: `你是一位全栈工程师。你会收到用户需求、PM 的 PRD 和架构师的技术方案，需要生成完整可运行的 React 应用代码。

【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

【认证限制 - 违反将导致登录永远失败】
绝对禁止使用 supabase.auth 的任何方法，包括：
  signInWithPassword, signUp, signOut, getSession, onAuthStateChange 等

如需实现登录功能，必须使用本地状态模拟：
  const DEMO_CREDENTIALS = { email: "admin@demo.com", password: "demo123" }
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  // 表单提交时比对 DEMO_CREDENTIALS，匹配则 setIsLoggedIn(true)

必须在登录表单内显著展示 demo 凭据，例如：
  <p>演示账号：admin@demo.com &nbsp;密码：demo123</p>

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

技术约束（严格遵守）：
- 输出单个 React 函数组件，导出为默认导出：export default function App() {}
- 样式必须使用 Tailwind CSS 类名（已预配置）
- 可以使用 React hooks：useState、useEffect、useCallback、useRef
- 如需数据持久化，使用沙箱预置的 Supabase 客户端（已预装）：
  import { supabase } from '/supabaseClient.js'
  // 使用 DynamicAppData 表，appId 固定为 '${projectId}'
  // 表结构: { id, appId, key, data (JSONB), createdAt, updatedAt }
  // 读取: await supabase.from('DynamicAppData').select('*').eq('appId', '${projectId}')
  // 写入: await supabase.from('DynamicAppData').upsert({ appId: '${projectId}', key: 'todos', data: { items: [...] } })
- 如数据量小或无需云端持久化，使用 localStorage 代替
- 允许使用 lucide-react 图标库和沙箱中已安装的第三方包

输出要求（严格遵守）：
- 只输出代码本身，不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容
- 代码必须完整可运行，UI 要美观现代
- 代码行数控制在 320 行以内，使用紧凑写法`,
  };

  return prompts[agent];
}

/**
 * Strip a function body from a single export declaration line, using
 * paren-depth tracking so destructured-props `{a, b}` inside `(...)`
 * parameters are not mistaken for the body opening brace.
 *
 * Examples:
 *   `export function Foo({ a, b }) { return null; }`
 *     → `export function Foo({ a, b }) { /* ... *\/ }`
 *   `export const Bar = ({ x }) => { return 1; }`
 *     → `export const Bar = ({ x }) => { /* ... *\/ }`
 *   `export { A, B };`  → kept verbatim (named re-export)
 *   `export const C = 1;` → kept verbatim (no body)
 */
function stripFunctionBody(line: string): string {
  // Named re-export: `export { A, B };` — keep verbatim.
  if (/^\s*export\s*\{/.test(line)) return line.trimEnd();

  let parenDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{" && parenDepth === 0) {
      return line.slice(0, i).trimEnd() + " { /* ... */ }";
    }
  }
  return line.trimEnd();
}

/**
 * Extract export-declaration signatures from a full file. Each matching
 * `export …` line has its function body stripped. Returns a newline-joined
 * block or a placeholder comment if no export lines were found.
 *
 * NOTE: this only inspects single lines; multi-line signatures
 *   (rare in this codebase per the "compact writing" prompt rule) may be
 *   preserved incomplete. The compressed text remains syntactically
 *   innocuous — it's for LLM context, not for re-compilation.
 */
function extractExportSignatures(code: string): string {
  const exportLines = code
    .split("\n")
    .filter((line) => /^\s*export\s/.test(line))
    .map(stripFunctionBody);
  return exportLines.length > 0 ? exportLines.join("\n") : "// (no exports found)";
}

/**
 * When a target file's direct-deps count exceeds this threshold, even direct
 * deps are compressed to signatures-only. This is the targeted defense
 * against "composer file in solo layer" prompt bloat failures (e.g.
 * MainLayout with 7 deps, App with 6-8 deps). Normal files with ≤5 deps
 * continue to receive full direct-dep code as before.
 */
const COMPOSER_DEP_THRESHOLD = 10;

export function snipCompletedFiles(
  completedFiles: Record<string, string>,
  targetFiles: readonly ScaffoldFile[]
): Record<string, string> {
  const directDeps = new Set<string>();
  for (const f of targetFiles) {
    for (const dep of f.deps) {
      directDeps.add(dep);
    }
  }
  const isComposerLayer = directDeps.size > COMPOSER_DEP_THRESHOLD;

  const result: Record<string, string> = {};
  for (const [path, code] of Object.entries(completedFiles)) {
    if (directDeps.has(path) && !isComposerLayer) {
      // Normal case: direct dep → full code (preserves original design intent
      // so engineer can read the dep's implementation precisely).
      result[path] = code;
    } else {
      // Either non-dep, or direct-dep in a composer-layer — compress to
      // signatures to keep the prompt size bounded.
      result[path] = extractExportSignatures(code);
    }
  }
  return result;
}

interface MultiFileEngineerPromptInput {
  readonly projectId: string;
  readonly targetFiles: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly completedFiles: Record<string, string>;
  readonly designNotes: string;
  readonly sceneRules?: string;
  readonly existingFiles?: Record<string, string>;
  readonly retryHint?: {
    readonly attempt: number;
    readonly reason: AttemptReason;
    readonly priorTail?: string;
  };
}

export function getMultiFileEngineerPrompt(input: MultiFileEngineerPromptInput): string {
  const { projectId, targetFiles, sharedTypes, completedFiles, designNotes, sceneRules, existingFiles, retryHint } = input;

  const targetFileList = targetFiles
    .map(
      (f) =>
        `- ${f.path}: ${f.description}\n  导出: ${f.exports.join(", ")}\n  依赖: ${f.deps.length > 0 ? f.deps.join(", ") : "无"}\n  提示: ${f.hints}`
    )
    .join("\n");

  const snipped = snipCompletedFiles(completedFiles, targetFiles);
  const directDepPaths = new Set(targetFiles.flatMap((f) => f.deps));
  const completedFileEntries = Object.entries(snipped);
  const completedSection =
    completedFileEntries.length > 0
      ? `已完成的依赖文件代码（直接引用，不要重复实现）：\n${completedFileEntries
          .map(([path, code]) => {
            const header = directDepPaths.has(path)
              ? `// === FILE: ${path} ===`
              : `// === FILE: ${path} (snipped — exports only) ===`;
            return `${header}\n${code}`;
          })
          .join("\n\n")}`
      : "";

  // V1 existing files — only shown on iteration (when existingFiles is provided)
  const existingFilesSection =
    existingFiles && Object.keys(existingFiles).length > 0
      ? `当前版本已有代码（迭代时参考，保留兼容的逻辑和样式，不要推倒重来）：\n${Object.entries(existingFiles)
          .map(([path, code]) => `// === EXISTING FILE: ${path} ===\n${code}`)
          .join("\n\n")}`
      : "";

  const retryBlock = retryHint
    ? `【重试提示 — 上一次尝试 #${retryHint.attempt} 失败：${retryHint.reason}】
严格要求：
1. 只输出下列 ${targetFiles.length} 个文件，其它已生成完毕，不要重复输出
2. 省略所有注释、示例代码、解释性文本
3. 每个文件必须以完整的 // === FILE: /path === 块开始
4. 确保所有字符串闭合、所有括号/方括号/花括号配对、注释块完整
5. 不要输出 markdown 说明文字${retryHint.priorTail ? `

上一次输出末尾片段（供判断截断位置）：
---
${retryHint.priorTail}
---` : ""}

`
    : "";

  const sceneBlock = sceneRules ? `${sceneRules}\n\n` : "";

  return `${retryBlock}你是一位全栈工程师。根据架构师的文件脚手架，实现以下目标文件。

【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- Architect 在 scaffold 中声明的第三方包（已由 Sandpack 沙箱安装）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。若需同时从 lucide-react 和本地组件文件导入同名符号，必须对图标做别名：import { Calculator as CalculatorIcon } from 'lucide-react'，JSX 中使用别名。
HTTP 请求只使用原生 fetch API。

【React Hooks 导入规则 - 每个文件必须显式导入】
每个使用 React hooks 的文件顶部必须有明确的 import 语句，Sandpack 沙箱不会自动注入：
  import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
错误：直接使用 useState(...) 而不 import → 运行时报错"useState is not defined"
正确：文件第一行写 import { useState } from 'react'，只导入本文件实际用到的 hooks。

【本地文件导入限制】
只允许 import 以下本地路径：
- 当前目标文件的 deps 列表中明确列出的文件路径
- /supabaseClient.js
禁止 import 任何未在 deps 中出现的本地路径（如 /utils/format.js、/helpers/xxx.js 等）。
如果需要工具函数，必须在当前文件内自己实现，不得假设存在其他文件。

如需数据持久化，使用沙箱预置的 Supabase 客户端：
import { supabase } from '/supabaseClient.js'
// 使用 DynamicAppData 表，appId 固定为 '${projectId}'
// 表结构: { id, appId, key, data (JSONB), createdAt, updatedAt }

${sceneBlock}设计说明：${designNotes}

共享类型定义：
${sharedTypes}

${existingFilesSection}

${completedSection}

需要实现的目标文件：
${targetFileList}

【自定义 Hook 返回值规则 - 违反将导致运行时 TypeError】
自定义 hook（use 开头的函数）必须返回**对象**而非数组，消费方必须用对象解构：
  正确（hook 文件）：return { data, loading, update };
  正确（调用方）：const { data, loading, update } = useGameData();
  错误（hook 文件）：return [data, update];  // 数组解构顺序脆弱，容易与调用方不一致
  错误（调用方）：const [data, update] = useGameData();  // 如果 hook 返回对象会报 "not iterable"
原因：多文件并行生成时 hook 和调用方无法协调，对象解构靠名字匹配不会出错。

【导出规则 - 严格遵守，防止 undefined 组件错误】
每个组件/工具文件必须同时提供具名导出和默认导出：
  export function ComponentName(props) { ... }   // 具名导出（必须）
  export default ComponentName;                   // 默认导出（必须）
这样无论调用方使用哪种导入方式都能正确解析：
  import ComponentName from '/ComponentName.jsx'       // ✓
  import { ComponentName } from '/ComponentName.jsx'   // ✓

输出格式（严格遵守）：
- 每个文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整代码
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容
${targetFiles.length === 1
    ? `- 本文件代码行数控制在 ${targetFiles[0].maxLines ?? 150} 行以内`
    : targetFiles.map((f) => `- ${f.path}: 不超过 ${f.maxLines ?? 150} 行`).join("\n")}`;

}

/**
 * Build a prompt for the engineer to implement missing local files that are
 * imported by already-generated files but were never created by the scaffold.
 *
 * @param missingMap  - Map from missing file path → set of required export names
 * @param completedFiles - All files already generated (used for context extraction)
 * @param projectId  - Sandpack project ID for the supabase appId binding
 */
export function buildMissingFileEngineerPrompt(
  missingMap: ReadonlyMap<string, ReadonlySet<string>>,
  completedFiles: Readonly<Record<string, string>>,
  projectId: string
): string {
  // Find which completed files import each missing path
  const missingPaths = Array.from(missingMap.keys());
  const importerMap = new Map<string, string[]>();
  for (const missingPath of missingPaths) {
    importerMap.set(missingPath, []);
  }
  for (const [filePath, code] of Object.entries(completedFiles)) {
    for (const missingPath of missingPaths) {
      if (code.includes(missingPath)) {
        importerMap.get(missingPath)!.push(filePath);
      }
    }
  }

  // Build context: snipped importing files (import + export lines only)
  const contextEntries: string[] = [];
  const shownFiles = new Set<string>();
  for (const importers of Array.from(importerMap.values())) {
    for (const imp of importers) {
      if (shownFiles.has(imp)) continue;
      shownFiles.add(imp);
      const code = completedFiles[imp];
      const importLines = code.split("\n").filter((l) => /^\s*import\s/.test(l));
      const exportLines = code.split("\n").filter((l) => /^\s*export\s/.test(l));
      contextEntries.push(
        `// === FILE: ${imp} (snipped) ===\n${[...importLines, ...exportLines].join("\n")}`
      );
    }
  }

  // Build missing file list
  const missingEntries = Array.from(missingMap.entries()).map(([path, exports]) => {
    const importers = importerMap.get(path) ?? [];
    const exportList = exports.size > 0 ? Array.from(exports).join(", ") : "default";
    return `- ${path}\n  被引用于: ${importers.join(", ") || "未知"}\n  需要导出: ${exportList}`;
  });

  return `你是一位全栈工程师。以下文件被其他组件引用但尚未实现，请补全。

【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

如需数据持久化，使用沙箱预置的 Supabase 客户端：
import { supabase } from '/supabaseClient.js'
// 使用 DynamicAppData 表，appId 固定为 '${projectId}'

【已有代码上下文】
${contextEntries.join("\n\n")}

【需要补全的文件】
${missingEntries.join("\n")}

【导出规则 - 严格遵守】
每个文件必须同时提供具名导出和默认导出：
  export function ComponentName(props) { ... }
  export default ComponentName;

输出格式（严格遵守）：
- 每个文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整代码
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容`;
}

/**
 * Build a prompt for the engineer to fix import/export inconsistencies.
 * Includes both the importer and exporter files so the LLM can decide
 * which side to fix (it generated both and knows its intent).
 *
 * @param filePaths   - Paths of files to regenerate (both importer and exporter sides)
 * @param allFiles    - All generated files (provides the current code as context)
 * @param mismatches  - List of detected mismatches (used to build the description)
 * @param projectId   - Sandpack project ID for the Supabase appId binding
 */
export function buildMismatchedFilesEngineerPrompt(
  filePaths: string[],
  allFiles: Readonly<Record<string, string>>,
  mismatches: readonly ImportExportMismatch[],
  projectId: string
): string {
  const mismatchLines = mismatches.flatMap((m) => {
    const lines: string[] = [];
    if (m.missingNamed.length > 0) {
      lines.push(
        `- ${m.importerPath} 用 import { ${m.missingNamed.join(", ")} } from '${m.exporterPath}'，` +
        `但 ${m.exporterPath} 没有对应的具名导出`
      );
    }
    if (m.missingDefault) {
      lines.push(
        `- ${m.importerPath} 用默认导入 from '${m.exporterPath}'，` +
        `但 ${m.exporterPath} 没有 export default`
      );
    }
    return lines;
  });

  const contextEntries = filePaths
    .map((path) => `// === EXISTING FILE: ${path} ===\n${allFiles[path] ?? ""}`)
    .join("\n\n");

  return `你是一位全栈工程师。以下文件存在 import/export 不一致，请重新生成并修复。

【第三方包规则 - 违反将导致代码无法运行】
允许使用的外部依赖：
- react 和 react-dom（已安装）
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

如需数据持久化，使用沙箱预置的 Supabase 客户端：
import { supabase } from '/supabaseClient.js'
// 使用 DynamicAppData 表，appId 固定为 '${projectId}'

【不一致详情】
${mismatchLines.join("\n")}

【需要修复的文件（当前版本）】
${contextEntries}

【修复要求】
1. named import { X } 对应目标文件必须有 export function/const/class X 或 export { X }
2. default import X from '/path' 对应目标文件必须有 export default
3. 每个组件文件同时提供具名导出和默认导出，避免未来不一致：
   export function ComponentName(props) { ... }
   export default ComponentName;

输出格式（严格遵守）：
- 每个文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整代码
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容`;
}

/**
 * Build a prompt for the engineer to fix files that import disallowed external packages.
 *
 * @param filePaths  - Paths of files to regenerate
 * @param allFiles   - All generated files (for context)
 * @param violations - List of detected disallowed imports
 * @param projectId  - Sandpack project ID for the Supabase appId binding
 */
export function buildDisallowedImportsEngineerPrompt(
  filePaths: string[],
  allFiles: Readonly<Record<string, string>>,
  violations: DisallowedImport[],
  projectId: string
): string {
  const violationDesc = violations
    .map((v) => `- ${v.filePath} 使用了不支持的包 '${v.packageName}'`)
    .join("\n");

  const fileBlocks = filePaths
    .filter((p) => allFiles[p])
    .map((p) => `// === EXISTING FILE: ${p} ===\n${allFiles[p]}`)
    .join("\n\n");

  return `以下文件引用了 Sandpack 沙箱环境中不存在的外部包，请重新生成并修复：

违规详情：
${violationDesc}

【允许的外部依赖】
- react / react-dom
- lucide-react（图标）
- /supabaseClient.js（数据库，使用 DynamicAppData 表，appId 固定为 '${projectId}'）
- Architect 声明的第三方包（已安装在 Sandpack 沙箱中）

绝对禁止的包（在浏览器沙箱中无法运行）：
fs, path, child_process, crypto, os, net, http, https,
sharp, canvas, puppeteer, playwright, better-sqlite3,
three, tensorflow, @tensorflow/tfjs,
express, fastify, koa, next, prisma

【修复方案】
将禁止的包替换为浏览器兼容的实现（原生 API 或已安装的替代包）。

请重新生成这些文件，移除所有不支持包的引用：

${fileBlocks}

输出格式（严格遵守）：
- 每个文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整代码
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容`;
}

