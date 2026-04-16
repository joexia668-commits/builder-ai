import { parseDecomposerOutput, validateDecomposerOutput } from "@/lib/decomposer";
import type { DecomposerOutput } from "@/lib/types";

const VALID_OUTPUT: DecomposerOutput = {
  skeleton: {
    description: "骨架：路由、布局、共享类型",
    files: ["/App.js", "/types.ts", "/Layout.js"],
    sharedTypes: "export type User = { id: string; name: string }",
  },
  modules: [
    {
      name: "auth",
      description: "用户登录与注册模块",
      estimatedFiles: 2,
      deps: [],
      interface: {
        exports: ["LoginForm", "AuthProvider"],
        consumes: ["User"],
        stateContract: "{ isLoggedIn: boolean; user: User | null }",
      },
    },
    {
      name: "dashboard",
      description: "仪表盘主视图模块",
      estimatedFiles: 3,
      deps: ["auth"],
      interface: {
        exports: ["DashboardView"],
        consumes: ["User"],
        stateContract: "{ metrics: Metric[] }",
      },
    },
  ],
  generateOrder: [["auth"], ["dashboard"]],
};

describe("parseDecomposerOutput", () => {
  it("DC-01: 解析合法 JSON 字符串", () => {
    const result = parseDecomposerOutput(JSON.stringify(VALID_OUTPUT));
    expect(result).not.toBeNull();
    expect(result?.skeleton.files).toEqual(VALID_OUTPUT.skeleton.files);
    expect(result?.modules).toHaveLength(2);
    expect(result?.generateOrder).toEqual([["auth"], ["dashboard"]]);
  });

  it("DC-02: 解析 markdown 代码围栏包裹的 JSON", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_OUTPUT) + "\n```";
    const result = parseDecomposerOutput(fenced);
    expect(result).not.toBeNull();
    expect(result?.modules[0].name).toBe("auth");
  });

  it("DC-03: 非法 JSON 返回 null", () => {
    expect(parseDecomposerOutput("{broken json")).toBeNull();
  });

  it("DC-04: 缺少 skeleton 字段返回 null", () => {
    const without = { ...VALID_OUTPUT } as Record<string, unknown>;
    delete without.skeleton;
    expect(parseDecomposerOutput(JSON.stringify(without))).toBeNull();
  });

  it("DC-05: 缺少 modules 字段返回 null", () => {
    const without = { ...VALID_OUTPUT } as Record<string, unknown>;
    delete without.modules;
    expect(parseDecomposerOutput(JSON.stringify(without))).toBeNull();
  });

  it("DC-06: 缺少 generateOrder 字段返回 null", () => {
    const without = { ...VALID_OUTPUT } as Record<string, unknown>;
    delete without.generateOrder;
    expect(parseDecomposerOutput(JSON.stringify(without))).toBeNull();
  });

  it("DC-07: 空字符串返回 null", () => {
    expect(parseDecomposerOutput("")).toBeNull();
  });

  it("DC-08: skeleton 缺少 files 数组返回 null", () => {
    const bad = {
      ...VALID_OUTPUT,
      skeleton: { description: "test", sharedTypes: "" },
    };
    expect(parseDecomposerOutput(JSON.stringify(bad))).toBeNull();
  });

  it("DC-10: module without new fields still parses (backward compat)", () => {
    const result = parseDecomposerOutput(JSON.stringify(VALID_OUTPUT));
    expect(result).not.toBeNull();
    expect(result?.modules[0]).not.toHaveProperty("sceneType");
    expect(result?.modules[0]).not.toHaveProperty("engineeringHints");
  });

  it("DC-09: parses module with sceneType and engineeringHints fields", () => {
    const withHints: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: VALID_OUTPUT.modules.map((m, i) => ({
        ...m,
        sceneType: i === 0 ? "crud" : "dashboard",
        engineeringHints: i === 0
          ? "表单状态用单个 useState 对象管理"
          : "图表用纯 SVG 实现，禁止 recharts",
      })),
    };
    const result = parseDecomposerOutput(JSON.stringify(withHints));
    expect(result).not.toBeNull();
    expect((result?.modules[0] as any).sceneType).toBe("crud");
    expect((result?.modules[0] as any).engineeringHints).toContain("useState");
    expect((result?.modules[1] as any).sceneType).toBe("dashboard");
    expect((result?.modules[1] as any).engineeringHints).toContain("SVG");
  });
});

