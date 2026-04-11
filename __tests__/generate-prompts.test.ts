import { getSystemPrompt, getMultiFileEngineerPrompt, snipCompletedFiles } from "@/lib/generate-prompts";
import type { AgentRole, ScaffoldFile } from "@/lib/types";

describe("getSystemPrompt", () => {
  const projectId = "test-project-123";

  // UT-09: engineer prompt explicitly PROHIBITS markdown fences in output
  // The prompt says "不得包含 ```jsx" — i.e., instructs the model NOT to use fences.
  // This verifies the prompt contains a prohibition (not an instruction to use fences).
  it("UT-09: engineer 系统提示词明确禁止输出 Markdown 代码围栏（不包含「输出```jsx」类指令）", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    // Must contain the prohibition instruction
    expect(prompt).toContain("不得包含");
    // Must NOT instruct the model to wrap code in fences
    expect(prompt).not.toMatch(/请.*用\s*```jsx/);
    expect(prompt).not.toMatch(/输出.*格式.*```jsx/);
    // The mention of ```jsx should be in the prohibition context
    expect(prompt).toMatch(/不得包含.*```jsx/);
  });

  // IT-06: engineer prompt must contain "只输出代码本身"
  it("IT-06: engineer 系统提示词包含「只输出代码本身」的指令", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("只输出代码本身");
  });

  it("engineer 提示词包含 export default function App() 的要求", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("export default function App()");
  });

  it("engineer 提示词包含项目 ID", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain(projectId);
  });

  it("pm 提示词包含 PRD 输出格式说明", () => {
    const prompt = getSystemPrompt("pm", projectId);
    expect(prompt).toContain("产品需求文档");
    expect(prompt).not.toContain("```jsx");
  });

  // GP-JSON-01: PM prompt instructs output of intent field
  it("GP-JSON-01: pm 提示词包含 intent 字段说明", () => {
    const prompt = getSystemPrompt("pm", projectId);
    expect(prompt).toContain("intent");
  });

  // GP-JSON-02: PM prompt includes persistence enum values
  it("GP-JSON-02: pm 提示词包含 persistence 枚举值说明", () => {
    const prompt = getSystemPrompt("pm", projectId);
    expect(prompt).toContain("persistence");
    expect(prompt).toContain("localStorage");
    expect(prompt).toContain("supabase");
  });

  // GP-JSON-03: PM prompt includes features array field
  it("GP-JSON-03: pm 提示词包含 features 数组字段说明", () => {
    const prompt = getSystemPrompt("pm", projectId);
    expect(prompt).toContain("features");
  });

  // GP-JSON-04: PM prompt instructs not to output markdown fences
  it("GP-JSON-04: pm 提示词禁止输出 Markdown 代码围栏", () => {
    const prompt = getSystemPrompt("pm", projectId);
    expect(prompt).toMatch(/不得包含.*围栏|不得包含.*Markdown|Markdown.*围栏/);
  });

  // GP-JSON-05: PM prompt is concise (≤ 600 chars to keep token usage low)
  it("GP-JSON-05: pm 提示词长度不超过 600 字符", () => {
    const prompt = getSystemPrompt("pm", projectId);
    expect(prompt.length).toBeLessThanOrEqual(600);
  });

  it("architect 提示词包含 React 技术约束", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toContain("React");
    expect(prompt).toContain("Tailwind CSS");
  });

  // Epic 2: engineer prompt should use /supabaseClient.js import, not inline credentials
  it("engineer 提示词使用 /supabaseClient.js 导入而非内联 createClient", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("/supabaseClient.js");
    // Should NOT tell AI to call createClient directly with raw credentials
    expect(prompt).not.toMatch(/createClient\('[^']*', '[^']*'\)/);
  });

  it("engineer 提示词中 supabase 导入路径使用单引号", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("from '/supabaseClient.js'");
  });

  it("返回所有三种 agent 角色的提示词", () => {
    const roles: AgentRole[] = ["pm", "architect", "engineer"];
    roles.forEach((role) => {
      const prompt = getSystemPrompt(role, projectId);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  // GP-PKG-01: engineer prompt 包含 lucide-react 在允许列表中 (EPIC 5 Step 4)
  it("GP-PKG-01: engineer 提示词包含 lucide-react 在允许依赖列表中", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("lucide-react");
  });

  // GP-PKG-02: engineer prompt 包含 recharts 在禁止列表中
  it("GP-PKG-02: engineer 提示词明确禁止使用 recharts", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("recharts");
    const forbiddenIdx = prompt.indexOf("绝对禁止");
    const rechartsIdx = prompt.indexOf("recharts");
    expect(forbiddenIdx).toBeGreaterThanOrEqual(0);
    expect(rechartsIdx).toBeGreaterThan(forbiddenIdx);
  });

  // GP-PKG-03: engineer prompt 包含 framer-motion 在禁止列表中
  it("GP-PKG-03: engineer 提示词明确禁止使用 framer-motion", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("framer-motion");
  });

  // GP-PKG-04: engineer prompt 包含包限制指令标识
  it("GP-PKG-04: engineer 提示词包含「绝对禁止」包限制指令", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("绝对禁止");
  });

  // GP-PKG-05: architect prompt 也包含包限制约束
  it("GP-PKG-05: architect 提示词也包含包限制约束（lucide-react 允许）", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toContain("lucide-react");
  });

  // GP-PKG-06: architect prompt 包含禁止指令
  it("GP-PKG-06: architect 提示词包含 lucide-react 并有「绝对禁止」指令", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toContain("lucide-react");
    expect(prompt).toContain("绝对禁止");
  });

  // GP-ARCH-JSON-01: architect prompt outputs structured JSON scaffold
  it("GP-ARCH-JSON-01: architect 提示词要求输出 JSON 且包含 files/path/deps 字段", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain('"files"');
    expect(prompt).toContain('"path"');
    expect(prompt).toContain('"deps"');
  });

  // GP-ARCH-JSON-02: architect prompt specifies file count constraint 8-20
  it("GP-ARCH-JSON-02: architect 提示词包含 8-20 文件数量约束", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toMatch(/8.*20/);
  });

  // GP-ARCH-JSON-03: architect prompt includes supabaseClient.js reference
  it("GP-ARCH-JSON-03: architect 提示词包含 supabaseClient.js 引用", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toContain("supabaseClient.js");
  });

  // GP-ARCH-NAMING-01: architect prompt must require functional suffix on component exports
  it("GP-ARCH-NAMING-01: architect 提示词要求组件导出名加功能性后缀，避免与 lucide-react 图标重名", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).toContain("Panel");
    expect(prompt).toContain("CalculatorPanel");
    expect(prompt).toContain("lucide-react 图标重名");
  });

  // GP-AUTH-01: engineer prompt bans supabase.auth methods
  it("GP-AUTH-01: engineer 提示词禁止使用 supabase.auth 方法", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    const forbiddenIdx = prompt.indexOf("绝对禁止使用 supabase.auth");
    expect(forbiddenIdx).toBeGreaterThanOrEqual(0);
    const authIdx = prompt.indexOf("supabase.auth");
    expect(authIdx).toBeGreaterThanOrEqual(forbiddenIdx);
    expect(prompt).toContain("认证限制");
  });

  // GP-AUTH-02: engineer prompt provides the DEMO_CREDENTIALS pattern
  it("GP-AUTH-02: engineer 提示词包含 DEMO_CREDENTIALS 本地状态登录示例", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("DEMO_CREDENTIALS");
    expect(prompt).toContain("isLoggedIn");
  });

  // GP-AUTH-03: architect prompt must NOT contain auth restriction block
  it("GP-AUTH-03: architect 提示词不包含认证限制块", () => {
    const prompt = getSystemPrompt("architect", projectId);
    expect(prompt).not.toContain("认证限制");
    expect(prompt).not.toContain("DEMO_CREDENTIALS");
  });
});

