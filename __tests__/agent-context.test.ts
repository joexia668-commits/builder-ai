import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmIterationContext,
  buildTriageContext,
} from "@/lib/agent-context";
import type { PmOutput } from "@/lib/types";

describe("buildEngineerContext", () => {
  const userPrompt = "帮我做一个待办事项应用";
  const pmOutput = "## PRD\n核心功能：增删改查 TODO 项目\n数据持久化：使用 localStorage";
  const archOutput = "## 技术方案\n组件：TodoApp, TodoItem, TodoInput\n状态：useState 管理列表";

  // UT-06: contains "用户原始需求"
  it("UT-06: 返回包含用户原始需求标签和内容的字符串", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);
    expect(result).toContain("用户原始需求");
    expect(result).toContain(userPrompt);
  });

  // UT-07: contains PM PRD and architect plan
  it("UT-07: 返回同时包含 PM 需求文档和架构师技术方案的字符串", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);
    expect(result).toContain("PM 需求文档");
    expect(result).toContain(pmOutput);
    expect(result).toContain("架构师技术方案");
    expect(result).toContain(archOutput);
  });

  // UT-08: structure follows required format (three sections separated)
  it("UT-08: 输出结构包含三个独立段落（用需求、PM PRD、架构方案）", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);
    const sections = result.split("\n\n");
    // At minimum 3 sections
    expect(sections.length).toBeGreaterThanOrEqual(3);
    // Each major piece of content is present
    const fullText = result;
    expect(fullText.indexOf(userPrompt)).toBeLessThan(fullText.indexOf(pmOutput));
    expect(fullText.indexOf(pmOutput)).toBeLessThan(fullText.indexOf(archOutput));
  });

  // IT-05: all three fields present in the context passed to API
  it("IT-05: 上下文中同时包含用户需求、PM 输出和架构师输出（三个字段完整）", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);

    // Simulate what gets sent as "context" in the API request body
    const apiRequestContext = result;

    expect(apiRequestContext).toContain(userPrompt);
    expect(apiRequestContext).toContain(pmOutput);
    expect(apiRequestContext).toContain(archOutput);
  });

  it("处理空字符串参数", () => {
    const result = buildEngineerContext("", "", "");
    expect(result).toContain("用户原始需求");
    expect(result).toContain("PM 需求文档");
    expect(result).toContain("架构师技术方案");
  });
});

describe("buildEngineerContextFromStructured", () => {
  const userPrompt = "帮我做一个待办事项应用";
  const archOutput = "## 技术方案\n组件：TodoApp, TodoItem";
  const pm: PmOutput = {
    intent: "极简待办事项",
    features: ["添加任务", "删除任务"],
    persistence: "localStorage",
    modules: ["TaskList", "TaskInput"],
    dataModel: ["id", "text", "done"],
  };

  // AC-JSON-01
  it("AC-JSON-01: 输出包含 [意图] 标签和 intent 值", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("[意图]");
    expect(result).toContain(pm.intent);
  });

  // AC-JSON-02
  it("AC-JSON-02: 输出包含 [功能] 标签和 features 拼接", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("[功能]");
    expect(result).toContain(pm.features.join(" / "));
  });

  // AC-JSON-03
  it("AC-JSON-03: 输出包含 [持久化] 标签和 persistence 值", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("[持久化]");
    expect(result).toContain("localStorage");
  });

  // AC-JSON-04
  it("AC-JSON-04: 输出包含 [模块] 标签和 modules 拼接", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("[模块]");
    expect(result).toContain(pm.modules.join(" / "));
  });

  // AC-JSON-05
  it("AC-JSON-05: 输出包含用户原始需求和 userPrompt 值", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("用户原始需求");
    expect(result).toContain(userPrompt);
  });

  // AC-JSON-06
  it("AC-JSON-06: 输出包含架构师技术方案和 archOutput 值", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("架构师技术方案");
    expect(result).toContain(archOutput);
  });

  // AC-JSON-07: structured output is shorter than a verbose prose equivalent
  it("AC-JSON-07: 结构化输出比等价的完整散文 context 更短", () => {
    const structured = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    // Simulate a verbose prose PM output (similar to what LLMs produce today)
    const verbosePmProse =
      `## 产品需求文档\n\n` +
      `核心目标：${pm.intent}\n\n` +
      `### 核心功能\n${pm.features.map((f) => `- ${f}`).join("\n")}\n\n` +
      `### 数据持久化\n使用 ${pm.persistence} 进行数据持久化\n\n` +
      `### 功能模块划分\n${pm.modules.map((m) => `- ${m}`).join("\n")}\n\n` +
      `### 数据模型\n${(pm.dataModel ?? []).map((d) => `- ${d}`).join("\n")}`;
    const prose = buildEngineerContext(userPrompt, verbosePmProse, archOutput);
    expect(structured.length).toBeLessThan(prose.length);
  });

  it("可选字段 dataModel 存在时包含 [数据模型] 标签", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).toContain("[数据模型]");
    expect(result).toContain("id");
  });

  it("不含 dataModel 时不输出 [数据模型] 标签", () => {
    const pmNoData: PmOutput = {
      intent: pm.intent,
      features: pm.features,
      persistence: pm.persistence,
      modules: pm.modules,
    };
    const result = buildEngineerContextFromStructured(userPrompt, pmNoData, archOutput);
    expect(result).not.toContain("[数据模型]");
  });
});

// --- New tests for buildEngineerContext with currentFiles ---

