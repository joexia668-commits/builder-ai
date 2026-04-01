import { buildEngineerContext, buildEngineerContextFromStructured } from "@/lib/agent-context";
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
