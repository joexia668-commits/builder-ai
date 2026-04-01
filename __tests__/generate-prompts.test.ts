import { getSystemPrompt } from "@/lib/generate-prompts";
import type { AgentRole } from "@/lib/types";

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
});
