# Per-Module Scene Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global scene rule injection in the complex pipeline with per-module scene classification, so each module receives only the scene rules relevant to its purpose.

**Architecture:** Extend `ModuleDefinition` with an optional `sceneType` field. The Decomposer prompt instructs the LLM to annotate each module with its primary scene type. `validateDecomposerOutput()` validates the field. Module-level Architect and Engineer contexts use the module's own `sceneType` instead of the global `detectedScenes`. Skeleton phase retains the global scene classification. The `checkDisallowedImports` post-processing uses a union of all module scene types.

**Tech Stack:** TypeScript, React, Next.js

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | Modify | Add `sceneType?: Scene` to `ModuleDefinition` |
| `lib/generate-prompts.ts` | Modify | Update Decomposer system prompt to include `sceneType` in module output schema |
| `lib/decomposer.ts` | Modify | Validate `sceneType` field in `isModuleDefinition` and `validateDecomposerOutput` |
| `lib/agent-context.ts` | Modify | `buildModuleArchitectContext` uses per-module scene type; `buildDecomposerContext` passes global scenes as hint |
| `components/workspace/chat-area.tsx` | Modify | Module engineer call uses per-module scene rules instead of global `detectedScenes` |
| `__tests__/decomposer.test.ts` | Modify | Add tests for `sceneType` validation |
| `__tests__/scene-rules-per-module.test.ts` | Create | Integration tests for per-module scene rule injection |

---

### Task 1: Add `sceneType` to `ModuleDefinition`

**Files:**
- Modify: `lib/types.ts:269-275`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/decomposer.test.ts — add to the top-level VALID_OUTPUT fixture
// This test verifies that a ModuleDefinition with sceneType is parseable.
// Add this test case inside the "parseDecomposerOutput" describe block:

it("DC-09: parses module with sceneType field", () => {
  const withScene: DecomposerOutput = {
    ...VALID_OUTPUT,
    modules: VALID_OUTPUT.modules.map((m, i) => ({
      ...m,
      sceneType: i === 0 ? "crud" : "dashboard",
    })),
  };
  const result = parseDecomposerOutput(JSON.stringify(withScene));
  expect(result).not.toBeNull();
  expect((result?.modules[0] as any).sceneType).toBe("crud");
  expect((result?.modules[1] as any).sceneType).toBe("dashboard");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="decomposer" --testNamePattern="DC-09"`
Expected: FAIL — `sceneType` not on `ModuleDefinition` type (or passes trivially if TS doesn't block, but we need the type for downstream tasks)

- [ ] **Step 3: Add `sceneType` to `ModuleDefinition` in `lib/types.ts`**

```typescript
// lib/types.ts — ModuleDefinition (around line 269)
export interface ModuleDefinition {
  readonly name: string;
  readonly description: string;
  readonly estimatedFiles: number;
  readonly deps: readonly string[];
  readonly interface: ModuleInterface;
  readonly sceneType?: Scene;  // ← ADD THIS LINE
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="decomposer" --testNamePattern="DC-09"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts __tests__/decomposer.test.ts
git commit -m "feat: add optional sceneType field to ModuleDefinition"
```

---

### Task 2: Update Decomposer prompt to emit `sceneType`

**Files:**
- Modify: `lib/generate-prompts.ts:7-41`

- [ ] **Step 1: Update `getDecomposerSystemPrompt()` to include `sceneType` in the module schema**

In `lib/generate-prompts.ts`, find the `getDecomposerSystemPrompt()` function. Add `sceneType` to the module JSON schema example and add a rule explaining how to assign it.

```typescript
// In getDecomposerSystemPrompt(), replace the modules array example inside the JSON schema:
// BEFORE:
//   "modules": [
//     {
//       "name": "模块名（kebab-case）",
//       "description": "模块功能描述（50字以内）",
//       "estimatedFiles": 3,
//       "deps": ["依赖的其他模块名"],
//       "interface": { ... }
//     }
//   ],

// AFTER:
//   "modules": [
//     {
//       "name": "模块名（kebab-case）",
//       "description": "模块功能描述（50字以内）",
//       "estimatedFiles": 3,
//       "deps": ["依赖的其他模块名"],
//       "sceneType": "game|game-engine|game-canvas|dashboard|crud|multiview|animation|persistence|general",
//       "interface": { ... }
//     }
//   ],
```

Add a new rule to the rules list:

```
8. sceneType 标注该模块的主要场景类型，决定生成时注入的编码规则：
   - game / game-engine / game-canvas：游戏逻辑模块（useRef 状态、requestAnimationFrame）
   - dashboard：数据可视化模块（纯 SVG 图表）
   - crud：增删改查表单模块
   - multiview：多视图切换模块
   - animation：动画交互模块
   - persistence：数据持久化模块
   - general：通用 UI 模块（无特殊规则）
   每个模块根据其实际功能选择最匹配的单一类型，不是项目整体类型
```

- [ ] **Step 2: Verify prompt compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/generate-prompts.ts
git commit -m "feat: add sceneType field to Decomposer prompt schema"
```

---

### Task 3: Validate `sceneType` in Decomposer output parsing

**Files:**
- Modify: `lib/decomposer.ts:36-49` (isModuleDefinition)
- Modify: `lib/decomposer.ts:101-128` (validateDecomposerOutput)
- Test: `__tests__/decomposer.test.ts`

- [ ] **Step 1: Write failing tests for sceneType validation**

Add these tests to `__tests__/decomposer.test.ts`:

```typescript
// Inside "parseDecomposerOutput" describe block:

it("DC-10: module without sceneType defaults to parsing success (field is optional)", () => {
  const result = parseDecomposerOutput(JSON.stringify(VALID_OUTPUT));
  expect(result).not.toBeNull();
  expect(result?.modules[0]).not.toHaveProperty("sceneType");
});

// Inside "validateDecomposerOutput" describe block:

it("DC-V-08: invalid sceneType is replaced with 'general'", () => {
  const withBadScene: DecomposerOutput = {
    ...VALID_OUTPUT,
    modules: VALID_OUTPUT.modules.map((m) => ({
      ...m,
      sceneType: "nonexistent-scene" as any,
    })),
  };
  const result = validateDecomposerOutput(withBadScene);
  expect((result.modules[0] as any).sceneType).toBe("general");
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
  expect((result.modules[0] as any).sceneType).toBe("crud");
  expect((result.modules[1] as any).sceneType).toBe("dashboard");
});

it("DC-V-10: missing sceneType defaults to 'general' after validation", () => {
  const result = validateDecomposerOutput(VALID_OUTPUT);
  expect((result.modules[0] as any).sceneType).toBe("general");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="decomposer" --testNamePattern="DC-V-0[89]|DC-V-10"`
Expected: FAIL — validation logic doesn't exist yet

- [ ] **Step 3: Update `isModuleDefinition` to accept optional `sceneType`**

In `lib/decomposer.ts`, the `isModuleDefinition` function should accept `sceneType` as optional. Since it's optional, no change is needed for parsing — but add a check that if present, it must be a string:

```typescript
// lib/decomposer.ts — isModuleDefinition (around line 36)
// After the existing checks, add:
  if ("sceneType" in obj && typeof obj.sceneType !== "string") return false;
```

- [ ] **Step 4: Update `validateDecomposerOutput` to sanitize `sceneType`**

In `lib/decomposer.ts`, import `Scene` type and add validation logic inside `validateDecomposerOutput`:

```typescript
// At top of file, update import:
import type { DecomposerOutput, ModuleDefinition, Scene } from "@/lib/types";

// Inside validateDecomposerOutput, after the existing cleanedModules map (around line 110-114),
// add a new step to validate/default sceneType:

const VALID_SCENE_TYPES: ReadonlySet<string> = new Set<Scene>([
  "game", "game-engine", "game-canvas",
  "dashboard", "crud", "multiview",
  "animation", "persistence", "general",
]);

cleanedModules = cleanedModules.map((m) => ({
  ...m,
  sceneType: (m.sceneType && VALID_SCENE_TYPES.has(m.sceneType) ? m.sceneType : "general") as Scene,
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="decomposer"`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/decomposer.ts __tests__/decomposer.test.ts
git commit -m "feat: validate and default sceneType in Decomposer output"
```

---

### Task 4: Pass global scenes as hint to Decomposer context

**Files:**
- Modify: `lib/agent-context.ts:209-244` (buildDecomposerContext)

The `buildDecomposerContext` function already receives `sceneTypes` and appends them as `场景类型：game, animation`. This is fine as-is — it serves as a hint to the Decomposer about the project's overall nature. No code change needed here, but we document the intent:

- [ ] **Step 1: Verify the existing Decomposer context includes scene hint**

Read `lib/agent-context.ts:236-241` and confirm it already appends `场景类型：...` to the context. This tells the Decomposer "this is a game project" so it can assign appropriate `sceneType` per module.

- [ ] **Step 2: No code change needed — mark complete**

The global `detectedScenes` are already passed as a hint string to the Decomposer. The Decomposer uses this to inform its per-module `sceneType` decisions.

---

### Task 5: Use per-module scene type in Module Architect context

**Files:**
- Modify: `lib/agent-context.ts:376-447` (buildModuleArchitectContext)

- [ ] **Step 1: Write the failing test**

Create `__tests__/scene-rules-per-module.test.ts`:

```typescript
import { buildModuleArchitectContext } from "@/lib/agent-context";
import type { PmOutput, ModuleDefinition, Scene } from "@/lib/types";

const mockPm: PmOutput = {
  intent: "消消乐游戏",
  features: ["三消匹配", "连锁消除", "得分系统"],
  persistence: "none",
  modules: ["game-board", "score-panel"],
};

function makeModule(name: string, sceneType: Scene): ModuleDefinition {
  return {
    name,
    description: `${name} module`,
    estimatedFiles: 2,
    deps: [],
    interface: { exports: [], consumes: [], stateContract: "" },
    sceneType,
  };
}

describe("buildModuleArchitectContext — per-module scene", () => {
  it("injects game hint for game-typed module", () => {
    const mod = makeModule("game-board", "game");
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["game", "animation"]);
    expect(ctx).toContain("game");
    // Should NOT contain animation hint since module sceneType is "game"
    expect(ctx).not.toContain("framer-motion");
  });

  it("injects no game hint for general-typed module", () => {
    const mod = makeModule("score-panel", "general");
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["game", "animation"]);
    // Should NOT contain game-specific hints
    expect(ctx).not.toContain("游戏逻辑");
    expect(ctx).not.toContain("碰撞检测");
  });

  it("falls back to global scenes when module has no sceneType", () => {
    const mod: ModuleDefinition = {
      name: "legacy",
      description: "legacy module",
      estimatedFiles: 2,
      deps: [],
      interface: { exports: [], consumes: [], stateContract: "" },
      // no sceneType
    };
    const ctx = buildModuleArchitectContext(mockPm, mod, {}, {}, ["dashboard"]);
    expect(ctx).toContain("dashboard");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="scene-rules-per-module"`
Expected: FAIL — `buildModuleArchitectContext` still uses global `sceneTypes` param

- [ ] **Step 3: Update `buildModuleArchitectContext` to use per-module scene type**

In `lib/agent-context.ts`, modify `buildModuleArchitectContext`:

```typescript
// lib/agent-context.ts — buildModuleArchitectContext (around line 376)
// Change the scene hint injection logic:

export function buildModuleArchitectContext(
  pmOutput: PmOutput,
  module: ModuleDefinition,
  skeletonFiles: Record<string, string>,
  completedModuleFiles: Record<string, string>,
  sceneTypes: Scene[],  // kept for fallback
  registrySummary?: string,
  planPosition?: { layer: number; totalLayers: number },
  consumers?: string[],
  failedModules?: Array<{ name: string; reason: string }>,
  gameSubtype?: GameSubtype
): string {
  const parts: string[] = [];

  // Use per-module scene type if available, fall back to global
  const moduleScenes: Scene[] = module.sceneType && module.sceneType !== "general"
    ? [module.sceneType]
    : sceneTypes;
  const moduleGameSubtype = module.sceneType && ["game", "game-engine", "game-canvas"].includes(module.sceneType)
    ? gameSubtype
    : undefined;

  const sceneHint = getArchitectSceneHint(moduleScenes, moduleGameSubtype);
  if (sceneHint) parts.push(sceneHint);

  // ... rest of function unchanged until the bottom scene type section ...

  // Replace the bottom scene type section:
  const nonGeneral = moduleScenes.filter((s) => s !== "general");
  if (nonGeneral.length > 0) {
    parts.push(`\n## 场景类型: ${nonGeneral.join(", ")}`);
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns="scene-rules-per-module"`
Expected: ALL PASS

- [ ] **Step 5: Run all existing tests to check for regressions**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add lib/agent-context.ts __tests__/scene-rules-per-module.test.ts
git commit -m "feat: use per-module sceneType in Module Architect context"
```

---

### Task 6: Use per-module scene type in Module Engineer prompt

**Files:**
- Modify: `components/workspace/chat-area.tsx:1718`

- [ ] **Step 1: Add test case to `__tests__/scene-rules-per-module.test.ts`**

```typescript
import { getEngineerSceneRules } from "@/lib/scene-rules";

describe("getEngineerSceneRules — per-module usage", () => {
  it("game module gets game rules only", () => {
    const rules = getEngineerSceneRules(["game"], "match3");
    expect(rules).toContain("useRef");
    expect(rules).toContain("match3");
    expect(rules).not.toContain("react-router-dom");
  });

  it("general module gets no rules", () => {
    const rules = getEngineerSceneRules(["general"]);
    expect(rules).toBe("");
  });

  it("crud module gets crud rules only", () => {
    const rules = getEngineerSceneRules(["crud"]);
    expect(rules).toContain("setForm");
    expect(rules).not.toContain("useRef");
    expect(rules).not.toContain("setInterval");
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (this tests existing `getEngineerSceneRules` which already works correctly with single-scene input)

Run: `npm test -- --testPathPatterns="scene-rules-per-module" --testNamePattern="per-module usage"`
Expected: PASS

- [ ] **Step 3: Update `chat-area.tsx` Module Engineer call to use per-module scene**

In `components/workspace/chat-area.tsx`, find the `executeModule` callback inside the orchestrator setup (around line 1718):

```typescript
// BEFORE (line 1718):
sceneRules: getEngineerSceneRules(detectedScenes, gameSubtype),

// AFTER:
sceneRules: getEngineerSceneRules(
  moduleDef.sceneType && moduleDef.sceneType !== "general"
    ? [moduleDef.sceneType]
    : detectedScenes,
  moduleDef.sceneType && ["game", "game-engine", "game-canvas"].includes(moduleDef.sceneType)
    ? gameSubtype
    : undefined
),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add components/workspace/chat-area.tsx __tests__/scene-rules-per-module.test.ts
git commit -m "feat: use per-module sceneType for Engineer scene rules in complex path"
```

---

### Task 7: Preserve global scenes for post-processing and skeleton

**Files:**
- Modify: `components/workspace/chat-area.tsx` (post-processing section, around line 1894)

The skeleton phase and post-processing (`checkDisallowedImports`) should continue using global `detectedScenes` — skeleton defines project-level shared structure, and `checkDisallowedImports` needs the union of all possible scene types to build the correct allow list.

- [ ] **Step 1: Verify skeleton architect still uses global scenes**

Read `chat-area.tsx:1496-1498` and confirm `buildSkeletonArchitectContext` still receives `detectedScenes`. No change needed.

- [ ] **Step 2: Update `checkDisallowedImports` to use union of module scene types**

In `chat-area.tsx`, the post-processing section for the complex path (around line 1894) calls `checkDisallowedImports(allModuleFiles, detectedScenes)`. This should use the **union** of all module scene types plus the global `detectedScenes`, so no module's legitimate packages are falsely blocked:

```typescript
// BEFORE (around line 1894):
const pkgViolations = checkDisallowedImports(allModuleFiles, detectedScenes);

// AFTER:
const allModuleSceneTypes: Scene[] = Array.from(new Set([
  ...detectedScenes,
  ...validated.modules
    .map((m) => m.sceneType)
    .filter((s): s is Scene => s !== undefined),
]));
const pkgViolations = checkDisallowedImports(allModuleFiles, allModuleSceneTypes);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "fix: use union of module scene types for post-processing import checks"
```

---

### Task 8: Update Decomposer context to pass `gameSubtype` hint

**Files:**
- Modify: `lib/agent-context.ts:209-244` (buildDecomposerContext)

The Decomposer needs to know the detected `gameSubtype` so it can assign correct `sceneType` to game-related modules (e.g., `game-canvas` for a match3 board vs `general` for its score panel).

- [ ] **Step 1: Update `buildDecomposerContext` signature and body**

```typescript
// lib/agent-context.ts — buildDecomposerContext
// Add gameSubtype parameter:

export function buildDecomposerContext(
  pmOutput: PmOutput,
  existingFiles: string[],
  sceneTypes: Scene[],
  gameSubtype?: GameSubtype  // ← ADD
): string {
  const sections: string[] = [];

  // ... existing PM PRD summary ...

  // Scene types (if not general)
  const nonGeneralScenes = sceneTypes.filter((s) => s !== "general");
  if (nonGeneralScenes.length > 0) {
    sections.push(`场景类型：${nonGeneralScenes.join(", ")}`);
  }

  // Game subtype hint
  if (gameSubtype && gameSubtype !== "generic") {
    sections.push(`游戏子类型：${gameSubtype}（请据此为游戏核心模块标注对应的 sceneType）`);
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 2: Update the caller in `chat-area.tsx`**

Find the `buildDecomposerContext` call (around line 1403-1407) and pass `gameSubtype`:

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

### Task 9: Full integration verification

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Manual smoke test with "欢乐消消乐"**

Start the dev server and test with the prompt "做一个欢乐消消乐":
1. Verify it takes the complex path (modules > 3 or features > 5)
2. Check the Decomposer output in the Activity panel — each module should have a `sceneType` field
3. Verify that the game-board module gets `game` or `game-canvas` scene rules
4. Verify that the score-panel module gets `general` (no game loop rules)
5. Verify the final app renders and works

Run: `npm run dev`

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: integration fixups for per-module scene rules"
```
