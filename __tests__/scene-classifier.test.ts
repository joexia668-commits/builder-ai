import type { Scene } from "@/lib/types";
import { classifySceneFromPrompt } from "@/lib/scene-classifier";

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
