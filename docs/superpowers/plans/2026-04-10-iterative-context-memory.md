# Iterative Context Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PM → Architect → Engineer pipeline context-aware so Engineer sees V1 code when iterating, and bug/style fixes skip PM+Architect entirely.

**Architecture:** Add an intent classifier that routes user prompts to either a full pipeline (PM→Arch→Engineer+V1 context) or a short-circuit direct-to-Engineer path (bug_fix/style_change). PM receives a structured feature summary from the previous generation so it generates delta PRDs instead of full-rebuild PRDs. Engineer always receives the current version's files when iterating.

**Tech Stack:** TypeScript, Next.js 14 App Router, React 18, Jest (unit tests), existing `/api/generate` SSE route.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | Modify | Add `Intent` type |
| `lib/intent-classifier.ts` | Create | Keyword-based intent classification |
| `lib/agent-context.ts` | Modify | Add `currentFiles` param + two new builders |
| `app/api/generate/route.ts` | Modify | Allow `context` field for PM agent |
| `components/workspace/workspace.tsx` | Modify | Track `lastPmOutput` state, pass `currentFiles` |
| `components/workspace/chat-area.tsx` | Modify | Intent routing, V1 injection, direct path |
| `__tests__/intent-classifier.test.ts` | Create | Unit tests for classifier |
| `__tests__/agent-context.test.ts` | Modify | Tests for new builders + extended signatures |

---

## Task 1: Add `Intent` type to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the type**

Open `lib/types.ts` and add after the `CompletionOptions` interface (after line 128):

```typescript
// Intent of a user's follow-up prompt — drives pipeline routing
export type Intent = "new_project" | "bug_fix" | "feature_add" | "style_change";
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add Intent type for pipeline routing"
```

---

## Task 2: Create `lib/intent-classifier.ts` (TDD)

**Files:**
- Create: `lib/intent-classifier.ts`
- Create: `__tests__/intent-classifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/intent-classifier.test.ts`:

```typescript
import { classifyIntent } from "@/lib/intent-classifier";

describe("classifyIntent", () => {
  describe("no existing code", () => {
    it("returns new_project when hasExistingCode is false", () => {
      expect(classifyIntent("做一个计算器", false)).toBe("new_project");
    });

    it("returns new_project even with bug keywords when no code exists", () => {
      expect(classifyIntent("修复bug", false)).toBe("new_project");
    });
  });

  describe("bug_fix detection", () => {
    it("detects 没有反应", () => {
      expect(classifyIntent("按钮点击没有反应", true)).toBe("bug_fix");
    });

    it("detects 报错", () => {
      expect(classifyIntent("控制台报错了", true)).toBe("bug_fix");
    });

    it("detects 修复", () => {
      expect(classifyIntent("修复一下列表", true)).toBe("bug_fix");
    });

    it("detects 不工作", () => {
      expect(classifyIntent("搜索不工作", true)).toBe("bug_fix");
    });

    it("detects English 'bug'", () => {
      expect(classifyIntent("there's a bug in the form", true)).toBe("bug_fix");
    });

    it("detects 错误", () => {
      expect(classifyIntent("点击出现错误", true)).toBe("bug_fix");
    });
  });

  describe("style_change detection", () => {
    it("detects 颜色", () => {
      expect(classifyIntent("改一下颜色", true)).toBe("style_change");
    });

    it("detects 深色", () => {
      expect(classifyIntent("添加深色模式", true)).toBe("style_change");
    });

    it("detects UI", () => {
      expect(classifyIntent("调整一下UI布局", true)).toBe("style_change");
    });

    it("detects 样式", () => {
      expect(classifyIntent("修改样式", true)).toBe("style_change");
    });
  });

  describe("new_project override", () => {
    it("detects 重新做", () => {
      expect(classifyIntent("重新做一个计算器", true)).toBe("new_project");
    });

    it("detects 全新", () => {
      expect(classifyIntent("做一个全新的应用", true)).toBe("new_project");
    });
  });

  describe("feature_add (default)", () => {
    it("returns feature_add for generic feature requests", () => {
      expect(classifyIntent("增加一个搜索框", true)).toBe("feature_add");
    });

    it("returns feature_add when prompt has no matching keywords", () => {
      expect(classifyIntent("添加用户登录功能", true)).toBe("feature_add");
    });
  });

  describe("keyword priority", () => {
    it("bug_fix takes priority over style keywords (修复样式错误)", () => {
      expect(classifyIntent("修复样式错误", true)).toBe("bug_fix");
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- --testPathPatterns="intent-classifier"
```