describe("validateDecomposerOutput", () => {
  it("DC-V-01: 合法输出原样返回", () => {
    const result = validateDecomposerOutput(VALID_OUTPUT);
    expect(result.modules).toHaveLength(2);
    expect(result.skeleton).toEqual(VALID_OUTPUT.skeleton);
  });

  it("DC-V-02: modules 超过 5 个时截断到 5 个", () => {
    const manyModules: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: [
        { name: "m1", description: "mod1", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        { name: "m2", description: "mod2", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        { name: "m3", description: "mod3", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        { name: "m4", description: "mod4", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        { name: "m5", description: "mod5", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
        { name: "m6", description: "mod6", estimatedFiles: 2, deps: [], interface: { exports: [], consumes: [], stateContract: "" } },
      ],
      generateOrder: [["m1", "m2", "m3", "m4", "m5", "m6"]],
    };
    const result = validateDecomposerOutput(manyModules);
    expect(result.modules).toHaveLength(5);
  });

  it("DC-V-03: estimatedFiles 超过 8 时截断到 8", () => {
    const bigModule: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: [
        {
          name: "big",
          description: "very big module",
          estimatedFiles: 15,
          deps: [],
          interface: { exports: [], consumes: [], stateContract: "" },
        },
      ],
      generateOrder: [["big"]],
    };
    const result = validateDecomposerOutput(bigModule);
    expect(result.modules[0].estimatedFiles).toBe(8);
  });

  it("DC-V-04: 幽灵依赖被移除", () => {
    const withPhantomDeps: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: [
        {
          name: "feature",
          description: "feature module",
          estimatedFiles: 2,
          deps: ["auth", "nonexistent-module"],
          interface: { exports: [], consumes: [], stateContract: "" },
        },
        {
          name: "auth",
          description: "auth module",
          estimatedFiles: 1,
          deps: [],
          interface: { exports: [], consumes: [], stateContract: "" },
        },
      ],
      generateOrder: [["auth"], ["feature"]],
    };
    const result = validateDecomposerOutput(withPhantomDeps);
    const featureModule = result.modules.find((m) => m.name === "feature");
    expect(featureModule?.deps).toEqual(["auth"]);
    expect(featureModule?.deps).not.toContain("nonexistent-module");
  });

  it("DC-V-05: generateOrder 只保留合法模块名", () => {
    const withBadOrder: DecomposerOutput = {
      ...VALID_OUTPUT,
      generateOrder: [["auth", "ghost-module"], ["dashboard"]],
    };
    const result = validateDecomposerOutput(withBadOrder);
    expect(result.generateOrder[0]).toEqual(["auth"]);
    expect(result.generateOrder[1]).toEqual(["dashboard"]);
  });

  it("DC-V-06: circular deps A→B→A are broken", () => {
    const cyclic: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: [
        {
          name: "a",
          description: "mod a",
          estimatedFiles: 2,
          deps: ["b"],
          interface: { exports: ["A"], consumes: ["B"], stateContract: "" },
        },
        {
          name: "b",
          description: "mod b",
          estimatedFiles: 2,
          deps: ["a"],
          interface: { exports: ["B"], consumes: ["A"], stateContract: "" },
        },
      ],
      generateOrder: [["a", "b"]],
    };
    const result = validateDecomposerOutput(cyclic);
    const allNames = result.generateOrder.flat();
    expect(allNames.sort()).toEqual(["a", "b"]);
    const firstMod = result.modules.find((m) => m.name === result.generateOrder[0][0])!;
    const secondNames = result.generateOrder.slice(1).flat();
    const depsInSecond = firstMod.deps.filter((d) => secondNames.includes(d));
    expect(depsInSecond).toEqual([]);
  });

  it("DC-V-08: invalid sceneType is replaced with 'general'", () => {
    const withBadScene: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: VALID_OUTPUT.modules.map((m) => ({
        ...m,
        sceneType: "nonexistent-scene" as any,
      })),
    };
    const result = validateDecomposerOutput(withBadScene);
    expect(result.modules[0].sceneType).toBe("general");
  });

  it("DC-V-09: valid sceneType is preserved", () => {
    const withScene: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: [
        { ...VALID_OUTPUT.modules[0], sceneType: "crud" as any },
        { ...VALID_OUTPUT.modules[1], sceneType: "dashboard" as any },
      ],
    };
    const result = validateDecomposerOutput(withScene);
    expect(result.modules[0].sceneType).toBe("crud");
    expect(result.modules[1].sceneType).toBe("dashboard");
  });

  it("DC-V-10: missing sceneType defaults to 'general' after validation", () => {
    const result = validateDecomposerOutput(VALID_OUTPUT);
    expect(result.modules[0].sceneType).toBe("general");
  });

  it("DC-V-11: engineeringHints is preserved when present", () => {
    const withHints: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: VALID_OUTPUT.modules.map((m) => ({
        ...m,
        engineeringHints: "use useRef for state",
      })),
    };
    const result = validateDecomposerOutput(withHints);
    expect(result.modules[0].engineeringHints).toBe("use useRef for state");
  });

  it("DC-V-12: missing engineeringHints defaults to empty string", () => {
    const result = validateDecomposerOutput(VALID_OUTPUT);
    expect(result.modules[0].engineeringHints).toBe("");
  });

  it("DC-V-07: generateOrder is recomputed from deps (ignoring LLM order)", () => {
    const wrongOrder: DecomposerOutput = {
      ...VALID_OUTPUT,
      modules: [
        {
          name: "api",
          description: "api",
          estimatedFiles: 2,
          deps: ["data"],
          interface: { exports: [], consumes: [], stateContract: "" },
        },
        {
          name: "data",
          description: "data",
          estimatedFiles: 2,
          deps: [],
          interface: { exports: [], consumes: [], stateContract: "" },
        },
      ],
      generateOrder: [["api"], ["data"]],
    };
    const result = validateDecomposerOutput(wrongOrder);
    const dataLayer = result.generateOrder.findIndex((l) => l.includes("data"));
    const apiLayer = result.generateOrder.findIndex((l) => l.includes("api"));
    expect(dataLayer).toBeLessThan(apiLayer);
  });
});