describe("getMultiFileEngineerPrompt", () => {
  const targetFiles: readonly ScaffoldFile[] = [
    {
      path: "/utils/helpers.js",
      description: "Common utility functions",
      exports: ["formatDate", "cn"],
      deps: [],
      hints: "Use Tailwind merge for cn",
    },
    {
      path: "/components/TodoItem.js",
      description: "Single todo item component",
      exports: ["TodoItem"],
      deps: ["/utils/helpers.js"],
      hints: "Accept onToggle and onDelete callbacks",
    },
  ];

  const completedFiles: Record<string, string> = {
    "/utils/helpers.js": "export function formatDate(d) { return d.toLocaleDateString(); }\nexport function cn(...args) { return args.join(' '); }",
  };

  const input = {
    projectId: "proj-456",
    targetFiles,
    sharedTypes: "type Todo = { id: string; text: string; done: boolean; }",
    completedFiles,
    designNotes: "Use a clean minimal design with indigo accent colors",
  };

  // GP-MFE-01: lists target files with paths and descriptions
  it("GP-MFE-01: 列出目标文件的路径和描述", () => {
    const prompt = getMultiFileEngineerPrompt(input);
    expect(prompt).toContain("/utils/helpers.js");
    expect(prompt).toContain("Common utility functions");
    expect(prompt).toContain("/components/TodoItem.js");
    expect(prompt).toContain("Single todo item component");
  });

  // GP-MFE-02: includes shared types
  it("GP-MFE-02: 包含共享类型定义", () => {
    const prompt = getMultiFileEngineerPrompt(input);
    expect(prompt).toContain("type Todo = { id: string; text: string; done: boolean; }");
  });

  // GP-MFE-03: includes completed dependency code
  it("GP-MFE-03: 包含已完成依赖文件的代码", () => {
    const prompt = getMultiFileEngineerPrompt(input);
    expect(prompt).toContain("export function formatDate");
    expect(prompt).toContain("/utils/helpers.js");
  });

  // GP-MFE-04: specifies FILE separator format
  it("GP-MFE-04: 指定 FILE 分隔符格式", () => {
    const prompt = getMultiFileEngineerPrompt(input);
    expect(prompt).toContain("// === FILE:");
  });

  // GP-MFE-05: includes package constraints
  it("GP-MFE-05: 包含包限制（lucide-react）", () => {
    const prompt = getMultiFileEngineerPrompt(input);
    expect(prompt).toContain("lucide-react");
  });

  // GP-MFE-06: includes projectId for supabase
  it("GP-MFE-06: 包含 projectId 用于 supabase appId", () => {
    const prompt = getMultiFileEngineerPrompt(input);
    expect(prompt).toContain("proj-456");
  });

  // GP-MFE-ALIAS-01: multi-file engineer prompt must instruct aliasing when icon and component share a name
  it("GP-MFE-ALIAS-01: getMultiFileEngineerPrompt 包含同名 lucide 图标别名规则", () => {
    const prompt = getMultiFileEngineerPrompt({
      projectId: "proj-alias",
      targetFiles: [],
      sharedTypes: "",
      completedFiles: {},
      designNotes: "",
    });
    expect(prompt).toContain("CalculatorIcon");
    expect(prompt).toContain("别名");
  });
});

