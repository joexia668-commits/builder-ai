import type { AgentRole, ScaffoldFile } from "@/lib/types";

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
- 如需数据持久化，使用 Supabase JS SDK（@supabase/supabase-js 已预装）
- 不使用 Next.js、路由、或任何 Node.js API
- 允许使用 lucide-react 图标库；绝对禁止使用 recharts、framer-motion 等其他外部库

【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）

绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

文件规划要求：
- 拆分为 8 到 20 个文件，每个文件单一职责，不超过 150 行
- 必须包含 /App.js 作为入口文件
- 每个文件明确导出内容和依赖关系

JSON schema：
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string"}],"sharedTypes":"string","designNotes":"string"}

字段说明：
- files: 文件列表，每项包含 path（文件路径）、description（职责描述）、exports（导出列表）、deps（依赖的其他文件路径）、hints（实现提示）
- sharedTypes: 所有文件共享的 TypeScript/JSDoc 类型定义
- designNotes: 整体设计说明和风格指南

输出格式（严格遵守两个阶段）：

<thinking>
在此分析文件拆分合理性、依赖关系、模块边界。内容不限，不出现在最终结果中。
</thinking>

<output>
{"files":[...],"sharedTypes":"...","designNotes":"..."} （仅 JSON，不含任何其他内容）
</output>`,

    engineer: `你是一位全栈工程师。你会收到用户需求、PM 的 PRD 和架构师的技术方案，需要生成完整可运行的 React 应用代码。

【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）

绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

技术约束（严格遵守）：
- 输出单个 React 函数组件，导出为默认导出：export default function App() {}
- 样式必须使用 Tailwind CSS 类名（已预配置）
- 可以使用 React hooks：useState、useEffect、useCallback、useRef
- 如需数据持久化，使用沙箱预置的 Supabase 客户端（已预装）：
  import { supabase } from '/supabaseClient.js'
  // 使用 dynamic_app_data 表，appId 固定为 '${projectId}'
  // 表结构: { id, appId, key, data (JSONB), createdAt, updatedAt }
  // 读取: await supabase.from('dynamic_app_data').select('*').eq('appId', '${projectId}')
  // 写入: await supabase.from('dynamic_app_data').upsert({ appId: '${projectId}', key: 'todos', data: { items: [...] } })
- 如数据量小或无需云端持久化，使用 localStorage 代替
- 允许使用 lucide-react 图标库；绝对禁止使用 recharts、framer-motion 等其他外部库；本地文件只允许 import { supabase } from '/supabaseClient.js'

输出要求（严格遵守）：
- 只输出代码本身，不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容
- 代码必须完整可运行，UI 要美观现代
- 代码行数控制在 320 行以内，不写注释，使用紧凑写法`,
  };

  return prompts[agent];
}

function extractExportSignatures(code: string): string {
  const exportLines = code
    .split("\n")
    .filter((line) => /^export\s/.test(line))
    .map((line) => line.replace(/\s*\{[^}]*\}.*$/, " {}").replace(/\s*=.*$/, "").trimEnd());
  return exportLines.length > 0 ? exportLines.join("\n") : "// (no exports found)";
}

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

  const result: Record<string, string> = {};
  for (const [path, code] of Object.entries(completedFiles)) {
    if (directDeps.has(path)) {
      result[path] = code;
    } else {
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
}

export function getMultiFileEngineerPrompt(input: MultiFileEngineerPromptInput): string {
  const { projectId, targetFiles, sharedTypes, completedFiles, designNotes } = input;

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

  return `你是一位全栈工程师。根据架构师的文件脚手架，实现以下目标文件。

【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）

绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

如需数据持久化，使用沙箱预置的 Supabase 客户端：
import { supabase } from '/supabaseClient.js'
// 使用 dynamic_app_data 表，appId 固定为 '${projectId}'
// 表结构: { id, appId, key, data (JSONB), createdAt, updatedAt }

设计说明：${designNotes}

共享类型定义：
${sharedTypes}

${completedSection}

需要实现的目标文件：
${targetFileList}

输出格式（严格遵守）：
- 每个文件以分隔符开头：// === FILE: /path ===
- 紧接着是该文件的完整代码
- 不得包含 \`\`\`jsx、\`\`\`js、\`\`\` 等 Markdown 代码围栏
- 不输出任何解释性文字，代码即全部内容
- 每个文件不超过 150 行，使用紧凑写法`;
}
