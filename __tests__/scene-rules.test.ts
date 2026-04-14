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
