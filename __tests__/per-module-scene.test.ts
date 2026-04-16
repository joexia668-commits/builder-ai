import { buildModuleArchitectContext } from "@/lib/agent-context";
import type { PmOutput, ModuleDefinition, Scene } from "@/lib/types";

const mockPm: PmOutput = {
  intent: "消消乐游戏",
  features: ["三消匹配", "连锁消除", "得分系统"],
  persistence: "none",
  modules: ["game-board", "score-panel"],
};

function makeModule(
  name: string,
  sceneType: Scene,
  engineeringHints: string = ""
): ModuleDefinition {
  return {
    name,
    description: `${name} module`,
    estimatedFiles: 2,
    deps: [],
    interface: { exports: [], consumes: [], stateContract: "" },
    sceneType,
    engineeringHints,
  };
}

describe("buildModuleArchitectContext — per-module scene + hints", () => {
  it("injects game hint for game-typed module", () => {
    const mod = makeModule("game-board", "game");
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["game", "animation"]);
    expect(ctx).toContain("game");
    // Should NOT contain animation hint since module sceneType is "game", not "animation"
    expect(ctx).not.toContain("framer-motion");
  });

  it("injects no hardcoded hint for general-typed module", () => {
    const mod = makeModule("score-panel", "general");
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["game", "animation"]);
    // Should NOT contain game-specific architect hints
    expect(ctx).not.toContain("游戏逻辑");
    expect(ctx).not.toContain("碰撞检测");
  });

  it("injects engineeringHints for general module (unknown scene coverage)", () => {
    const mod = makeModule(
      "audio-player",
      "general",
      "Audio 实例用 useRef 持有，播放状态用 useState，进度条用 rAF 更新"
    );
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["general"]);
    expect(ctx).toContain("Audio 实例用 useRef");
    expect(ctx).toContain("rAF");
  });

  it("injects both hardcoded rules and engineeringHints for known scene", () => {
    const mod = makeModule(
      "game-board",
      "game",
      "match3 cascade 需要循环检测"
    );
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["game"]);
    // Hardcoded scene hint present
    expect(ctx).toContain("game");
    // LLM-generated hint also present
    expect(ctx).toContain("match3 cascade");
  });

  it("falls back to global scenes when module has no sceneType", () => {
    const mod: ModuleDefinition = {
      name: "legacy",
      description: "legacy module",
      estimatedFiles: 2,
      deps: [],
      interface: { exports: [], consumes: [], stateContract: "" },
    };
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["dashboard"]);
    expect(ctx).toContain("dashboard");
  });
});
