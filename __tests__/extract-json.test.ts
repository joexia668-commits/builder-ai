import { extractPmOutput, extractArchOutput, extractScaffold, extractScaffoldFromTwoPhase } from "@/lib/extract-json";
import type { PmOutput, ArchOutput, ScaffoldData } from "@/lib/types";

const VALID_PM: PmOutput = {
  intent: "一个极简的待办事项应用",
  features: ["添加任务", "删除任务", "标记完成"],
  persistence: "localStorage",
  modules: ["TaskList", "TaskInput"],
};

const VALID_ARCH: ArchOutput = {
  components: ["App", "TaskList", "TaskItem"],
  state: "useState([]) 管理任务列表",
};

describe("extractPmOutput", () => {
  // EJ-01: plain valid JSON
  it("EJ-01: 解析合法 JSON 字符串", () => {
    const result = extractPmOutput(JSON.stringify(VALID_PM));
    expect(result).not.toBeNull();
    expect(result?.intent).toBe(VALID_PM.intent);
    expect(result?.features).toEqual(VALID_PM.features);
    expect(result?.persistence).toBe("localStorage");
  });

  // EJ-02: JSON wrapped in ```json fence
  it("EJ-02: 去掉 ```json 围栏后解析", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_PM) + "\n```";
    const result = extractPmOutput(fenced);
    expect(result).not.toBeNull();
    expect(result?.intent).toBe(VALID_PM.intent);
  });

  // EJ-03: JSON wrapped in plain ``` fence
  it("EJ-03: 去掉普通 ``` 围栏后解析", () => {
    const fenced = "```\n" + JSON.stringify(VALID_PM) + "\n```";
    const result = extractPmOutput(fenced);
    expect(result).not.toBeNull();
    expect(result?.modules).toEqual(VALID_PM.modules);
  });

  // EJ-04: empty string
  it("EJ-04: 空字符串返回 null", () => {
    expect(extractPmOutput("")).toBeNull();
  });

  // EJ-05: invalid JSON syntax
  it("EJ-05: 非法 JSON 返回 null", () => {
    expect(extractPmOutput("{broken json")).toBeNull();
  });

  // EJ-06: missing required field intent
  it("EJ-06: 缺少 intent 字段返回 null", () => {
    const without = { ...VALID_PM as object } as Record<string, unknown>;
    delete without.intent;
    expect(extractPmOutput(JSON.stringify(without))).toBeNull();
  });

  // EJ-07: invalid persistence value
  it("EJ-07: persistence 不在枚举值内返回 null", () => {
    const bad = { ...VALID_PM, persistence: "redis" };
    expect(extractPmOutput(JSON.stringify(bad))).toBeNull();
  });

  // EJ-08: features is not an array
  it("EJ-08: features 非数组返回 null", () => {
    const bad = { ...VALID_PM, features: "添加任务" };
    expect(extractPmOutput(JSON.stringify(bad))).toBeNull();
  });

  // EJ-09: optional dataModel may be absent
  it("EJ-09: 缺少可选字段 dataModel 仍返回有效结果", () => {
    const withoutDataModel: PmOutput = {
      intent: VALID_PM.intent,
      features: [...VALID_PM.features],
      persistence: VALID_PM.persistence,
      modules: [...VALID_PM.modules],
    };
    const result = extractPmOutput(JSON.stringify(withoutDataModel));
    expect(result).not.toBeNull();
    expect(result?.dataModel).toBeUndefined();
  });

  // EJ-10: result is frozen (immutable)
  it("EJ-10: 返回的对象是冻结的", () => {
    const result = extractPmOutput(JSON.stringify(VALID_PM));
    expect(result).not.toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
  });

  // EJ: all three persistence values are accepted
  it("所有合法 persistence 枚举值均被接受", () => {
    const values: PmOutput["persistence"][] = ["none", "localStorage", "supabase"];
    for (const p of values) {
      const pm = { ...VALID_PM, persistence: p };
      expect(extractPmOutput(JSON.stringify(pm))).not.toBeNull();
    }
  });

  // EJ: features must be non-empty
  it("features 为空数组返回 null", () => {
    const bad = { ...VALID_PM, features: [] };
    expect(extractPmOutput(JSON.stringify(bad))).toBeNull();
  });

  // EJ: intent empty string returns null
  it("intent 为空字符串返回 null", () => {
    const bad = { ...VALID_PM, intent: "" };
    expect(extractPmOutput(JSON.stringify(bad))).toBeNull();
  });
});

