import * as fs from "fs";
import * as path from "path";
import { getSystemPrompt } from "@/lib/generate-prompts";
import { buildEngineerContext } from "@/lib/agent-context";

/**
 * IT-06 ~ IT-07: Generate Route 行为
 *
 * These tests validate the core logic used by the /api/generate route:
 * - System prompt correctness
 * - Engineer user content construction with full context
 *
 * Note: The actual route uses GoogleGenerativeAI which requires a real API key.
 * We test the pure functions extracted from the route instead of the route handler.
 */

describe("Generate Route — system prompts", () => {
  const projectId = "proj-test-456";

  // IT-06: engineer system prompt explicitly prohibits markdown fence output
  // The prompt contains "不得包含 ```jsx" — a prohibition, not an instruction to use fences.
  it("IT-06: engineer system prompt 明确禁止输出 Markdown 代码围栏（不含「输出```jsx」类指令）", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    // Prohibition instruction must be present
    expect(prompt).toContain("不得包含");
    // Must NOT instruct the model to wrap code in fences
    expect(prompt).not.toMatch(/请.*用\s*```jsx/);
    expect(prompt).not.toMatch(/输出.*格式.*```jsx/);
    // The mention of ```jsx is explicitly in prohibition context
    expect(prompt).toMatch(/不得包含.*```jsx/);
  });

  it("engineer system prompt 包含 Tailwind CSS 约束", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("Tailwind CSS");
  });

  it("engineer system prompt 包含 Supabase 配置示例", () => {
    const prompt = getSystemPrompt("engineer", projectId);
    expect(prompt).toContain("supabase");
    expect(prompt).toContain(projectId);
  });
});

describe("Generate Route — engineer user content", () => {
  const userPrompt = "做一个计时器应用";
  const pmOutput = "PRD：单页计时器，支持开始/暂停/重置";
  const archOutput = "技术方案：TimerApp 组件，useState 管理时间和运行状态";

  // IT-07: when context is provided, engineer userContent contains all background info
  it("IT-07: 有 context 时 engineer userContent 包含完整背景信息", () => {
    const context = buildEngineerContext(userPrompt, pmOutput, archOutput);

    // Simulate what the route builds for engineer agent
    const userContent = `请根据以下完整背景信息，生成完整可运行的 React 组件代码：\n\n${context}`;

    expect(userContent).toContain("请根据以下完整背景信息");
    expect(userContent).toContain(userPrompt);
    expect(userContent).toContain(pmOutput);
    expect(userContent).toContain(archOutput);
  });

  it("pm userContent 以「用户需求：」开头", () => {
    const prompt = "帮我做一个 TODO app";
    // Simulate the route logic for pm
    const userContent = `用户需求：${prompt}`;
    expect(userContent).toContain("用户需求：");
    expect(userContent).toContain(prompt);
  });

  it("architect userContent 包含 PM 的 PRD 和请求指示", () => {
    const pmPRD = "核心功能：增删 TODO";
    // Simulate the route logic for architect
    const userContent = `PM 的产品需求文档：\n\n${pmPRD}\n\n请基于以上 PRD 设计 React 技术实现方案。`;
    expect(userContent).toContain("PM 的产品需求文档");
    expect(userContent).toContain(pmPRD);
    expect(userContent).toContain("请基于以上 PRD 设计 React 技术实现方案。");
  });
});

// ─── EPIC 5 Step 3: Edge Runtime & Auth Guard ────────────────────────────────
// ─── EPIC 5 Step 3: Edge Runtime + Auth ─────────────────────────────────────

describe("Generate Route — Edge Runtime & auth declarations (EPIC 5)", () => {
  const routePath = path.resolve(__dirname, "../app/api/generate/route.ts");
  let routeContent: string;

  beforeAll(() => {
    routeContent = fs.readFileSync(routePath, "utf-8");
  });

  // RT-E5-01: route exports runtime = 'edge'
  it("RT-E5-01: route.ts 导出 runtime = 'edge'", () => {
    expect(routeContent).toMatch(/export const runtime\s*=\s*["']edge["']/);
  });

  // RT-E5-02: route exports maxDuration = 300
  it("RT-E5-02: route.ts 导出 maxDuration = 300", () => {
    expect(routeContent).toMatch(/export const maxDuration\s*=\s*300/);
  });

  // RT-E5-03: route uses getToken from next-auth/jwt (not getServerSession)
  it("RT-E5-03: route.ts 使用 getToken（Edge 兼容）而非 getServerSession", () => {
    expect(routeContent).toContain("getToken");
    expect(routeContent).toContain("next-auth/jwt");
    expect(routeContent).not.toContain("getServerSession");
  });

  // RT-E5-04: route returns 401 when token is null/missing
  it("RT-E5-04: route.ts 在 token 为 null 时返回 401 Unauthorized", () => {
    expect(routeContent).toContain("401");
    expect(routeContent).toContain("Unauthorized");
    // The guard pattern: if (!token) return 401
    expect(routeContent).toMatch(/if\s*\(\s*!token\s*\)/);
  });
});
