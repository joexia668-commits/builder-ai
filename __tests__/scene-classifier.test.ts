import type { Scene } from "@/lib/types";

describe("Scene type", () => {
  it("accepts valid scene values", () => {
    const scenes: Scene[] = ["game", "dashboard", "crud", "multiview", "animation", "persistence", "general"];
    expect(scenes).toHaveLength(7);
  });
});