describe("snipCompletedFiles", () => {
  const TARGET: ScaffoldFile = {
    path: "/B.js", description: "B", exports: ["B"], deps: ["/A.js"], hints: "",
  };

  // GP-SC-01: files shorter than SNIP_HEAD_LINES (20) are kept verbatim
  it("GP-SC-01: 短文件原样保留", () => {
    const shortCode =
      "export function ComponentA({ variant, onClick }) {\n  return <div />;\n}\nexport default ComponentA;";
    const result = snipCompletedFiles({ "/A.js": shortCode }, [TARGET]);
    expect(result["/A.js"]).toBe(shortCode);
  });

  // GP-SC-02: long files are truncated to head + trailing exports + omission marker
  it("GP-SC-02: 长文件被压缩为 head + 尾部导出声明", () => {
    // 40 lines: 15 imports/signature/body, then 20 lines of internal impl, then trailing export
    const longCode = [
      "import React from 'react';",
      "import { Icon } from 'lucide-react';",
      "export function BigComponent({ variant, size, onClick, children }) {",
      "  const [state, setState] = React.useState(0);",
      "  const handle = () => setState(s => s + 1);",
      "  return (",
      "    <div className=\"p-4\">",
      "      <button onClick={handle}>{children}</button>",
      "      <Icon />",
      "    </div>",
      "  );",
      "}",
      "function helperA() { return 1; }",
      "function helperB() { return 2; }",
      "function helperC() { return 3; }",
      "function helperD() { return 4; }",
      "function helperE() { return 5; }",
      "function helperF() { return 6; }",
      "function helperG() { return 7; }",
      "function helperH() { return 8; }",
      "function helperI() { return 9; }",
      "function helperJ() { return 10; }",
      "const internalConfig = { foo: 1, bar: 2 };",
      "const anotherInternal = 42;",
      "export default BigComponent;",
    ].join("\n");

    const result = snipCompletedFiles({ "/Big.js": longCode }, [TARGET]);
    const snipped = result["/Big.js"];

    // Head is preserved
    expect(snipped).toContain("import React");
    expect(snipped).toContain("export function BigComponent({ variant, size, onClick, children })");
    // Trailing export is preserved
    expect(snipped).toContain("export default BigComponent");
    // Omission marker is present
    expect(snipped).toMatch(/lines omitted — implementation details/);
    // Internal helpers beyond head are dropped
    expect(snipped).not.toContain("helperJ");
    expect(snipped).not.toContain("anotherInternal");
    // Result is shorter than the original
    expect(snipped.length).toBeLessThan(longCode.length);
  });

  // GP-SC-03: long files with no trailing exports still get head + omission marker
  it("GP-SC-03: 长文件无尾部导出时依然正常压缩", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `const line${i} = ${i};`);
    lines[0] = "export function Foo() { return 1; }";
    const code = lines.join("\n");

    const result = snipCompletedFiles({ "/Foo.js": code }, [TARGET]);
    const snipped = result["/Foo.js"];

    expect(snipped).toContain("export function Foo");
    expect(snipped).toContain("line1");
    expect(snipped).not.toContain("line29");
    expect(snipped).toMatch(/lines omitted/);
  });

  // GP-SC-04: direct-dep files are now ALSO truncated (behavior change) —
  // verifies the composer-file bloat defense is active.
  it("GP-SC-04: direct dep 文件也被压缩（行为变化）", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `const line${i} = ${i};`);
    lines[0] = "export function ComponentA() { return null; }";
    const bigCode = lines.join("\n");

    const targetWithDep: ScaffoldFile = {
      path: "/C.js", description: "C", exports: ["C"], deps: ["/A.js"], hints: "",
    };

    const prompt = getMultiFileEngineerPrompt({
      projectId: "p1", targetFiles: [targetWithDep],
      sharedTypes: "", completedFiles: { "/A.js": bigCode }, designNotes: "",
    });

    // Summary header is used uniformly now
    expect(prompt).toContain("(summary)");
    expect(prompt).toContain("export function ComponentA");
    // Internal lines beyond head are not in the prompt
    expect(prompt).not.toContain("line49");
    expect(prompt).toMatch(/lines omitted/);
  });
});

