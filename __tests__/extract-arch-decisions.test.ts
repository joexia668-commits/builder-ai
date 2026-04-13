import { extractArchDecisions } from "@/lib/extract-arch-decisions";
import type { ScaffoldData } from "@/lib/types";

const SCAFFOLD: ScaffoldData = {
  files: [
    { path: "/App.js", description: "Root", exports: ["App"], deps: ["/components/TodoList.js", "/components/TodoForm.js"], hints: "" },
    { path: "/components/TodoList.js", description: "List", exports: ["TodoList"], deps: ["/components/TodoItem.js"], hints: "" },
    { path: "/components/TodoItem.js", description: "Item", exports: ["TodoItem"], deps: [], hints: "" },
    { path: "/components/TodoForm.js", description: "Form", exports: ["TodoForm"], deps: [], hints: "" },
  ],
  sharedTypes: "",
  designNotes: "使用 useReducer 管理全局状态。Tab 切换视图。表单用 modal。使用 lucide 图标。",
};

describe("extractArchDecisions", () => {
  it("extracts fileCount from scaffold", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.fileCount).toBe(4);
  });

  it("builds component tree from deps", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.componentTree).toContain("App");
    expect(result.componentTree).toContain("TodoList");
    expect(result.componentTree).toContain("TodoItem");
  });

  it("infers stateStrategy from designNotes", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.stateStrategy).toBe("useReducer");
  });

  it("infers stateStrategy as unknown when no specific keyword", () => {
    const scaffold: ScaffoldData = { ...SCAFFOLD, designNotes: "简单的状态管理" };
    const result = extractArchDecisions(scaffold);
    expect(result.stateStrategy).toBe("unknown");
  });

  it("infers stateStrategy as Context API when context keyword present", () => {
    const scaffold: ScaffoldData = { ...SCAFFOLD, designNotes: "使用 React context 管理主题" };
    const result = extractArchDecisions(scaffold);
    expect(result.stateStrategy).toBe("Context API");
  });

  it("detects supabase persistence from deps", () => {
    const scaffold: ScaffoldData = {
      ...SCAFFOLD,
      files: [
        ...SCAFFOLD.files,
        { path: "/lib/db.js", description: "DB", exports: ["db"], deps: ["/supabaseClient.js"], hints: "" },
      ],
    };
    const result = extractArchDecisions(scaffold);
    expect(result.persistenceSetup).toBe("Supabase (CRUD)");
  });

  it("detects localStorage persistence from designNotes", () => {
    const scaffold: ScaffoldData = { ...SCAFFOLD, designNotes: "使用 localStorage 持久化数据" };
    const result = extractArchDecisions(scaffold);
    expect(result.persistenceSetup).toBe("localStorage");
  });

  it("defaults persistence to none", () => {
    const scaffold: ScaffoldData = { ...SCAFFOLD, designNotes: "无需持久化" };
    const result = extractArchDecisions(scaffold);
    expect(result.persistenceSetup).toBe("none");
  });

  it("extracts keyDecisions from designNotes", () => {
    const result = extractArchDecisions(SCAFFOLD);
    expect(result.keyDecisions.length).toBeGreaterThan(0);
    expect(result.keyDecisions.length).toBeLessThanOrEqual(5);
    expect(result.keyDecisions[0]).toContain("useReducer");
  });

  it("handles empty designNotes gracefully", () => {
    const scaffold: ScaffoldData = { ...SCAFFOLD, designNotes: "" };
    const result = extractArchDecisions(scaffold);
    expect(result.keyDecisions).toEqual([]);
    expect(result.stateStrategy).toBe("unknown");
  });
});