describe("extractArchOutput", () => {
  // EJ-11: valid ArchOutput JSON
  it("EJ-11: 解析合法 ArchOutput JSON", () => {
    const result = extractArchOutput(JSON.stringify(VALID_ARCH));
    expect(result).not.toBeNull();
    expect(result?.components).toEqual(VALID_ARCH.components);
    expect(result?.state).toBe(VALID_ARCH.state);
  });

  // EJ-12: empty components array returns null
  it("EJ-12: components 为空数组返回 null", () => {
    const bad = { ...VALID_ARCH, components: [] };
    expect(extractArchOutput(JSON.stringify(bad))).toBeNull();
  });

  it("缺少 components 字段返回 null", () => {
    const without = { ...VALID_ARCH as object } as Record<string, unknown>;
    delete without.components;
    expect(extractArchOutput(JSON.stringify(without))).toBeNull();
  });

  it("缺少 state 字段返回 null", () => {
    const without = { ...VALID_ARCH as object } as Record<string, unknown>;
    delete without.state;
    expect(extractArchOutput(JSON.stringify(without))).toBeNull();
  });

  it("可选字段 icons 存在时正常解析", () => {
    const withIcons: ArchOutput = { ...VALID_ARCH, icons: ["Plus", "Trash2"] };
    const result = extractArchOutput(JSON.stringify(withIcons));
    expect(result?.icons).toEqual(["Plus", "Trash2"]);
  });

  it("返回的对象是冻结的", () => {
    const result = extractArchOutput(JSON.stringify(VALID_ARCH));
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("去掉 ```json 围栏后解析 ArchOutput", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_ARCH) + "\n```";
    expect(extractArchOutput(fenced)).not.toBeNull();
  });
});

const VALID_SCAFFOLD: ScaffoldData = {
  files: [
    {
      path: "/App.js",
      description: "Root component",
      exports: ["App"],
      deps: ["/components/Header.js"],
      hints: "Use useState for routing",
    },
    {
      path: "/components/Header.js",
      description: "Top navigation",
      exports: ["Header"],
      deps: [],
      hints: "lucide-react icons",
    },
  ],
  sharedTypes: "type User = { id: string; name: string }",
  designNotes: "Minimalist, slate palette",
};

describe("extractScaffold", () => {
  it("parses valid scaffold JSON", () => {
    const result = extractScaffold(JSON.stringify(VALID_SCAFFOLD));
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.files[0].path).toBe("/App.js");
    expect(result!.sharedTypes).toContain("User");
  });

  it("parses scaffold wrapped in ```json fence", () => {
    const fenced = "```json\n" + JSON.stringify(VALID_SCAFFOLD) + "\n```";
    const result = extractScaffold(fenced);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
  });

  it("returns null when files array is empty", () => {
    const empty = { ...VALID_SCAFFOLD, files: [] };
    expect(extractScaffold(JSON.stringify(empty))).toBeNull();
  });

  it("returns null when file entry is missing path", () => {
    const bad = {
      files: [{ description: "no path", exports: [], deps: [], hints: "" }],
      sharedTypes: "",
      designNotes: "",
    };
    expect(extractScaffold(JSON.stringify(bad))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(extractScaffold("not json at all")).toBeNull();
  });

  it("returns null when files is not an array", () => {
    const bad = { files: "not array", sharedTypes: "", designNotes: "" };
    expect(extractScaffold(JSON.stringify(bad))).toBeNull();
  });
});