Expected: FAIL with "Cannot find module '@/lib/intent-classifier'"

- [ ] **Step 3: Implement `lib/intent-classifier.ts`**

```typescript
import type { Intent } from "@/lib/types";

const BUG_KEYWORDS = [
  "bug", "错误", "不工作", "修复", "报错", "没有反应",
  "失效", "崩溃", "出错", "fix", "broken", "doesn't work",
  "不能用", "失败", "exception", "异常",
];

const STYLE_KEYWORDS = [
  "颜色", "字体", "样式", "布局", "ui", "美化", "主题",
  "color", "font", "style", "layout", "theme", "dark mode", "深色",
  "background", "背景", "间距", "padding", "margin", "设计",
];

const NEW_PROJECT_KEYWORDS = [
  "重新做", "重新设计", "全新", "new project", "start over",
  "重做", "从头", "推倒重来",
];

export function classifyIntent(
  prompt: string,
  hasExistingCode: boolean
): Intent {
  if (!hasExistingCode) return "new_project";

  const lower = prompt.toLowerCase();

  if (BUG_KEYWORDS.some((kw) => lower.includes(kw))) return "bug_fix";
  if (STYLE_KEYWORDS.some((kw) => lower.includes(kw))) return "style_change";
  if (NEW_PROJECT_KEYWORDS.some((kw) => lower.includes(kw))) return "new_project";

  return "feature_add";
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- --testPathPatterns="intent-classifier"
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/intent-classifier.ts __tests__/intent-classifier.test.ts
git commit -m "feat: add keyword-based intent classifier"
```

---

## Task 3: Extend `lib/agent-context.ts` (TDD)

**Files:**
- Modify: `lib/agent-context.ts`
- Modify: `__tests__/agent-context.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/agent-context.test.ts`:

```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildPmIterationContext,
} from "@/lib/agent-context";

// --- New tests for buildEngineerContext with currentFiles ---

describe("buildEngineerContext — with currentFiles", () => {
  const userPrompt = "帮我做一个待办事项应用";
  const pmOutput = "## PRD\n核心功能";
  const archOutput = "## 技术方案";
  const files = { "/App.js": "export default function App() { return <div/> }" };

  it("includes EXISTING FILE marker and file content when currentFiles provided", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput, files);
    expect(result).toContain("EXISTING FILE: /App.js");
    expect(result).toContain("export default function App()");
  });

  it("omits EXISTING FILE section when currentFiles is empty object", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput, {});
    expect(result).not.toContain("EXISTING FILE");
  });

  it("omits EXISTING FILE section when currentFiles not provided", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);
    expect(result).not.toContain("EXISTING FILE");
  });

  it("existing tests still pass — no regression", () => {
    const result = buildEngineerContext(userPrompt, pmOutput, archOutput);
    expect(result).toContain("用户原始需求");
    expect(result).toContain(userPrompt);
    expect(result).toContain(pmOutput);
    expect(result).toContain(archOutput);
  });
});

describe("buildEngineerContextFromStructured — with currentFiles", () => {
  const userPrompt = "加个搜索功能";
  const archOutput = "## 技术方案";
  const pm: PmOutput = {
    intent: "待办事项应用",
    features: ["添加任务"],
    persistence: "localStorage",
    modules: ["TaskList"],
  };
  const files = { "/App.js": "export default function App() {}" };

  it("includes file content when currentFiles provided", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput, files);
    expect(result).toContain("EXISTING FILE: /App.js");
  });

  it("omits file section when currentFiles not provided", () => {
    const result = buildEngineerContextFromStructured(userPrompt, pm, archOutput);
    expect(result).not.toContain("EXISTING FILE");
  });
});

describe("buildDirectEngineerContext", () => {
  const prompt = "按钮点击没有反应";
  const files = {
    "/App.js": "export default function App() { return <button>click</button> }",
  };

  it("includes user prompt labeled as 用户反馈", () => {
    const result = buildDirectEngineerContext(prompt, files);
    expect(result).toContain("用户反馈");
    expect(result).toContain(prompt);
  });

  it("includes existing file content with EXISTING FILE marker", () => {
    const result = buildDirectEngineerContext(prompt, files);
    expect(result).toContain("EXISTING FILE: /App.js");
    expect(result).toContain("export default function App()");
  });

  it("instructs minimal change scope", () => {
    const result = buildDirectEngineerContext(prompt, files);
    expect(result).toContain("最小化改动");
  });

  it("includes all files when multiple files present", () => {
    const multiFiles = {
      "/App.js": "export default function App() {}",
      "/components/Button.js": "export function Button() {}",
    };
    const result = buildDirectEngineerContext(prompt, multiFiles);
    expect(result).toContain("EXISTING FILE: /App.js");
    expect(result).toContain("EXISTING FILE: /components/Button.js");
  });
});

describe("buildPmIterationContext", () => {
  const pm: PmOutput = {
    intent: "待办事项应用",
    features: ["添加任务", "删除任务"],
    persistence: "localStorage",
    modules: ["TaskList", "TaskInput"],
    dataModel: ["id", "text", "done"],
  };

  it("includes existing feature list", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("添加任务");
    expect(result).toContain("删除任务");
    expect(result).toContain("TaskList");
  });

  it("instructs not to redesign existing features", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("不要重新设计");
  });

  it("includes intent", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("待办事项应用");
  });

  it("includes dataModel when present", () => {
    const result = buildPmIterationContext(pm);
    expect(result).toContain("id");
  });

  it("omits dataModel section when not present", () => {
    const pmNoData: PmOutput = {
      intent: pm.intent,
      features: pm.features,
      persistence: pm.persistence,
      modules: pm.modules,
    };
    const result = buildPmIterationContext(pmNoData);
    expect(result).not.toContain("[数据模型]");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- --testPathPatterns="agent-context"
```

Expected: FAIL — `buildDirectEngineerContext` and `buildPmIterationContext` not exported

- [ ] **Step 3: Update `lib/agent-context.ts`**

Replace the entire file with:

```typescript
import type { PmOutput } from "@/lib/types";

/**
 * Builds the full context string passed to the Engineer agent.
 * Combines the user's original prompt, PM's PRD, and Architect's technical plan.
 * Used as fallback when PM output is not structured JSON.
 */
export function buildEngineerContext(
  userPrompt: string,
  pmOutput: string,
  archOutput: string,
  currentFiles?: Record<string, string>
): string {
  const sections = [
    `用户原始需求：\n${userPrompt}`,
    `PM 需求文档（PRD）：\n${pmOutput}`,
    `架构师技术方案：\n${archOutput}`,
  ];

  if (currentFiles && Object.keys(currentFiles).length > 0) {
    const filesSection = Object.entries(currentFiles)
      .map(([path, code]) => `// === EXISTING FILE: ${path} ===\n${code}`)
      .join("\n\n");
    sections.push(
      `当前版本代码（请在此基础上修改，保留已有功能逻辑）：\n${filesSection}`
    );
  }

  return sections.join("\n\n");
}

/**
 * Builds a compact, token-efficient context for the Engineer agent from structured PM output.
 * Uses labeled format that LLMs parse well while minimising token count.
 */
export function buildEngineerContextFromStructured(
  userPrompt: string,
  pm: PmOutput,
  archOutput: string,
  currentFiles?: Record<string, string>
): string {
  const sections = [
    `用户原始需求：\n${userPrompt}`,
    [
      `[意图]: ${pm.intent}`,
      `[功能]: ${pm.features.join(" / ")}`,
      `[持久化]: ${pm.persistence}`,
      `[模块]: ${pm.modules.join(" / ")}`,
      ...(pm.dataModel && pm.dataModel.length > 0
        ? [`[数据模型]: ${pm.dataModel.join(" / ")}`]
        : []),
    ].join("\n"),
    `架构师技术方案：\n${archOutput}`,
  ];

  if (currentFiles && Object.keys(currentFiles).length > 0) {
    const filesSection = Object.entries(currentFiles)
      .map(([path, code]) => `// === EXISTING FILE: ${path} ===\n${code}`)
      .join("\n\n");
    sections.push(
      `当前版本代码（请在此基础上修改，保留已有功能逻辑）：\n${filesSection}`
    );
  }

  return sections.join("\n\n");
}