describe("buildEngineerContext — with currentFiles", () => {
  const userPrompt = "帮我做一个待办事项应用";
  const pmOutput = "## PRD\n核心功能";
  const archOutput = "## 技术方案";
  const files = { "/App.js": "export default function App() { return <div/> }" };

  it("includes EXISTING FILE marker and file content when currentFiles provided", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput, files);
    expect(result).toContain("EXISTING FILE: /App.js");
    expect(result).toContain("export default function App()");
  });

  it("omits EXISTING FILE section when currentFiles is empty object", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput, {});
    expect(result).not.toContain("EXISTING FILE");
  });

  it("omits EXISTING FILE section when currentFiles not provided", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);
    expect(result).not.toContain("EXISTING FILE");
  });

  it("no regression — existing sections still present with currentFiles", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput, files);
    expect(result).toContain("用户原始需求");
    expect(result).toContain(userPrompt);
    expect(result).toContain(pmOutput);
    expect(result).toContain(archOutput);
  });
});

describe("buildEngineerContextFromStructured — with currentFiles", () => {
  const userPrompt = "加个搜索功能";
  const archOutput = "## 技术方案";
  const pm: PmOutput = {
    intent: "待办事项应用",
    features: ["添加任务"],
    persistence: "localStorage",
    modules: ["TaskList"],
  };
  const files = { "/App.js": "export default function App() {}" };

  it("includes file content when currentFiles provided", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput, files);
    expect(result).toContain("EXISTING FILE: /App.js");
  });

  it("omits file section when currentFiles not provided", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).not.toContain("EXISTING FILE");
  });
});

describe("buildDirectEngineerContext", () => {
  const prompt = "按钮点击没有反应";
  const files = {
    "/App.js": "export default function App() { return <button>click</button> }",
  };

  it("includes user prompt labeled as 用户反馈", () => {
    const result = buildDirectEngineerContext(prompt, files);
    expect(result).toContain("用户反馈");
    expect(result).toContain(prompt);
  });

  it("includes existing file content with source tags", () => {
    const result = buildDirectEngineerContext(prompt, files);
    expect(result).toContain('<source file="/App.js">');
    expect(result).toContain("export default function App()");
  });

  it("instructs minimal change scope", () => {
    const result = buildDirectEngineerContext(prompt, files);
    expect(result).toContain("最小化改动");
  });

  it("includes all files when multiple files present", () => {
    const multiFiles = {
      "/App.js": "export default function App() {}",
      "/components/Button.js": "export function Button() {}",
    };
    const result = buildDirectEngineerContext(prompt, multiFiles);
    expect(result).toContain('<source file="/App.js">');
    expect(result).toContain('<source file="/components/Button.js">');
  });
});

describe("buildPmIterationContext", () => {
  const pm: PmOutput = {
    intent: "待办事项应用",
    features: ["添加任务", "删除任务"],
    persistence: "localStorage",
    modules: ["TaskList", "TaskInput"],
    dataModel: ["id", "text", "done"],
  };

  it("includes existing feature list", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("添加任务");
    expect(result).toContain("删除任务");
    expect(result).toContain("TaskList");
  });

  it("instructs not to redesign existing features", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("不要重新设计");
  });

  it("includes intent", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("待办事项应用");
  });

  it("includes dataModel when present", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("id");
  });

  it("omits dataModel section when not present", () => {
    const pmNoData: PmOutput = {
      intent: pm.intent,
      features: pm.features,
      persistence: pm.persistence,
      modules: pm.modules,
    };
    const result = buildPmIterationContext(pmNoData);
    expect(result).not.toContain("[数据模型]");
  });
});

describe("buildDirectMultiFileEngineerContext", () => {
  const prompt = "所有按键底色换成黄色";
  const files = {
    "/App.js": "export default function App() { return <div><Button/></div> }",
    "/components/Button.js": "export function Button() { return <button>Click</button> }",
  };

  it("includes user prompt labeled as 用户反馈", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("用户反馈");
    expect(result).toContain(prompt);
  });

  it("includes existing file content", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("/App.js");
    expect(result).toContain("/components/Button.js");
    expect(result).toContain("export default function App()");
  });

  it("instructs LLM to output ONLY modified files (not all files)", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("只输出你实际需要修改的文件");
  });

  it("does NOT instruct LLM to copy unchanged files verbatim", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).not.toContain("未修改的文件原样复制");
    expect(result).not.toContain("必须输出全部文件");
  });

  it("uses FILE separator format in output instructions", () => {
    const result = buildDirectMultiFileEngineerContext(prompt, files);
    expect(result).toContain("// === FILE:");
  });
});

describe("buildTriageContext", () => {
  const prompt = "修复 dynamic_app_data 表名";
  const filePaths = ["/App.js", "/components/Layout.js", "/utils/db.js"];

  it("contains user prompt", () => {
    const result = buildTriageContext(prompt, filePaths);
    expect(result).toContain(prompt);
  });

  it("contains all file paths", () => {
    const result = buildTriageContext(prompt, filePaths);
    for (const p of filePaths) {
      expect(result).toContain(p);
    }
  });

  it("does not contain file contents", () => {
    const result = buildTriageContext(prompt, filePaths);
    expect(result).not.toContain("import ");
    expect(result).not.toContain("export ");
    expect(result).not.toContain("function ");
  });

  it("asks for JSON array output", () => {
    const result = buildTriageContext(prompt, filePaths);
    expect(result).toContain("JSON");
  });
});
