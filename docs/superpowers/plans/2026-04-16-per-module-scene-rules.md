# Per-Module Scene Rules + Engineering Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global scene rule injection in the complex pipeline with per-module scene classification AND LLM-generated engineering hints, so (1) known scenes get targeted hardcoded rules without cross-module contradiction, and (2) unknown scenes get LLM-authored coding guidance instead of nothing.

**Architecture:** Extend `ModuleDefinition` with two fields: `sceneType?: Scene` (enum, for known scene types) and `engineeringHints?: string` (free-text, LLM-generated per-module coding guidance). The Decomposer prompt instructs the LLM to annotate each module. For known scenes (`sceneType !== "general"`), hardcoded rules from `scene-rules.ts` are injected as the primary constraint with `engineeringHints` as supplementary. For unknown scenes (`sceneType === "general"` or absent), only `engineeringHints` are injected. Skeleton phase retains the global scene classification. Post-processing uses a union of all module scene types.

**Tech Stack:** TypeScript, React, Next.js

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | Modify | Add `sceneType?: Scene` and `engineeringHints?: string` to `ModuleDefinition` |
| `lib/generate-prompts.ts` | Modify | Update Decomposer system prompt to include both fields in module output schema |
| `lib/decomposer.ts` | Modify | Validate `sceneType` and preserve `engineeringHints` in parsing and validation |
| `lib/agent-context.ts` | Modify | `buildModuleArchitectContext` uses per-module scene + hints; `buildDecomposerContext` passes global scenes and gameSubtype as hints |
| `components/workspace/chat-area.tsx` | Modify | Module engineer call uses per-module scene rules + engineeringHints |
| `__tests__/decomposer.test.ts` | Modify | Add tests for both new fields |
| `__tests__/per-module-scene.test.ts` | Create | Integration tests for per-module scene rule + hints injection |

---

### Task 1: Add `sceneType` and `engineeringHints` to `ModuleDefinition`