/**
 * Builds Engineer context for direct bug-fix / style-change path.
 * Skips PM and Architect — sends V1 code directly with user feedback.
 */
export function buildDirectEngineerContext(
  userPrompt: string,
  currentFiles: Record<string, string>
): string {
  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `// === EXISTING FILE: ${path} ===\n${code}`)
    .join("\n\n");

  return [
    `用户反馈：${userPrompt}`,
    `当前版本代码（请定向修复/调整，最小化改动范围，保留其余功能不变）：\n${filesSection}`,
  ].join("\n\n");
}

/**
 * Builds the supplementary context injected into PM when iterating on an existing app.
 * PM sees a structured summary of what already exists so it generates a delta PRD,
 * not a full-rebuild PRD.
 */
export function buildPmIterationContext(pm: PmOutput): string {
  const lines = [
    `当前应用已有以下功能（请在此基础上分析增量需求，不要重新设计已有功能）：`,
    `[意图]: ${pm.intent}`,
    `[功能]: ${pm.features.join(" / ")}`,
    `[持久化]: ${pm.persistence}`,
    `[模块]: ${pm.modules.join(" / ")}`,
  ];

  if (pm.dataModel && pm.dataModel.length > 0) {
    lines.push(`[数据模型]: ${pm.dataModel.join(" / ")}`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- --testPathPatterns="agent-context"
```

Expected: All tests PASS (new and existing)

- [ ] **Step 5: Commit**

```bash
git add lib/agent-context.ts __tests__/agent-context.test.ts
git commit -m "feat: extend agent-context with V1 injection and direct engineer builder"
```

---

## Task 4: Update `/api/generate/route.ts` to allow PM context

**Files:**
- Modify: `app/api/generate/route.ts:52-57`
- Modify: `__tests__/generate-route.test.ts`

The PM case currently ignores `context`. We need it to prepend `context` when present.

- [ ] **Step 1: Write the failing test**

Open `__tests__/generate-route.test.ts` and add inside the existing `describe` block (after the last `it`):

```typescript
it("PM agent: prepends context to user message when context is provided", async () => {
  const mockStream = {
    streamCompletion: jest.fn().mockResolvedValue(undefined),
  };
  (createProvider as jest.Mock).mockReturnValue(mockStream);

  const req = new NextRequest("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify({
      projectId: "proj-1",
      agent: "pm",
      prompt: "添加搜索功能",
      context: "当前应用已有：[功能]: 待办列表",
    }),
  });

  await POST(req);

  const [messages] = mockStream.streamCompletion.mock.calls[0];
  const userMsg = messages.find((m: { role: string }) => m.role === "user");
  expect(userMsg.content).toContain("添加搜索功能");
  expect(userMsg.content).toContain("当前应用已有");
});

