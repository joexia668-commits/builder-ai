import { buildEngineerContext } from "@/lib/agent-context";

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