**Files:**
- Modify: `lib/types.ts:269-275`
- Test: `__tests__/decomposer.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/decomposer.test.ts` inside the `"parseDecomposerOutput"` describe block:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="decomposer" --testNamePattern="DC-09"`
Expected: FAIL — fields not on type

- [ ] **Step 3: Add both fields to `ModuleDefinition` in `lib/types.ts`**

```typescript
// lib/types.ts — ModuleDefinition (around line 269)
export interface ModuleDefinition {
  readonly name: string;
  readonly description: string;
  readonly estimatedFiles: number;
  readonly deps: readonly string[];
  readonly interface: ModuleInterface;
  readonly sceneType?: Scene;
  readonly engineeringHints?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="decomposer" --testNamePattern="DC-09"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts __tests__/decomposer.test.ts
git commit -m "feat: add sceneType and engineeringHints to ModuleDefinition"
```

---

### Task 2: Update Decomposer prompt to emit both fields

**Files:**
- Modify: `lib/generate-prompts.ts:7-41`

- [ ] **Step 1: Update `getDecomposerSystemPrompt()`**

In `lib/generate-prompts.ts`, find the `getDecomposerSystemPrompt()` function. Update the module JSON schema example and add rules for both fields.

Replace the module object in the JSON schema:

```
    {
      "name": "模块名（kebab-case）",
      "description": "模块功能描述（50字以内）",
      "estimatedFiles": 3,
      "deps": ["依赖的其他模块名"],
      "sceneType": "game|game-engine|game-canvas|dashboard|crud|multiview|animation|persistence|general",
      "engineeringHints": "该模块的编码要点和技术约束（100字以内）",
      "interface": {
        "exports": ["导出的组件/函数名"],
        "consumes": ["消费的外部类型/组件"],
        "stateContract": "本模块的状态结构描述"
      }
    }
```

Add two new rules at the end of the rules list:

```
8. sceneType 标注该模块的主要场景类型，决定是否注入已知编码规则：
   - game / game-engine / game-canvas：游戏逻辑（useRef 状态、requestAnimationFrame）
   - dashboard：数据可视化（纯 SVG 图表）
   - crud：增删改查表单
   - multiview：多视图切换（useState 路由）
   - animation：动画交互
   - persistence：数据持久化
   - general：不属于以上任何类型
   每个模块根据其实际功能选择最匹配的单一类型，不是项目整体类型
9. engineeringHints 是该模块的编码要点，必须填写。描述该模块实现时需要注意的技术模式、
   状态管理方式、常见陷阱。例如：
   - 音乐播放器模块："Audio 实例用 useRef 持有，播放/暂停状态用 useState，进度条用 rAF 更新 currentTime"
   - 游戏核心模块："游戏状态用 useRef 避免 re-render 导致的无限循环，只有得分/游戏结束用 useState"
   - 纯 UI 模块："无特殊约束，标准 React 函数组件 + Tailwind"
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/generate-prompts.ts
git commit -m "feat: add sceneType + engineeringHints to Decomposer prompt"
```

---

### Task 3: Validate both fields in Decomposer output parsing

**Files:**
- Modify: `lib/decomposer.ts:36-49` (isModuleDefinition)
- Modify: `lib/decomposer.ts:101-128` (validateDecomposerOutput)
- Test: `__tests__/decomposer.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `__tests__/decomposer.test.ts`:

```typescript
// Inside "parseDecomposerOutput" describe:

it("DC-10: module without new fields still parses (backward compat)", () => {
  const result = parseDecomposerOutput(JSON.stringify(VALID_OUTPUT));
  expect(result).not.toBeNull();
  expect(result?.modules[0]).not.toHaveProperty("sceneType");
  expect(result?.modules[0]).not.toHaveProperty("engineeringHints");
});

// Inside "validateDecomposerOutput" describe:

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="decomposer" --testNamePattern="DC-V-0[89]|DC-V-1[012]"`
Expected: FAIL

- [ ] **Step 3: Update `isModuleDefinition` to accept optional new fields**

In `lib/decomposer.ts`, add type guards for optional fields:

```typescript
// After the existing checks in isModuleDefinition, add:
  if ("sceneType" in obj && typeof obj.sceneType !== "string") return false;
  if ("engineeringHints" in obj && typeof obj.engineeringHints !== "string") return false;
```

- [ ] **Step 4: Update `validateDecomposerOutput` to sanitize both fields**

In `lib/decomposer.ts`:

```typescript
// At top of file, update import:
import type { DecomposerOutput, ModuleDefinition, Scene } from "@/lib/types";

// Inside validateDecomposerOutput, after the existing cleanedModules map
// that clamps estimatedFiles and removes phantom deps (around line 110-114),
// add a new step:

const VALID_SCENE_TYPES: ReadonlySet<string> = new Set<Scene>([
  "game", "game-engine", "game-canvas",
  "dashboard", "crud", "multiview",
  "animation", "persistence", "general",
]);

cleanedModules = cleanedModules.map((m) => ({
  ...m,
  sceneType: (m.sceneType && VALID_SCENE_TYPES.has(m.sceneType) ? m.sceneType : "general") as Scene,
  engineeringHints: m.engineeringHints ?? "",
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="decomposer"`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/decomposer.ts __tests__/decomposer.test.ts
git commit -m "feat: validate sceneType and engineeringHints in Decomposer output"
```

---

### Task 4: Pass gameSubtype hint to Decomposer context

**Files:**
- Modify: `lib/agent-context.ts:209-244` (buildDecomposerContext)
- Modify: `components/workspace/chat-area.tsx` (caller)

- [ ] **Step 1: Update `buildDecomposerContext` to accept and inject `gameSubtype`**

In `lib/agent-context.ts`:

```typescript
export function buildDecomposerContext(
  pmOutput: PmOutput,
  existingFiles: string[],
  sceneTypes: Scene[],
  gameSubtype?: GameSubtype  // ← ADD
): string {
  // ... existing sections logic unchanged ...

  // After the existing scene types section, add:
  if (gameSubtype && gameSubtype !== "generic") {
    sections.push(`游戏子类型：${gameSubtype}（请据此为游戏核心模块标注对应的 sceneType，非游戏模块标注 general）`);
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 2: Update the caller in `chat-area.tsx`**

Find the `buildDecomposerContext` call (around line 1403-1407):

```typescript
// BEFORE:
const decomposerContext = buildDecomposerContext(
  parsedPm,
  Object.keys(currentFiles),
  detectedScenes
);

// AFTER:
const decomposerContext = buildDecomposerContext(
  parsedPm,
  Object.keys(currentFiles),
  detectedScenes,
  gameSubtype
);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add lib/agent-context.ts components/workspace/chat-area.tsx
git commit -m "feat: pass gameSubtype hint to Decomposer context"
```

---

### Task 5: Use per-module scene type + hints in Module Architect context

**Files:**
- Modify: `lib/agent-context.ts:376-447` (buildModuleArchitectContext)
- Test: `__tests__/per-module-scene.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/per-module-scene.test.ts`:

```typescript
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
    // Should NOT contain animation hint — module is "game" not "animation"
    expect(ctx).not.toContain("framer-motion");
  });

  it("injects no hardcoded hint for general-typed module", () => {
    const mod = makeModule("score-panel", "general");
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["game", "animation"]);
    // Should NOT contain game-specific hints
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="per-module-scene"`
Expected: FAIL — `buildModuleArchitectContext` still uses global `sceneTypes`

- [ ] **Step 3: Update `buildModuleArchitectContext`**

In `lib/agent-context.ts`, modify the function:

```typescript
export function buildModuleArchitectContext(
  pmOutput: PmOutput,
  module: ModuleDefinition,
  skeletonFiles: Record<string, string>,
  completedModuleFiles: Record<string, string>,
  sceneTypes: Scene[],
  registrySummary?: string,
  planPosition?: { layer: number; totalLayers: number },
  consumers?: string[],
  failedModules?: Array<{ name: string; reason: string }>,
  gameSubtype?: GameSubtype
): string {
  const parts: string[] = [];

  // ── Per-module scene resolution ──
  // Use module's own sceneType if available and non-general; fall back to global
  const moduleScenes: Scene[] = module.sceneType && module.sceneType !== "general"
    ? [module.sceneType]
    : sceneTypes;
  // Only pass gameSubtype if this module is actually a game-type module
  const moduleGameSubtype = module.sceneType && ["game", "game-engine", "game-canvas"].includes(module.sceneType)
    ? gameSubtype
    : undefined;

  const sceneHint = getArchitectSceneHint(moduleScenes, moduleGameSubtype);
  if (sceneHint) parts.push(sceneHint);

  // ── LLM-generated engineering hints (always inject if present) ──
  if (module.engineeringHints) {
    parts.push(`【模块编码要点】${module.engineeringHints}`);
  }

  // ... rest of function body unchanged (PRD, module info, skeleton, registry, etc.) ...
  // EXCEPT: replace the bottom scene type section:

  // BEFORE (around line 441-443):
  //   const nonGeneral = sceneTypes.filter(...)
  // AFTER:
  const nonGeneral = moduleScenes.filter((s) => s !== "general");
  if (nonGeneral.length > 0) {
    parts.push(`\n## 场景类型: ${nonGeneral.join(", ")}`);
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="per-module-scene"`
Expected: ALL PASS

- [ ] **Step 5: Run all existing tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/agent-context.ts __tests__/per-module-scene.test.ts
git commit -m "feat: use per-module sceneType + engineeringHints in Module Architect"
```

---

### Task 6: Use per-module scene rules + hints in Module Engineer prompt

**Files:**
- Modify: `components/workspace/chat-area.tsx:1708-1722`
- Modify: `lib/generate-prompts.ts:258-271` (MultiFileEngineerPromptInput)
- Test: `__tests__/per-module-scene.test.ts`

- [ ] **Step 1: Add `engineeringHints` to `MultiFileEngineerPromptInput`**

In `lib/generate-prompts.ts`, find the `MultiFileEngineerPromptInput` interface (around line 258):

```typescript
interface MultiFileEngineerPromptInput {
  readonly projectId: string;
  readonly targetFiles: readonly ScaffoldFile[];
  readonly sharedTypes: string;
  readonly completedFiles: Record<string, string>;
  readonly designNotes: string;
  readonly sceneRules?: string;
  readonly engineeringHints?: string;  // ← ADD
  readonly existingFiles?: Record<string, string>;
  readonly retryHint?: {
    readonly attempt: number;
    readonly reason: AttemptReason;
    readonly priorTail?: string;
  };
}
```

- [ ] **Step 2: Inject `engineeringHints` into the prompt output**

In `getMultiFileEngineerPrompt` (around line 273), update the destructuring and the prompt template:

```typescript
export function getMultiFileEngineerPrompt(input: MultiFileEngineerPromptInput): string {
  const { projectId, targetFiles, sharedTypes, completedFiles, designNotes, sceneRules, engineeringHints, existingFiles, retryHint } = input;
  // ... existing code ...

  const sceneBlock = sceneRules ? `${sceneRules}\n\n` : "";
  const hintsBlock = engineeringHints ? `【模块编码要点】${engineeringHints}\n\n` : "";

  // In the return template, add hintsBlock after sceneBlock:
  return `${retryBlock}你是一位全栈工程师。根据架构师的文件脚手架，实现以下目标文件。

... (existing prompt body unchanged) ...

${sceneBlock}${hintsBlock}设计说明：${designNotes}

... (rest unchanged) ...`;
}
```

- [ ] **Step 3: Update `chat-area.tsx` Module Engineer call to use per-module scene + hints**

In `components/workspace/chat-area.tsx`, find the `getMultiFileEngineerPrompt` call inside `executeModule` (around line 1711-1722):

```typescript
// BEFORE:
const engineerPrompt = getMultiFileEngineerPrompt({
  projectId: project.id,
  targetFiles: files,
  sharedTypes: moduleScaffold.sharedTypes,
  completedFiles: { ...allFiles, ...moduleFiles },
  designNotes: moduleScaffold.designNotes,
  existingFiles: hasExistingCode ? currentFiles : undefined,
  sceneRules: getEngineerSceneRules(detectedScenes, gameSubtype),
  retryHint: meta.attempt > 1
    ? { attempt: meta.attempt, reason: "string_truncated" as const, priorTail: undefined }
    : undefined,
});

// AFTER:
const moduleSceneForEngineer: Scene[] = moduleDef.sceneType && moduleDef.sceneType !== "general"
  ? [moduleDef.sceneType]
  : detectedScenes;
const moduleGameSubtypeForEngineer = moduleDef.sceneType && ["game", "game-engine", "game-canvas"].includes(moduleDef.sceneType)
  ? gameSubtype
  : undefined;

const engineerPrompt = getMultiFileEngineerPrompt({
  projectId: project.id,
  targetFiles: files,
  sharedTypes: moduleScaffold.sharedTypes,
  completedFiles: { ...allFiles, ...moduleFiles },
  designNotes: moduleScaffold.designNotes,
  existingFiles: hasExistingCode ? currentFiles : undefined,
  sceneRules: getEngineerSceneRules(moduleSceneForEngineer, moduleGameSubtypeForEngineer),
  engineeringHints: moduleDef.engineeringHints || undefined,
  retryHint: meta.attempt > 1
    ? { attempt: meta.attempt, reason: "string_truncated" as const, priorTail: undefined }
    : undefined,
});
```

- [ ] **Step 4: Add integration test**

Add to `__tests__/per-module-scene.test.ts`:

```typescript
import { getEngineerSceneRules } from "@/lib/scene-rules";
import { getMultiFileEngineerPrompt } from "@/lib/generate-prompts";

describe("getMultiFileEngineerPrompt — engineeringHints injection", () => {
  it("includes engineeringHints when provided", () => {
    const prompt = getMultiFileEngineerPrompt({
      projectId: "test",
      targetFiles: [{ path: "/App.jsx", description: "entry", exports: ["App"], deps: [], hints: "entry point" }],
      sharedTypes: "",
      completedFiles: {},
      designNotes: "test app",
      engineeringHints: "Audio 实例用 useRef 持有",
    });
    expect(prompt).toContain("Audio 实例用 useRef");
    expect(prompt).toContain("模块编码要点");
  });

  it("omits hints block when not provided", () => {
    const prompt = getMultiFileEngineerPrompt({
      projectId: "test",
      targetFiles: [{ path: "/App.jsx", description: "entry", exports: ["App"], deps: [], hints: "entry point" }],
      sharedTypes: "",
      completedFiles: {},
      designNotes: "test app",
    });
    expect(prompt).not.toContain("模块编码要点");
  });
});

describe("getEngineerSceneRules — per-module usage", () => {
  it("game module gets game rules only", () => {
    const rules = getEngineerSceneRules(["game"], "match3");
    expect(rules).toContain("useRef");
    expect(rules).toContain("match3");
    expect(rules).not.toContain("react-router-dom");
  });

  it("general module gets empty rules", () => {
    expect(getEngineerSceneRules(["general"])).toBe("");
  });
});
```

- [ ] **Step 5: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: No errors, ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/generate-prompts.ts components/workspace/chat-area.tsx __tests__/per-module-scene.test.ts
git commit -m "feat: inject per-module sceneRules + engineeringHints into Engineer prompt"
```

---

### Task 7: Preserve global scenes for post-processing

**Files:**
- Modify: `components/workspace/chat-area.tsx` (around line 1894)

Post-processing `checkDisallowedImports` needs the **union** of all module scene types so legitimate packages aren't falsely blocked (e.g., a game module's Phaser import shouldn't be blocked because other modules are `general`).

- [ ] **Step 1: Update `checkDisallowedImports` call to use union of scene types**

In `chat-area.tsx`, find the complex-path post-processing call to `checkDisallowedImports` (around line 1894):

```typescript
// BEFORE:
const pkgViolations = checkDisallowedImports(allModuleFiles, detectedScenes);

// AFTER:
const allModuleSceneTypes: Scene[] = Array.from(new Set<Scene>([
  ...detectedScenes,
  ...validated.modules
    .map((m) => m.sceneType)
    .filter((s): s is Scene => s !== undefined),
]));
const pkgViolations = checkDisallowedImports(allModuleFiles, allModuleSceneTypes);
```

- [ ] **Step 2: Verify skeleton phase is unchanged**

Confirm `buildSkeletonArchitectContext` (around line 1496-1498) still receives `detectedScenes` — no change needed.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "fix: use union of module scene types for post-processing import checks"
```

---

### Task 8: Full integration verification

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Manual smoke test — known scene: "做一个欢乐消消乐"**

Start dev server and test:
1. Verify complex path is taken
2. Check Activity panel — each module should have `sceneType` and `engineeringHints`
3. Verify game-board module gets `game` scene rules
4. Verify score-panel gets `general` (no game loop rules) but has engineering hints
5. Verify app renders and works

Run: `npm run dev`

- [ ] **Step 5: Manual smoke test — unknown scene: "做一个音乐播放器"**

1. Verify complex path or simple path based on PM output
2. If complex: check that modules have `engineeringHints` with audio-specific guidance
3. Verify no scene rules are injected (all modules should be `general`)
4. Verify the LLM-generated hints compensate for lack of hardcoded rules

- [ ] **Step 6: Manual smoke test — simple path regression: "帮我修一下这个 bug"**

1. Verify direct path is still taken (intent = bug_fix)
2. Verify scene rules still work globally for direct path (no regression)

- [ ] **Step 7: Commit any fixups**

```bash
git add -A
git commit -m "fix: integration fixups for per-module scene rules"
```