describe("extractScaffoldFromTwoPhase", () => {
  const VALID_SCAFFOLD_TP: ScaffoldData = {
    files: [
      { path: "/App.js", description: "Entry", exports: ["default"], deps: [], hints: "main" },
    ],
    sharedTypes: "type Id = string",
    designNotes: "minimal app",
  };

  // EJ-TP-01: valid two-phase format — returns scaffold from <output> block
  it("EJ-TP-01: 正确解析双阶段输出的 <output> 块", () => {
    const raw = `<thinking>
分析文件依赖关系...
</thinking>

<output>
${JSON.stringify(VALID_SCAFFOLD_TP)}
</output>`;
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
    expect(result?.files[0].path).toBe("/App.js");
  });

  // EJ-TP-02: bare JSON (legacy format) — falls back to extractScaffold
  it("EJ-TP-02: 无 <output> 标签时回退到 extractScaffold 兼容解析", () => {
    const raw = JSON.stringify(VALID_SCAFFOLD_TP);
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
    expect(result?.sharedTypes).toBe("type Id = string");
  });

  // EJ-TP-03: <output> block contains malformed JSON — falls back to bare JSON
  it("EJ-TP-03: <output> 块内 JSON 非法时回退到 bare JSON 解析", () => {
    const raw = `<thinking>...</thinking>\n<output>broken json</output>\n${JSON.stringify(VALID_SCAFFOLD_TP)}`;
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
    expect(result?.files[0].path).toBe("/App.js");
  });

  // EJ-TP-04: completely invalid input — returns null
  it("EJ-TP-04: 完全非法输入返回 null", () => {
    expect(extractScaffoldFromTwoPhase("not json at all")).toBeNull();
  });

  // EJ-TP-05: empty string — returns null
  it("EJ-TP-05: 空字符串返回 null", () => {
    expect(extractScaffoldFromTwoPhase("")).toBeNull();
  });

  // EJ-TP-06: <output> block with fenced JSON inside
  it("EJ-TP-06: <output> 块内包含 ```json 围栏时也能解析", () => {
    const raw = `<thinking>x</thinking>\n<output>\n\`\`\`json\n${JSON.stringify(VALID_SCAFFOLD_TP)}\n\`\`\`\n</output>`;
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
  });

  // EJ-TP-07: realistic truncation — <output> opened, files array complete,
  // but sharedTypes string and </output> were cut by stream timeout.
  // Must salvage the files array and return empty sharedTypes/designNotes.
  it("EJ-TP-07: 尾部截断时仍能抢救 files 数组", () => {
    const truncated = `<thinking>reasoning</thinking>
<output>
{
  "files": [
    { "path": "/App.js", "description": "root", "exports": ["App"], "deps": ["/components/Header.js"], "hints": "main" },
    { "path": "/components/Header.js", "description": "nav", "exports": ["Header"], "deps": [], "hints": "lucide" }
  ],
  "sharedTypes": "/** user type */\\ntype User = {\\n  id: string;\\n  name: string;\\n  email`;
    const result = extractScaffoldFromTwoPhase(truncated);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.files[0].path).toBe("/App.js");
    expect(result!.files[1].path).toBe("/components/Header.js");
    expect(result!.sharedTypes).toBe("");
    expect(result!.designNotes).toBe("");
  });

  // EJ-TP-08: truncation inside files array mid-object — recover
  // all fully-completed entries, drop the partial one.
  it("EJ-TP-08: 截断发生在 files 数组内部时抢救已完成的条目", () => {
    const truncated = `<output>
{
  "files": [
    { "path": "/App.js", "description": "root", "exports": ["App"], "deps": [], "hints": "main" },
    { "path": "/components/Head`;
    const result = extractScaffoldFromTwoPhase(truncated);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0].path).toBe("/App.js");
  });

  // EJ-TP-08b: truncation inside the LAST file's string value — recover
  // all previous complete entries. Mirrors the real production failure
  // where architect was cut inside the last file's `hints` string.
  it("EJ-TP-08b: 截断在最后一个文件的字符串内部时抢救前面完整条目", () => {
    const truncated = `<output>
{
  "files": [
    { "path": "/App.js", "description": "root", "exports": ["App"], "deps": [], "hints": "main" },
    { "path": "/Header.js", "description": "nav", "exports": ["Header"], "deps": [], "hints": "lucide" },
    { "path": "/Footer.js", "description": "foot", "exports": ["Footer"], "deps": [], "hints": "native input[type='checkbox'] with label,`;
    const result = extractScaffoldFromTwoPhase(truncated);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.files[0].path).toBe("/App.js");
    expect(result!.files[1].path).toBe("/Header.js");
  });

  // EJ-TP-08c: truncation before any complete file — cannot recover anything.
  it("EJ-TP-08c: 第一个文件就被截断时返回 null", () => {
    const truncated = `<output>
{
  "files": [
    { "path": "/App.js", "description": "ro`;
    expect(extractScaffoldFromTwoPhase(truncated)).toBeNull();
  });

  // EJ-TP-09: bare JSON (no <output> wrapper) with trailing truncation —
  // matches the exact shape observed in production for password manager bug.
  it("EJ-TP-09: 裸 JSON 尾部截断时也能抢救 files 数组", () => {
    const truncated = `{
  "files": [
    { "path": "/App.js", "description": "root", "exports": ["App"], "deps": [], "hints": "x" }
  ],
  "sharedTypes": "type X = { a: string; b`;
    const result = extractScaffoldFromTwoPhase(truncated);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
    expect(result!.sharedTypes).toBe("");
  });

  // EJ-TP-10: strings inside files array contain brackets and escaped quotes —
  // salvage must not be confused by these.
  it("EJ-TP-10: files 数组内字符串含方括号/转义引号时抢救仍正确", () => {
    const truncated = `<output>
{
  "files": [
    { "path": "/App.js", "description": "uses [brackets] and \\"quotes\\" in hints", "exports": ["App"], "deps": [], "hints": "has ] inside" }
  ],
  "sharedTypes": "truncated`;
    const result = extractScaffoldFromTwoPhase(truncated);
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0].description).toContain("[brackets]");
    expect(result!.files[0].hints).toContain("]");
  });
});