import { getMultiFileEngineerPrompt as _getMultiFileEngineerPrompt } from "@/lib/generate-prompts";

const FILE: ScaffoldFile = {
  path: "/App.js",
  description: "root",
  exports: ["App"],
  deps: [],
  hints: "",
};

describe("getMultiFileEngineerPrompt retryHint", () => {
  const baseInput = {
    projectId: "test-proj",
    targetFiles: [FILE],
    sharedTypes: "",
    completedFiles: {},
    designNotes: "",
  };

  it("omits retry block when retryHint is undefined", () => {
    const prompt = _getMultiFileEngineerPrompt(baseInput);
    expect(prompt).not.toContain("【重试提示");
  });

  it("prepends retry block when retryHint is provided", () => {
    const prompt = _getMultiFileEngineerPrompt({
      ...baseInput,
      retryHint: { attempt: 2, reason: "parse_failed" },
    });
    expect(prompt).toContain("【重试提示");
    expect(prompt).toContain("尝试 #2");
    expect(prompt).toContain("parse_failed");
  });

  it("includes priorTail when provided", () => {
    const prompt = _getMultiFileEngineerPrompt({
      ...baseInput,
      retryHint: {
        attempt: 2,
        reason: "parse_failed",
        priorTail: "const unclosed = { field:",
      },
    });
    expect(prompt).toContain("const unclosed = { field:");
  });

  it("retry block appears before 【严禁包限制", () => {
    const prompt = _getMultiFileEngineerPrompt({
      ...baseInput,
      retryHint: { attempt: 2, reason: "parse_failed" },
    });
    const retryIdx = prompt.indexOf("【重试提示");
    const banIdx = prompt.indexOf("【严禁包限制");
    expect(retryIdx).toBeGreaterThanOrEqual(0);
    expect(banIdx).toBeGreaterThan(retryIdx);
  });
});

describe("architect two-phase prompt", () => {
  // GP-TP-01: architect prompt instructs <thinking> + <output> structure
  it("GP-TP-01: architect 提示词包含双阶段 <thinking>/<output> 结构指令", () => {
    const prompt = getSystemPrompt("architect", "proj-1");
    expect(prompt).toContain("<thinking>");
    expect(prompt).toContain("<output>");
    expect(prompt).toContain("</output>");
  });

  // GP-TP-02: <output> block must contain only JSON per prompt
  it("GP-TP-02: architect 提示词指示 <output> 块内只输出 JSON", () => {
    const prompt = getSystemPrompt("architect", "proj-1");
    expect(prompt).toMatch(/<output>[\s\S]*?JSON[\s\S]*?<\/output>/);
  });
});
