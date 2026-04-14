import { buildPmHistoryContext } from "@/lib/agent-context";
import type { IterationRound } from "@/lib/types";

describe("buildPmHistoryContext", () => {
  it("returns empty string for empty rounds", () => {
    expect(buildPmHistoryContext([])).toBe("");
  });

  it("formats full pipeline rounds with PM summary", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "做一个待办应用",
        intent: "new_project",
        pmSummary: {
          intent: "待办事项管理",
          features: ["添加任务", "删除任务"],
          persistence: "localStorage",
          modules: ["TaskList", "TaskForm"],
        },
        timestamp: "2026-04-13T10:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("当前应用的迭代历史");
    expect(result).toContain("做一个待办应用");
    expect(result).toContain("待办事项管理");
    expect(result).toContain("添加任务");
  });

  it("formats direct path rounds without PM summary", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "把字体改大",
        intent: "style_change",
        pmSummary: null,
        timestamp: "2026-04-13T10:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("把字体改大");
    expect(result).toContain("样式调整");
  });

  it("formats multiple rounds in order", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "做个待办应用",
        intent: "new_project",
        pmSummary: { intent: "待办", features: ["添加"], persistence: "none", modules: ["List"] },
        timestamp: "2026-04-13T10:00:00Z",
      },
      {
        userPrompt: "加暗黑模式",
        intent: "feature_add",
        pmSummary: { intent: "主题切换", features: ["暗黑模式"], persistence: "localStorage", modules: ["Theme"] },
        timestamp: "2026-04-13T11:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).toContain("[第1轮]");
    expect(result).toContain("[第2轮]");
    expect(result.indexOf("做个待办应用")).toBeLessThan(result.indexOf("加暗黑模式"));
  });

  it("does NOT include archDecisions in output (field removed)", () => {
    const rounds: IterationRound[] = [
      {
        userPrompt: "做个待办",
        intent: "new_project",
        pmSummary: null,
        timestamp: "2026-04-13T10:00:00Z",
      },
    ];
    const result = buildPmHistoryContext(rounds);
    expect(result).not.toContain("架构：");
    expect(result).not.toContain("componentTree");
  });

  it("backward compat: old rounds with archDecisions field load without error", () => {
    const rawFromDB = JSON.parse(JSON.stringify({
      userPrompt: "做一个待办",
      intent: "new_project",
      pmSummary: null,
      archDecisions: { fileCount: 3, componentTree: "App -> [List]", stateStrategy: "useState", persistenceSetup: "none", keyDecisions: [] },
      timestamp: "2026-04-13T10:00:00Z",
    })) as IterationRound;
    const result = buildPmHistoryContext([rawFromDB]);
    expect(result).toContain("做一个待办");
  });
});