it("PM agent: uses plain prompt when context is absent", async () => {
  const mockStream = {
    streamCompletion: jest.fn().mockResolvedValue(undefined),
  };
  (createProvider as jest.Mock).mockReturnValue(mockStream);

  const req = new NextRequest("http://localhost/api/generate", {
    method: "POST",
    body: JSON.stringify({
      projectId: "proj-1",
      agent: "pm",
      prompt: "做一个日历",
    }),
  });

  await POST(req);

  const [messages] = mockStream.streamCompletion.mock.calls[0];
  const userMsg = messages.find((m: { role: string }) => m.role === "user");
  expect(userMsg.content).toBe("用户需求：做一个日历");
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- --testPathPatterns="generate-route"
```

Expected: New PM-context test FAILS (context currently ignored)

- [ ] **Step 3: Update `app/api/generate/route.ts` lines 52–57**

Find this block:

```typescript
const userContent =
  agent === "pm"
    ? `用户需求：${prompt}`
    : agent === "architect"
      ? `PM 的产品需求文档：\n\n${context}\n\n请基于以上 PRD 设计多文件 React 项目的文件结构和技术方案。`
      : `请根据以下完整背景信息，生成完整可运行的 React 组件代码：\n\n${context}`;
```

Replace with:

```typescript
const userContent =
  agent === "pm"
    ? context
      ? `用户需求：${prompt}\n\n${context}`
      : `用户需求：${prompt}`
    : agent === "architect"
      ? `PM 的产品需求文档：\n\n${context}\n\n请基于以上 PRD 设计多文件 React 项目的文件结构和技术方案。`
      : `请根据以下完整背景信息，生成完整可运行的 React 组件代码：\n\n${context}`;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- --testPathPatterns="generate-route"
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/route.ts __tests__/generate-route.test.ts
git commit -m "feat: allow PM agent to receive iteration context"
```

---

## Task 5: Update `components/workspace/workspace.tsx`

**Files:**
- Modify: `components/workspace/workspace.tsx`

Add `lastPmOutput` state and pass `currentFiles` + `lastPmOutput` to ChatArea.

- [ ] **Step 1: Update `workspace.tsx`**

Add the import at line 8 (after existing imports):

```typescript
import type { PmOutput } from "@/lib/types";
```

Add state after the existing `const [previewingVersion, ...]` line (around line 46):

```typescript
const [lastPmOutput, setLastPmOutput] = useState<PmOutput | null>(null);
```

Update the `<ChatArea ...>` JSX block (around line 106). Add three new props:

```tsx
<ChatArea
  initialModel={project.preferredModel ?? undefined}
  project={project}
  messages={messages}
  onMessagesChange={setMessages}
  onGeneratingChange={setIsGenerating}
  isPreviewingHistory={previewingVersion !== null}
  currentFiles={currentFiles}
  lastPmOutput={lastPmOutput}
  onPmOutputGenerated={setLastPmOutput}
  onFilesGenerated={(files, version) => {
    setCurrentFiles(files);
    setVersions((prev) => [...prev, version]);
    setPreviewingVersion(null);
  }}
/>
```

- [ ] **Step 2: Run build to verify types compile**

```bash
npm run build 2>&1 | head -40
```

Expected: Errors about unknown props on ChatArea (Task 6 not done yet). Check no OTHER errors exist.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/workspace.tsx
git commit -m "feat: pass currentFiles and lastPmOutput to ChatArea"
```

---

## Task 6: Update `components/workspace/chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

This is the main wiring task. Three changes:
1. Accept new props (`currentFiles`, `lastPmOutput`, `onPmOutputGenerated`)
2. Add intent classification + direct engineer path for bug_fix/style_change
3. Inject V1 context into Engineer (and PM feature summary) for feature_add

- [ ] **Step 1: Add imports at the top of chat-area.tsx**

After the existing imports (around line 16), add:

```typescript
import { classifyIntent } from "@/lib/intent-classifier";
import {
  buildDirectEngineerContext,
  buildPmIterationContext,
} from "@/lib/agent-context";
import type { PmOutput } from "@/lib/types";
```

- [ ] **Step 2: Extend `ChatAreaProps` interface**

Find the `ChatAreaProps` interface (around line 28). Add three new readonly props:

```typescript
interface ChatAreaProps {
  project: Project;
  messages: ProjectMessage[];
  onMessagesChange: (messages: ProjectMessage[]) => void;
  onFilesGenerated: (files: Record<string, string>, version: ProjectVersion) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  isPreviewingHistory?: boolean;
  initialModel?: string;
  currentFiles: Record<string, string>;
  lastPmOutput?: PmOutput | null;
  onPmOutputGenerated?: (pm: PmOutput) => void;
}
```

- [ ] **Step 3: Destructure the new props in the function signature**

Find the function signature (around line 47):

```typescript
export function ChatArea({
  project,
  messages,
  onMessagesChange,
  onFilesGenerated,
  onGeneratingChange,
  isPreviewingHistory = false,
  initialModel,
}: ChatAreaProps) {
```

Replace with:

```typescript
export function ChatArea({
  project,
  messages,
  onMessagesChange,
  onFilesGenerated,
  onGeneratingChange,
  isPreviewingHistory = false,
  initialModel,
  currentFiles,
  lastPmOutput,
  onPmOutputGenerated,
}: ChatAreaProps) {
```

- [ ] **Step 4: Add intent classification at the top of `handleSubmit`**

Find `async function handleSubmit(prompt: string) {` (around line 128).

After the line `abortControllerRef.current = abortController;` (around line 135), add:

```typescript
// Phase 0: Intent classification — routes to short-circuit or full pipeline
const hasExistingCode = Object.keys(currentFiles).length > 0;
const intent = classifyIntent(prompt, hasExistingCode);
```

- [ ] **Step 5: Add direct engineer path for bug_fix / style_change**

Find the line `const outputs: Record<AgentRole, string> = { pm: "", architect: "", engineer: "" };` (around line 155).

After `let lastCode = "";` (around line 157), add the direct path block:

```typescript
// Phase 2 (short-circuit): bug_fix / style_change → skip PM + Architect
if (intent === "bug_fix" || intent === "style_change") {
  updateAgentState("engineer", { status: "thinking", output: "" });
  const directContext = buildDirectEngineerContext(prompt, currentFiles);

  const directResponse = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: project.id,
      prompt,
      agent: "engineer",
      context: directContext,
      modelId: selectedModel,
    }),
    signal: abortController.signal,
  });

  if (!directResponse.ok) {
    const errorText = await directResponse.text();
    throw new Error(`HTTP ${directResponse.status}: ${errorText.slice(0, 200)}`);
  }
  if (!directResponse.body) throw new Error("No response body");

  updateAgentState("engineer", { status: "streaming" });

  const directReader = directResponse.body.getReader();
  const directDecoder = new TextDecoder();
  let directOutput = "";
  let directSseBuffer = "";
  let directCode = "";

  const processDirectLines = (lines: string[]) => {
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { type: string; content?: string; code?: string; error?: string };
        if (event.type === "chunk") {
          directOutput += event.content ?? "";
          updateAgentState("engineer", { output: directOutput });
        } else if (event.type === "code_complete") {
          if (event.code) directCode = event.code;
        } else if (event.type === "reset") {
          directOutput = "";
          updateAgentState("engineer", { output: "" });
        } else if (event.type === "error") {
          throw new Error(event.error ?? "Stream error");
        }
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) continue;
        throw parseErr;
      }
    }
  };

  while (true) {
    const { done, value } = await directReader.read();
    directSseBuffer += done
      ? directDecoder.decode()
      : directDecoder.decode(value, { stream: true });
    const lines = directSseBuffer.split("\n");
    directSseBuffer = done ? "" : (lines.pop() ?? "");
    processDirectLines(lines);
    if (done) break;
  }
  if (directSseBuffer.trim()) processDirectLines([directSseBuffer]);

  updateAgentState("engineer", { status: "done", output: directOutput });

  const directMsg: ProjectMessage = {
    id: `temp-agent-engineer-${Date.now()}`,
    projectId: project.id,
    role: "engineer",
    content: directOutput,
    metadata: null,
    createdAt: new Date(),
  };
  onMessagesChange([...currentMessages, directMsg]);
  await persistMessage("engineer", directOutput, {
    agentName: AGENTS.engineer.name,
    agentColor: AGENTS.engineer.color,
  });

  if (directCode) {
    const res = await fetchAPI("/api/versions", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        code: directCode,
        description: prompt.slice(0, 80),
      }),
    });
    const version = await res.json();
    onFilesGenerated({ "/App.js": directCode }, version);
  }

  return; // skip full pipeline
}
```

Note: this `return` is inside the `try` block — the `finally` block still runs to reset state.

- [ ] **Step 6: Inject PM feature summary for feature_add**

Find the context assignment block inside the `for (const agentRole of AGENT_ORDER)` loop (around line 344):

```typescript
const context =
  agentRole === "pm"
    ? undefined
    : agentRole === "architect"
      ? outputs.pm
      : parsedPm
        ? buildEngineerContextFromStructured(prompt, parsedPm, outputs.architect)
        : buildEngineerContext(prompt, outputs.pm, outputs.architect);
```

Replace with:

```typescript
const context =
  agentRole === "pm"
    ? (intent === "feature_add" && lastPmOutput)
        ? buildPmIterationContext(lastPmOutput)
        : undefined
    : agentRole === "architect"
      ? outputs.pm
      : parsedPm
        ? buildEngineerContextFromStructured(
            prompt,
            parsedPm,
            outputs.architect,
            hasExistingCode ? currentFiles : undefined
          )
        : buildEngineerContext(
            prompt,
            outputs.pm,
            outputs.architect,
            hasExistingCode ? currentFiles : undefined
          );
```

- [ ] **Step 7: Save PM output after full pipeline completes**

Find the end of the main `try` block — after the `for (const agentRole of AGENT_ORDER)` loop ends and the legacy `if (lastCode)` block (around line 461):

```typescript
// Legacy single-file path
if (lastCode) {
  const res = await fetchAPI("/api/versions", {
    ...
  });
  ...
}
```

Immediately after this `if (lastCode)` block, add:

```typescript
// Persist PM output so next iteration can inject feature summary
if (parsedPm) {
  onPmOutputGenerated?.(parsedPm);
}
```

- [ ] **Step 8: Run build to verify no TypeScript errors**

```bash
npm run build 2>&1 | head -60
```

Expected: Build succeeds (or only pre-existing errors unrelated to these changes)

- [ ] **Step 9: Run all tests**

```bash
npm test
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 10: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: add intent routing and V1 context injection to ChatArea"
```

---

## Task 7: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test new_project flow (no regression)**

1. Create a new project
2. Submit: "做一个计算器"
3. Verify: PM → Architect → Engineer runs normally
4. Verify: A working calculator app appears in preview

- [ ] **Step 3: Test feature_add flow**

1. With the calculator project open, submit: "加一个历史记录功能"
2. Verify: PM → Architect → Engineer runs (full pipeline)
3. Verify: Engineer's context includes the V1 calculator code (check network tab → `/api/generate` request body → `context` field contains "EXISTING FILE")
4. Verify: The generated app has both calculator AND history features

- [ ] **Step 4: Test bug_fix short-circuit**

1. Submit: "输入框报错了"
2. Verify: Only Engineer agent activates (PM and Architect stay idle in the status bar)
3. Verify: Generation is faster (only one API call)
4. Verify: Network tab shows single `/api/generate` call with `agent: "engineer"` and context containing "EXISTING FILE"

- [ ] **Step 5: Test style_change short-circuit**

1. Submit: "改一下颜色，换成蓝色主题"
2. Verify: Only Engineer activates
3. Verify: Output preserves the app logic while updating colors

- [ ] **Step 6: Commit smoke test confirmation**

```bash
git add -p  # stage only if any fixups were needed
git commit -m "feat: iterative context memory — full pipeline working"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Phase 0 (Intent Classification) → Task 2
- ✅ Phase 1 (Context Assembly — PM feature summary) → Task 3 + Task 6 Step 6
- ✅ Phase 2 routing (bug_fix/style_change direct path) → Task 6 Step 5
- ✅ Phase 3 Engineer gets V1 code → Task 3 + Task 6 Step 6
- ✅ Phase 4 background feature extraction → simplified: PM output saved to state (Task 6 Step 7), no async extraction needed
- ✅ `workspace.tsx` passes `currentFiles` → Task 5
- ✅ `/api/generate` PM context → Task 4

**Placeholder scan:** No TBD, all code blocks complete.

**Type consistency:**
- `buildDirectEngineerContext` defined in Task 3, imported in Task 6 Step 1 ✅
- `buildPmIterationContext` defined in Task 3, imported in Task 6 Step 1 ✅
- `classifyIntent` defined in Task 2, imported in Task 6 Step 1 ✅
- `Intent` type defined in Task 1, used in Task 2 ✅
- `PmOutput` used in Task 3 (existing import), Task 5, Task 6 ✅
- `currentFiles` prop typed as `Record<string, string>` in Task 6, matches workspace state type ✅
