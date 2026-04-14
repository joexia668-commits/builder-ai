import type { Scene } from "@/lib/types";
import { classifySceneFromPrompt, classifySceneFromPm } from "@/lib/scene-classifier";
import type { PmOutput } from "@/lib/types";

describe("Scene type", () => {
  it("accepts valid scene values", () => {
    const scenes: Scene[] = ["game", "dashboard", "crud", "multiview", "animation", "persistence", "general"];
    expect(scenes).toHaveLength(7);
  });
});

describe("classifySceneFromPrompt", () => {
  it("SC-P-01: detects game scene from Chinese keywords", () => {
    expect(classifySceneFromPrompt("做一个贪吃蛇游戏")).toContain("game");
  });

  it("SC-P-02: detects game scene from English keywords", () => {
    expect(classifySceneFromPrompt("build a snake game")).toContain("game");
  });

  it("SC-P-03: detects dashboard scene", () => {
    expect(classifySceneFromPrompt("做一个数据仪表盘")).toContain("dashboard");
  });

  it("SC-P-04: detects crud scene", () => {
    expect(classifySceneFromPrompt("做一个待办事项管理")).toContain("crud");
  });

  it("SC-P-05: detects multiview scene", () => {
    expect(classifySceneFromPrompt("多页面应用带导航")).toContain("multiview");
  });

  it("SC-P-06: detects animation scene", () => {
    expect(classifySceneFromPrompt("做一个拖拽排序列表")).toContain("animation");
  });

  it("SC-P-07: detects persistence scene", () => {
    expect(classifySceneFromPrompt("数据需要保存到数据库")).toContain("persistence");
  });

  it("SC-P-08: returns general for unmatched prompt", () => {
    expect(classifySceneFromPrompt("做一个网站")).toEqual(["general"]);
  });

  it("SC-P-09: detects multiple scenes", () => {
    const scenes = classifySceneFromPrompt("做一个待办事项管理，数据保存到数据库");
    expect(scenes).toContain("crud");
    expect(scenes).toContain("persistence");
    expect(scenes).not.toContain("general");
  });

  it("SC-P-10: caps at 3 scenes max", () => {
    const scenes = classifySceneFromPrompt("做一个游戏仪表盘，带表单管理，支持拖拽，数据保存");
    expect(scenes.length).toBeLessThanOrEqual(3);
  });
});

describe("classifySceneFromPm", () => {
  const basePm: PmOutput = {
    intent: "test",
    features: [],
    persistence: "none",
    modules: [],
  };

  it("SC-PM-01: detects game from features", () => {
    const pm = { ...basePm, features: ["蛇身移动", "碰撞检测", "得分系统"] };
    expect(classifySceneFromPm(pm)).toContain("game");
  });

  it("SC-PM-02: detects game from modules", () => {
    const pm = { ...basePm, modules: ["GameBoard", "ScorePanel"] };
    expect(classifySceneFromPm(pm)).toContain("game");
  });

  it("SC-PM-03: detects dashboard from features", () => {
    const pm = { ...basePm, features: ["数据图表", "趋势分析"] };
    expect(classifySceneFromPm(pm)).toContain("dashboard");
  });

  it("SC-PM-04: detects dashboard from modules", () => {
    const pm = { ...basePm, modules: ["ChartPanel", "AnalyticsDashboard"] };
    expect(classifySceneFromPm(pm)).toContain("dashboard");
  });

  it("SC-PM-05: detects crud from features", () => {
    const pm = { ...basePm, features: ["添加记录", "删除记录", "编辑功能"] };
    expect(classifySceneFromPm(pm)).toContain("crud");
  });

  it("SC-PM-06: detects crud from modules", () => {
    const pm = { ...basePm, modules: ["TodoForm", "ItemList"] };
    expect(classifySceneFromPm(pm)).toContain("crud");
  });

  it("SC-PM-07: detects multiview from module count >= 3", () => {
    const pm = { ...basePm, modules: ["Home", "Settings", "Profile"] };
    expect(classifySceneFromPm(pm)).toContain("multiview");
  });

  it("SC-PM-08: detects multiview from features", () => {
    const pm = { ...basePm, features: ["页面切换", "导航菜单"] };
    expect(classifySceneFromPm(pm)).toContain("multiview");
  });

  it("SC-PM-09: detects animation from features", () => {
    const pm = { ...basePm, features: ["拖拽排序", "动画过渡"] };
    expect(classifySceneFromPm(pm)).toContain("animation");
  });

  it("SC-PM-10: detects persistence from supabase", () => {
    const pm = { ...basePm, persistence: "supabase" as const };
    expect(classifySceneFromPm(pm)).toContain("persistence");
  });

  it("SC-PM-11: detects persistence from localStorage", () => {
    const pm = { ...basePm, persistence: "localStorage" as const };
    expect(classifySceneFromPm(pm)).toContain("persistence");
  });

  it("SC-PM-12: returns general when nothing matches", () => {
    expect(classifySceneFromPm(basePm)).toEqual(["general"]);
  });

  it("SC-PM-13: detects multiple scenes", () => {
    const pm = { ...basePm, features: ["添加待办", "删除待办"], persistence: "localStorage" as const };
    const scenes = classifySceneFromPm(pm);
    expect(scenes).toContain("crud");
    expect(scenes).toContain("persistence");
  });

  it("SC-PM-14: caps at 3 scenes", () => {
    const pm = {
      ...basePm,
      features: ["蛇身移动", "数据图表", "添加记录", "拖拽排序"],
      persistence: "supabase" as const,
      modules: ["Home", "Settings", "Profile", "GameBoard"],
    };
    expect(classifySceneFromPm(pm).length).toBeLessThanOrEqual(3);
  });
});
