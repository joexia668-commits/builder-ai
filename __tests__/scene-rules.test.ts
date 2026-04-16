import { getEngineerSceneRules, getArchitectSceneHint } from "@/lib/scene-rules";
import type { Scene } from "@/lib/types";

describe("getEngineerSceneRules", () => {
  it("SR-E-01: returns empty string for general", () => {
    expect(getEngineerSceneRules(["general"])).toBe("");
  });

  it("SR-E-02: returns game rules for game scene", () => {
    const rules = getEngineerSceneRules(["game"]);
    expect(rules).toContain("useRef");
    expect(rules).toContain("setInterval");
  });

  it("SR-E-03: returns dashboard rules for dashboard scene", () => {
    const rules = getEngineerSceneRules(["dashboard"]);
    expect(rules).toContain("SVG");
    expect(rules).toContain("recharts");
  });

  it("SR-E-04: returns crud rules for crud scene", () => {
    const rules = getEngineerSceneRules(["crud"]);
    expect(rules).toContain("useState");
    expect(rules).toContain("setForm");
  });

  it("SR-E-05: returns multiview rules for multiview scene", () => {
    const rules = getEngineerSceneRules(["multiview"]);
    expect(rules).toContain("setView");
    expect(rules).toContain("react-router-dom");
  });

  it("SR-E-06: returns animation rules for animation scene", () => {
    const rules = getEngineerSceneRules(["animation"]);
    expect(rules).toContain("transition");
    expect(rules).toContain("framer-motion");
  });

  it("SR-E-07: returns persistence rules for persistence scene", () => {
    const rules = getEngineerSceneRules(["persistence"]);
    expect(rules).toContain("upsert");
    expect(rules).toContain("localStorage");
  });

  it("SR-E-08: concatenates multiple scene rules", () => {
    const rules = getEngineerSceneRules(["crud", "persistence"]);
    expect(rules).toContain("setForm");
    expect(rules).toContain("upsert");
  });
});

describe("getArchitectSceneHint", () => {
  it("SR-A-01: returns empty string for general", () => {
    expect(getArchitectSceneHint(["general"])).toBe("");
  });

  it("SR-A-02: returns hint for game scene", () => {
    const hint = getArchitectSceneHint(["game"]);
    expect(hint).toContain("game");
    expect(hint).toContain("【场景提示】");
  });

  it("SR-A-03: returns hint for dashboard scene", () => {
    const hint = getArchitectSceneHint(["dashboard"]);
    expect(hint).toContain("SVG");
  });

  it("SR-A-04: concatenates multiple scene hints", () => {
    const hint = getArchitectSceneHint(["crud", "persistence"]);
    expect(hint).toContain("crud");
    expect(hint).toContain("持久化");
  });
});

describe("getEngineerSceneRules with gameSubtype", () => {
  it("SR-GS-01: includes match3 rules when subtype is match3", () => {
    const rules = getEngineerSceneRules(["game"], "match3");
    expect(rules).toContain("match3");
    expect(rules).toContain("swap");
    expect(rules).toContain("cascade");
  });

  it("SR-GS-02: includes snake rules when subtype is snake", () => {
    const rules = getEngineerSceneRules(["game"], "snake");
    expect(rules).toContain("snake");
    expect(rules).toContain("方向");
  });

  it("SR-GS-03: includes tetris rules when subtype is tetris", () => {
    const rules = getEngineerSceneRules(["game"], "tetris");
    expect(rules).toContain("tetris");
    expect(rules).toContain("旋转");
  });

  it("SR-GS-04: includes platformer rules when subtype is platformer", () => {
    const rules = getEngineerSceneRules(["game-engine"], "platformer");
    expect(rules).toContain("platformer");
    expect(rules).toContain("重力");
  });

  it("SR-GS-05: includes board rules when subtype is board", () => {
    const rules = getEngineerSceneRules(["game"], "board");
    expect(rules).toContain("board");
    expect(rules).toContain("回合");
  });

  it("SR-GS-06: no subtype rules for generic", () => {
    const withSubtype = getEngineerSceneRules(["game"], "generic");
    const without = getEngineerSceneRules(["game"]);
    expect(withSubtype).toBe(without);
  });

  it("SR-GS-07: no subtype rules when no game scene", () => {
    const rules = getEngineerSceneRules(["dashboard"], "match3");
    expect(rules).not.toContain("match3");
  });
});

describe("getArchitectSceneHint with gameSubtype", () => {
  it("SR-GA-01: includes match3 architecture hints", () => {
    const hint = getArchitectSceneHint(["game"], "match3");
    expect(hint).toContain("GameBoard");
    expect(hint).toContain("maxLines");
  });

  it("SR-GA-02: includes snake architecture hints", () => {
    const hint = getArchitectSceneHint(["game"], "snake");
    expect(hint).toContain("GameBoard");
  });

  it("SR-GA-03: no subtype hints for generic", () => {
    const hint = getArchitectSceneHint(["game"], "generic");
    expect(hint).not.toContain("GameBoard");
  });
});

describe("scene filtering by gameSubtype", () => {
  it("SR-F-01: match3 excludes game-canvas and animation rules", () => {
    const rules = getEngineerSceneRules(["game", "game-canvas", "animation"], "match3");
    expect(rules).toContain("match3");
    expect(rules).not.toContain("Canvas 2D API");
    expect(rules).not.toContain("framer-motion");
  });

  it("SR-F-02: match3 excludes game-canvas architect hint", () => {
    const hint = getArchitectSceneHint(["game", "game-canvas", "animation"], "match3");
    expect(hint).toContain("GameBoard");
    expect(hint).not.toContain("Canvas 2D API");
    expect(hint).not.toContain("animation 类型");
  });

  it("SR-F-03: snake keeps game-canvas rules but excludes animation", () => {
    const rules = getEngineerSceneRules(["game", "game-canvas", "animation"], "snake");
    expect(rules).toContain("snake");
    expect(rules).toContain("Canvas 2D API");
    expect(rules).not.toContain("framer-motion");
  });

  it("SR-F-04: platformer keeps game-engine rules but excludes game-canvas", () => {
    const rules = getEngineerSceneRules(["game-engine", "game-canvas"], "platformer");
    expect(rules).toContain("Phaser 3");
    expect(rules).not.toContain("Canvas 2D API");
  });

  it("SR-F-05: no filtering when gameSubtype is generic", () => {
    const rules = getEngineerSceneRules(["game", "game-canvas", "animation"], "generic");
    expect(rules).toContain("Canvas 2D API");
    expect(rules).toContain("framer-motion");
  });
});
