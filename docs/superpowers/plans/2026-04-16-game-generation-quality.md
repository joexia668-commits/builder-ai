# Game Generation Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve game generation quality by adding game-specific architecture templates (Phase 1) and an automatic error feedback loop (Phase 2).

**Architecture:** Phase 1 adds `GameSubtype` classification and per-subtype Architect/Engineer hints injected through the existing `scene-rules.ts` system. Phase 2 captures Vite build errors and iframe runtime errors, pipes them into an auto-fix Engineer request (max 3 rounds) before saving the version.

**Tech Stack:** TypeScript, React, WebContainer API, existing SSE pipeline.

---

## File Structure

### Phase 1: Game Architecture Templates

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | Modify | Add `GameSubtype` type |
| `lib/scene-classifier.ts` | Modify | Add `classifyGameSubtype()` function |
| `lib/scene-rules.ts` | Modify | Add Architect hint templates + Engineer subtype rules per game subtype |
| `components/workspace/chat-area.tsx` | Modify | Call `classifyGameSubtype`, pass to `getEngineerSceneRules`/`getArchitectSceneHint` |
| `__tests__/scene-classifier.test.ts` | Modify | Tests for `classifyGameSubtype()` |
| `__tests__/scene-rules.test.ts` | Modify | Tests for subtype-enhanced rules |

### Phase 2: Error Feedback Loop

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/error-collector.ts` | Create | Error aggregation, dedup, truncation, noise filtering |
| `lib/agent-context.ts` | Modify | Add `buildAutoFixContext()` |
| `lib/container-runtime.ts` | Modify | Add `onViteError` callback to `mountAndStart`/`mountIncremental` |
| `components/preview/preview-frame.tsx` | Modify | Capture iframe runtime errors via postMessage, expose `onViteError`/`onRuntimeError` callbacks |
| `components/workspace/chat-area.tsx` | Modify | Auto-fix loop orchestration after `onFilesGenerated` |
| `__tests__/error-collector.test.ts` | Create | Tests for error collector |
| `__tests__/agent-context-autofix.test.ts` | Create | Tests for `buildAutoFixContext` |

---

## Phase 1: Game Architecture Templates

### Task 1: Add `GameSubtype` type to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts:238` (after `Intent` type)

- [ ] **Step 1: Add the type**

In `lib/types.ts`, after the `Intent` type (line 238), add:

```typescript
// Game subtype for fine-grained game architecture templates
export type GameSubtype = "match3" | "snake" | "tetris" | "platformer" | "card" | "board" | "generic";
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `GameSubtype`.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add GameSubtype type definition"
```

---

### Task 2: Add `classifyGameSubtype()` to `lib/scene-classifier.ts`

**Files:**
- Modify: `lib/scene-classifier.ts`
- Test: `__tests__/scene-classifier.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scene-classifier.test.ts`:

```typescript
import { classifyGameSubtype } from "@/lib/scene-classifier";

describe("classifyGameSubtype", () => {
  it("GS-01: detects match3 from Chinese keyword 消消乐", () => {
    expect(classifyGameSubtype("做一个消消乐游戏")).toBe("match3");
  });

  it("GS-02: detects match3 from English keyword", () => {
    expect(classifyGameSubtype("build a match-3 puzzle")).toBe("match3");
  });

  it("GS-03: detects match3 from candy crush keyword", () => {
    expect(classifyGameSubtype("make a candy crush clone")).toBe("match3");
  });

  it("GS-04: detects snake subtype", () => {
    expect(classifyGameSubtype("做一个贪吃蛇")).toBe("snake");
  });

  it("GS-05: detects tetris subtype", () => {
    expect(classifyGameSubtype("做俄罗斯方块")).toBe("tetris");
  });

  it("GS-06: detects platformer subtype", () => {
    expect(classifyGameSubtype("做一个马里奥平台跳跃游戏")).toBe("platformer");
  });

  it("GS-07: detects card subtype", () => {
    expect(classifyGameSubtype("做一个纸牌游戏")).toBe("card");
  });

  it("GS-08: detects board subtype", () => {
    expect(classifyGameSubtype("做一个五子棋")).toBe("board");
  });

  it("GS-09: returns generic for unrecognized game", () => {
    expect(classifyGameSubtype("做一个游戏")).toBe("generic");
  });

  it("GS-10: uses PM gameType when prompt keywords are ambiguous", () => {
    const pm = { intent: "test", features: [], persistence: "none" as const, modules: [], gameType: "puzzle" };
    expect(classifyGameSubtype("做一个游戏", pm)).toBe("match3");
  });

  it("GS-11: prompt keyword takes priority over PM gameType", () => {
    const pm = { intent: "test", features: [], persistence: "none" as const, modules: [], gameType: "platformer" };
    expect(classifyGameSubtype("做一个贪吃蛇游戏", pm)).toBe("snake");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="scene-classifier" --testNamePattern="GS-" 2>&1 | tail -10`
Expected: FAIL — `classifyGameSubtype` is not exported.

- [ ] **Step 3: Implement `classifyGameSubtype`**

In `lib/scene-classifier.ts`, add at the end of the file (after `classifySceneFromPm`):

```typescript
import type { Scene, PmOutput, GameSubtype } from "@/lib/types";

const GAME_SUBTYPE_KEYWORDS: Record<Exclude<GameSubtype, "generic">, readonly string[]> = {
  match3: ["消消乐", "三消", "match-3", "match3", "candy crush", "bejeweled", "宝石迷阵", "宝石"],
  snake: ["贪吃蛇", "snake"],
  tetris: ["俄罗斯方块", "tetris", "方块下落"],
  platformer: ["马里奥", "mario", "平台跳跃", "platformer", "超级玛丽"],
  card: ["纸牌", "扑克", "solitaire", "card game", "卡牌"],
  board: ["棋", "chess", "围棋", "五子棋", "gomoku", "tic-tac", "tictac", "井字棋"],
};

const PM_GAMETYPE_MAP: Record<string, GameSubtype> = {
  puzzle: "match3",
  platformer: "platformer",
  shooter: "generic",
  card: "card",
  simple2d: "generic",
};

/**
 * Classifies the specific game subtype from user prompt and optional PM output.
 * Only meaningful when scene includes "game", "game-engine", or "game-canvas".
 * Prompt keywords take priority; PM gameType is fallback for ambiguous prompts.
 */
export function classifyGameSubtype(prompt: string, pm?: PmOutput): GameSubtype {
  const lower = prompt.toLowerCase();

  for (const [subtype, keywords] of Object.entries(GAME_SUBTYPE_KEYWORDS) as [Exclude<GameSubtype, "generic">, readonly string[]][]) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return subtype;
    }
  }

  // Fallback to PM gameType if no prompt keyword matched
  if (pm?.gameType) {
    return PM_GAMETYPE_MAP[pm.gameType] ?? "generic";
  }

  return "generic";
}
```

Note: Update the existing import at line 1 to include `GameSubtype`:

```typescript
import type { Scene, PmOutput, GameSubtype } from "@/lib/types";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="scene-classifier" 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scene-classifier.ts __tests__/scene-classifier.test.ts
git commit -m "feat: add classifyGameSubtype() for fine-grained game routing"
```

---

### Task 3: Add game subtype templates to `lib/scene-rules.ts`

**Files:**
- Modify: `lib/scene-rules.ts`
- Test: `__tests__/scene-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scene-rules.test.ts`:

```typescript
import { getEngineerSceneRules, getArchitectSceneHint } from "@/lib/scene-rules";
import type { GameSubtype } from "@/lib/types";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="scene-rules" --testNamePattern="SR-G" 2>&1 | tail -10`
Expected: FAIL — functions don't accept second parameter yet.

- [ ] **Step 3: Implement subtype templates**

In `lib/scene-rules.ts`, add the subtype data and update function signatures:

```typescript
import type { Scene, GameSubtype } from "@/lib/types";

// --- Existing SCENE_ENGINEER_RULES and SCENE_ARCHITECT_HINTS stay as-is ---

const GAME_SUBTYPE_ENGINEER_RULES: Record<Exclude<GameSubtype, "generic">, string> = {
  match3: `【match3 专属规则】
- 棋盘用二维数组：gridRef.current = Array(8).fill(null).map(() => Array(8).fill(null).map(() => randomColor()))
- 颜色种类 5-6 种，用字符串或数字枚举，每种颜色对应一个 Tailwind bg 色
- swap 必须校验相邻性（上下左右，不含对角线）
- swap 后如果没有 match，必须 swap 回来（无效交换）
- match 检测：遍历每行每列，找连续 ≥3 同色方块
- cascade 循环：清除 match → 上方方块下落填补空位 → 空位顶部随机生成新方块 → 再检测 match → 直到无 match
- 点击交互：第一次点击选中（高亮边框），第二次点击如果与选中方块相邻则执行 swap，否则更换选中目标
- 动画：swap 和下落用 CSS transition（transform + transition-all 300ms），不用 requestAnimationFrame`,

  snake: `【snake 专属规则】
- 蛇身用坐标数组：snakeRef.current = [{x:10,y:10},{x:9,y:10},{x:8,y:10}]
- 方向用 useRef 存储，键盘事件更新方向，禁止直接反向（左→右）
- 每 tick：蛇头按方向移动一格，蛇身跟随（unshift 新头，pop 尾巴；吃到食物不 pop）
- 食物随机生成在非蛇身位置
- 碰撞检测：蛇头碰墙壁或自身 → 游戏结束
- 网格渲染：用 div grid 或 canvas fillRect，每格 20-30px`,

  tetris: `【tetris 专属规则】
- 棋盘用二维数组 (20行×10列)，0=空，非0=已固定方块颜色
- 7 种标准方块（I/O/T/S/Z/J/L），每种用旋转矩阵表示 4 个朝向
- 当前方块用 {type, rotation, x, y} 描述
- 每 tick（setInterval 500-800ms）：方块下落一行，碰到底部或已固定方块则固定
- 固定后检测满行：满行消除，上方整体下移
- 旋转：顺时针旋转 rotation，检测旋转后是否越界或碰撞，碰撞则取消旋转（wall kick 可选）
- 左右移动：检测目标位置是否合法
- 预览：显示下一个方块`,

  platformer: `【platformer 专属规则】
- 使用 Phaser 3 框架（已在 game-engine scene 白名单中）
- 玩家用 this.physics.add.sprite，启用 Arcade Physics 重力
- 平台用 this.physics.add.staticGroup
- 碰撞：this.physics.add.collider(player, platforms)
- 跳跃：着地时按上键设置 player.setVelocityY(-330)，空中不能二段跳
- 左右移动：cursors.left/right 设置 player.setVelocityX(±160)
- 相机跟随：this.cameras.main.startFollow(player)
- 素材用几何图形（this.add.rectangle）或 emoji text`,

  card: `【card 专属规则】
- 牌组用数组，每张牌 {suit, rank, faceUp}
- 洗牌用 Fisher-Yates shuffle
- 拖拽牌堆：onMouseDown 记录起始位置，onMouseMove 更新位置，onMouseUp 判断放置区域
- 翻牌动画：CSS rotateY transition（0deg → 180deg），背面/正面用 backface-visibility
- 牌面渲染：div + Tailwind（圆角白色卡片，花色用 emoji ♠♥♦♣）`,

  board: `【board 专属规则】
- 棋盘用二维数组，每格存储棋子状态（null/player1/player2）
- 回合制：turnRef.current 记录当前回合，点击后切换
- 胜负检测：每次落子后检查行/列/对角线（五子棋检查连续5子，井字棋检查3子）
- 棋盘渲染：CSS grid，每格用 div + onClick，棋子用 emoji 或 SVG circle
- 禁止落子在已占位置
- 悔棋（可选）：用历史数组记录每步`,
};

const GAME_SUBTYPE_ARCHITECT_HINTS: Record<Exclude<GameSubtype, "generic">, string> = {
  match3: `【match3 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 核心游戏逻辑 + 渲染（maxLines: 400）
   - 8×8 网格状态（useRef）、swap、match 检测、cascade、动画、输入处理
   导出：GameBoard (default)
2. /components/GameUI.jsx — 得分、关卡、游戏状态 UI（maxLines: 100）
   导出：GameUI (default)
3. /App.jsx — 入口 + 状态胶水（maxLines: 80）
   导出：App (default)
关键约束：GameBoard 持有全部游戏状态（useRef），通过 onScoreChange/onGameOver 回调通知 App。不要拆分游戏核心逻辑到 utils 文件。匹配检测必须处理 cascade（消除→下落→再检测循环）。`,

  snake: `【snake 游戏架构建议】
推荐文件结构（2-3 文件）：
1. /components/GameBoard.jsx — 蛇身移动、碰撞、食物、渲染（maxLines: 300）
   导出：GameBoard (default)
2. /App.jsx — 入口 + 分数/状态 UI（maxLines: 100）
   导出：App (default)
关键约束：蛇身坐标、方向、食物位置全部用 useRef，只有 score/gameOver 用 useState。`,

  tetris: `【tetris 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 棋盘、方块下落、旋转、消行（maxLines: 400）
   导出：GameBoard (default)
2. /components/NextPiece.jsx — 下一个方块预览（maxLines: 60）
   导出：NextPiece (default)
3. /App.jsx — 入口 + 分数/等级 UI（maxLines: 100）
   导出：App (default)
关键约束：棋盘状态和当前方块用 useRef，消行检测在方块固定时执行。`,

  platformer: `【platformer 游戏架构建议】
推荐文件结构（3 文件）：
1. /scenes/GameScene.js — Phaser.Scene 子类，preload/create/update（maxLines: 400）
   导出：GameScene (default)
2. /components/GameContainer.jsx — Phaser.Game 初始化 + React 包装（maxLines: 80）
   导出：GameContainer (default)
3. /App.jsx — 入口 + HUD overlay（maxLines: 80）
   导出：App (default)
关键约束：所有游戏逻辑在 Phaser Scene 内，React 只做 UI overlay。`,

  card: `【card 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 牌堆、拖拽、翻牌逻辑（maxLines: 350）
   导出：GameBoard (default)
2. /components/Card.jsx — 单张牌渲染 + 翻牌动画（maxLines: 80）
   导出：Card (default)
3. /App.jsx — 入口 + 新游戏/分数 UI（maxLines: 80）
   导出：App (default)
关键约束：牌组状态集中在 GameBoard，Card 是纯展示组件。`,

  board: `【board 游戏架构建议】
推荐文件结构（2-3 文件）：
1. /components/GameBoard.jsx — 棋盘渲染 + 落子 + 胜负判定（maxLines: 300）
   导出：GameBoard (default)
2. /App.jsx — 入口 + 回合/胜负状态 UI（maxLines: 100）
   导出：App (default)
关键约束：棋盘状态用 useRef 或 useState（回合制不需要高频更新），胜负检测在每次落子后执行。`,
};

const GAME_SCENES = new Set<Scene>(["game", "game-engine", "game-canvas"]);
```

Then update the two exported functions to accept an optional `gameSubtype` parameter:

```typescript
export function getEngineerSceneRules(scenes: Scene[], gameSubtype?: GameSubtype): string {
  const blocks = scenes
    .filter((s): s is Exclude<Scene, "general"> => s !== "general")
    .map((s) => SCENE_ENGINEER_RULES[s])
    .filter(Boolean);

  // Append game subtype rules if applicable
  if (gameSubtype && gameSubtype !== "generic" && scenes.some((s) => GAME_SCENES.has(s))) {
    const subtypeRule = GAME_SUBTYPE_ENGINEER_RULES[gameSubtype];
    if (subtypeRule) blocks.push(subtypeRule);
  }

  return blocks.join("\n\n");
}

export function getArchitectSceneHint(scenes: Scene[], gameSubtype?: GameSubtype): string {
  const hints = scenes
    .filter((s): s is Exclude<Scene, "general"> => s !== "general")
    .map((s) => SCENE_ARCHITECT_HINTS[s])
    .filter(Boolean);

  // Append game subtype architecture hints if applicable
  if (gameSubtype && gameSubtype !== "generic" && scenes.some((s) => GAME_SCENES.has(s))) {
    const subtypeHint = GAME_SUBTYPE_ARCHITECT_HINTS[gameSubtype];
    if (subtypeHint) hints.push(subtypeHint);
  }

  if (hints.length === 0) return "";
  return `【场景提示】${hints.join(" ")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="scene-rules" 2>&1 | tail -15`
Expected: All tests PASS (both old and new).

- [ ] **Step 5: Commit**

```bash
git add lib/scene-rules.ts __tests__/scene-rules.test.ts
git commit -m "feat: add game subtype architecture templates and engineer rules"
```

---

### Task 4: Wire `classifyGameSubtype` into `chat-area.tsx` pipeline

**Files:**
- Modify: `components/workspace/chat-area.tsx`

- [ ] **Step 1: Add import**

At the top of `chat-area.tsx`, update the scene-classifier import (line 37):

```typescript
import { classifySceneFromPrompt, classifySceneFromPm, classifyGameSubtype } from "@/lib/scene-classifier";
```

And add `GameSubtype` to the types import (line 55):

```typescript
import type {
  Project,
  ProjectMessage,
  ProjectVersion,
  AgentState,
  AgentRole,
  PmOutput,
  ScaffoldFile,
  ScaffoldData,
  IterationContext,
  IterationRound,
  Scene,
  Complexity,
  GameSubtype,
} from "@/lib/types";
```

- [ ] **Step 2: Add gameSubtype variable and pass it to scene rules**

Find where `sceneTypes` is first computed from `classifySceneFromPrompt`. There will be a line like:

```typescript
const sceneTypes = classifySceneFromPrompt(prompt);
```

Right after it, add:

```typescript
let gameSubtype: GameSubtype | undefined;
const hasGameScene = sceneTypes.some(s => s === "game" || s === "game-engine" || s === "game-canvas");
if (hasGameScene) {
  gameSubtype = classifyGameSubtype(prompt);
}
```

Then, after PM output is parsed (and PM-based scene classification is done), update the subtype if PM provides a gameType:

```typescript
// After classifySceneFromPm(parsedPm) call:
if (hasGameScene || pmSceneTypes.some(s => s === "game" || s === "game-engine" || s === "game-canvas")) {
  gameSubtype = classifyGameSubtype(prompt, parsedPm);
}
```

- [ ] **Step 3: Pass gameSubtype to getEngineerSceneRules and getArchitectSceneHint**

Find all calls to `getEngineerSceneRules(sceneTypes)` in the file and change to `getEngineerSceneRules(sceneTypes, gameSubtype)`.

Find all calls to `getArchitectSceneHint(sceneTypes)` and change to `getArchitectSceneHint(sceneTypes, gameSubtype)`.

Search for these patterns:

```bash
grep -n "getEngineerSceneRules\|getArchitectSceneHint" components/workspace/chat-area.tsx
```

Update each call site.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: wire game subtype classification into pipeline"
```

---

## Phase 2: Error Feedback Loop

### Task 5: Create `lib/error-collector.ts`

**Files:**
- Create: `lib/error-collector.ts`
- Test: `__tests__/error-collector.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/error-collector.test.ts`:

```typescript
import { createErrorCollector } from "@/lib/error-collector";

describe("createErrorCollector", () => {
  it("EC-01: collects a single error", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "SyntaxError: Unexpected token" });
    expect(collector.getErrors()).toHaveLength(1);
  });

  it("EC-02: deduplicates identical messages", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "SyntaxError: Unexpected token" });
    collector.collect({ source: "vite", message: "SyntaxError: Unexpected token" });
    expect(collector.getErrors()).toHaveLength(1);
  });

  it("EC-03: caps at 5 unique errors", () => {
    const collector = createErrorCollector();
    for (let i = 0; i < 10; i++) {
      collector.collect({ source: "vite", message: `Error ${i}` });
    }
    expect(collector.getErrors()).toHaveLength(5);
  });

  it("EC-04: truncates long messages to 300 chars", () => {
    const collector = createErrorCollector();
    const longMsg = "x".repeat(500);
    collector.collect({ source: "runtime", message: longMsg });
    expect(collector.getErrors()[0].message.length).toBeLessThanOrEqual(303); // 300 + "..."
  });

  it("EC-05: filters ResizeObserver noise", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "runtime", message: "ResizeObserver loop completed with undelivered notifications." });
    expect(collector.getErrors()).toHaveLength(0);
  });

  it("EC-06: filters Supabase network errors", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "runtime", message: "FetchError: request to https://xxx.supabase.co/rest/v1/ failed" });
    expect(collector.getErrors()).toHaveLength(0);
  });

  it("EC-07: reset clears all errors", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "Error 1" });
    collector.reset();
    expect(collector.getErrors()).toHaveLength(0);
  });

  it("EC-08: hasErrors returns correct boolean", () => {
    const collector = createErrorCollector();
    expect(collector.hasErrors()).toBe(false);
    collector.collect({ source: "vite", message: "Error 1" });
    expect(collector.hasErrors()).toBe(true);
  });

  it("EC-09: formats errors for LLM context", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "SyntaxError at /App.jsx:10" });
    collector.collect({ source: "runtime", message: "TypeError: x is not a function" });
    const formatted = collector.formatForContext();
    expect(formatted).toContain("错误 1 (编译)");
    expect(formatted).toContain("错误 2 (运行时)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="error-collector" 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement error collector**

Create `lib/error-collector.ts`:

```typescript
export interface CollectedError {
  readonly source: "vite" | "runtime";
  readonly message: string;
}

const MAX_ERRORS = 5;
const MAX_MESSAGE_LENGTH = 300;

const NOISE_PATTERNS = [
  /ResizeObserver/i,
  /supabase\.co/i,
  /Failed to fetch/i,
  /net::ERR_/i,
  /Loading chunk/i,
  /dynamically imported module/i,
];

function isNoise(message: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(message));
}

function truncate(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  return message.slice(0, MAX_MESSAGE_LENGTH) + "...";
}

export function createErrorCollector() {
  let errors: CollectedError[] = [];
  const seenMessages = new Set<string>();

  return {
    collect(error: CollectedError): void {
      if (isNoise(error.message)) return;
      if (seenMessages.has(error.message)) return;
      if (errors.length >= MAX_ERRORS) return;

      seenMessages.add(error.message);
      errors.push({ source: error.source, message: truncate(error.message) });
    },

    getErrors(): readonly CollectedError[] {
      return errors;
    },

    hasErrors(): boolean {
      return errors.length > 0;
    },

    reset(): void {
      errors = [];
      seenMessages.clear();
    },

    /**
     * Formats collected errors into a string suitable for LLM context.
     */
    formatForContext(): string {
      return errors
        .map((e, i) => {
          const label = e.source === "vite" ? "编译" : "运行时";
          return `错误 ${i + 1} (${label}): ${e.message}`;
        })
        .join("\n");
    },
  };
}

export type ErrorCollector = ReturnType<typeof createErrorCollector>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="error-collector" 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/error-collector.ts __tests__/error-collector.test.ts
git commit -m "feat: add error-collector for aggregating WebContainer errors"
```

---

### Task 6: Add `buildAutoFixContext` to `lib/agent-context.ts`

**Files:**
- Modify: `lib/agent-context.ts`
- Test: `__tests__/agent-context-autofix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/agent-context-autofix.test.ts`:

```typescript
import { buildAutoFixContext } from "@/lib/agent-context";

describe("buildAutoFixContext", () => {
  it("AF-01: includes error section in output", () => {
    const ctx = buildAutoFixContext(
      "错误 1 (编译): SyntaxError at /App.jsx:10",
      { "/App.jsx": "export default function App() { return <div> }" }
    );
    expect(ctx).toContain("自动修复模式");
    expect(ctx).toContain("SyntaxError");
    expect(ctx).toContain("// === FILE: /App.jsx ===");
  });

  it("AF-02: includes all file sources", () => {
    const ctx = buildAutoFixContext(
      "错误 1: Error",
      {
        "/App.jsx": "code1",
        "/components/Board.jsx": "code2",
      }
    );
    expect(ctx).toContain("// === FILE: /App.jsx ===");
    expect(ctx).toContain("// === FILE: /components/Board.jsx ===");
  });

  it("AF-03: includes fix constraints", () => {
    const ctx = buildAutoFixContext("错误 1: x", { "/App.jsx": "code" });
    expect(ctx).toContain("只修改导致上述错误的文件");
    expect(ctx).toContain("不要重构");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="agent-context-autofix" 2>&1 | tail -10`
Expected: FAIL — `buildAutoFixContext` not exported.

- [ ] **Step 3: Implement `buildAutoFixContext`**

At the end of `lib/agent-context.ts`, add:

```typescript
/**
 * Builds Engineer context for the auto-fix loop.
 * Receives formatted error strings from the error-collector and current source files.
 * Instructs the Engineer to surgically fix only the reported errors.
 */
export function buildAutoFixContext(
  formattedErrors: string,
  currentFiles: Record<string, string>
): string {
  const filesSection = Object.entries(currentFiles)
    .map(([path, code]) => `// === FILE: ${path} ===\n${code}`)
    .join("\n\n");

  return `【自动修复模式 — WebContainer 检测到以下错误】

${formattedErrors}

当前代码：
${filesSection}

修复要求：
1. 只修改导致上述错误的文件，未受影响的文件不要输出
2. 不要重构、不要加新功能、不要修改 UI 样式
3. 确保所有 import 路径正确，引用的文件确实存在
4. 确保所有变量在使用前已定义
5. 确保所有括号/花括号/方括号配对

输出格式：
- 每个修改的文件以 // === FILE: /path === 开头
- 紧接完整修改后代码
- 不输出 Markdown 围栏或解释文字`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="agent-context-autofix" 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-context.ts __tests__/agent-context-autofix.test.ts
git commit -m "feat: add buildAutoFixContext for error feedback loop"
```

---

### Task 7: Add Vite error callback to `lib/container-runtime.ts`

**Files:**
- Modify: `lib/container-runtime.ts`

- [ ] **Step 1: Update `mountAndStart` signature**

In `lib/container-runtime.ts`, update the `mountAndStart` function signature (line 221) to add an optional `onViteError` callback:

```typescript
export async function mountAndStart(
  files: Record<string, string>,
  dependencies: Record<string, string>,
  onServerReady: (url: string) => void,
  onError: (error: Error) => void,
  onViteError?: (errorText: string) => void
): Promise<void> {
```

- [ ] **Step 2: Update the Vite output handler**

Replace the existing `devProcess.output.pipeTo` block (lines 267-275):

```typescript
    devProcess.output.pipeTo(new WritableStream({
      write(chunk) {
        devOutput.push(chunk);
        // Detect Vite compilation errors and report them
        if (
          chunk.includes("[vite] Internal server error") ||
          chunk.includes("SyntaxError") ||
          chunk.includes("ReferenceError") ||
          chunk.includes("TypeError") ||
          chunk.includes("Cannot find module") ||
          chunk.includes("does not provide an export named")
        ) {
          console.error("[WebContainer:vite]", chunk);
          onViteError?.(chunk);
        }
      }
    })).catch(() => {});
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors. Existing callers that don't pass `onViteError` still work (parameter is optional).

- [ ] **Step 4: Commit**

```bash
git add lib/container-runtime.ts
git commit -m "feat: add onViteError callback to mountAndStart"
```

---

### Task 8: Add runtime error capture to `preview-frame.tsx`

**Files:**
- Modify: `components/preview/preview-frame.tsx`

- [ ] **Step 1: Add callback props**

Update the `PreviewFrameProps` interface (line 16):

```typescript
interface PreviewFrameProps {
  readonly files: Record<string, string>;
  readonly projectId: string;
  readonly scaffoldDependencies?: Record<string, string>;
  readonly onViteError?: (errorText: string) => void;
  readonly onRuntimeError?: (errorText: string) => void;
}
```

Update the destructuring in the component (line 177):

```typescript
export function PreviewFrame({
  files,
  projectId,
  scaffoldDependencies,
  onViteError,
  onRuntimeError,
}: PreviewFrameProps) {
```

- [ ] **Step 2: Pass onViteError to mountAndStart**

In the `startContainer` callback, find the `mountAndStart` call (around line 221) and add the fifth argument:

```typescript
      await mountAndStart(
        prepared,
        deps,
        (url) => {
          setServerUrl(url);
          setStatus("ready");
        },
        (err) => {
          setErrorMessage(err.message);
          setStatus("error");
        },
        onViteError
      );
```

- [ ] **Step 3: Add iframe runtime error listener via postMessage**

After the iframe `useEffect` for incremental mount (around line 284), add a new `useEffect` for runtime error capture:

```typescript
  // Capture runtime errors from preview iframe via postMessage
  useEffect(() => {
    if (!onRuntimeError) return;

    const handler = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === "object" &&
        event.data.type === "runtime-error" &&
        typeof event.data.message === "string"
      ) {
        onRuntimeError(event.data.message);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onRuntimeError]);
```

- [ ] **Step 4: Inject error capture script into index.html**

In `lib/container-runtime.ts`, update `createIndexHtml()` to inject a runtime error capture script that posts errors to the parent window:

```typescript
export function createIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated App</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script>
    <script>
      window.addEventListener('error', function(e) {
        try {
          window.parent.postMessage({
            type: 'runtime-error',
            message: (e.message || '') + (e.filename ? ' at ' + e.filename + ':' + e.lineno : '')
          }, '*');
        } catch(_) {}
      });
      window.addEventListener('unhandledrejection', function(e) {
        try {
          var msg = e.reason instanceof Error ? e.reason.message : String(e.reason || 'Unhandled rejection');
          window.parent.postMessage({ type: 'runtime-error', message: msg }, '*');
        } catch(_) {}
      });
    <\/script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.jsx"><\/script>
  </body>
</html>
`;
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add components/preview/preview-frame.tsx lib/container-runtime.ts
git commit -m "feat: capture Vite build errors and iframe runtime errors"
```

---

### Task 9: Wire auto-fix loop into `chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

This is the most complex task. The auto-fix loop runs after `onFilesGenerated` is called — it listens for errors from the preview, then dispatches repair requests.

- [ ] **Step 1: Add imports**

At the top of `chat-area.tsx`, add:

```typescript
import { createErrorCollector } from "@/lib/error-collector";
import type { ErrorCollector } from "@/lib/error-collector";
import { buildAutoFixContext } from "@/lib/agent-context";
```

- [ ] **Step 2: Add error collector ref and auto-fix state**

Inside the `ChatArea` component, add refs for the error collector and auto-fix state:

```typescript
const errorCollectorRef = useRef<ErrorCollector>(createErrorCollector());
const autoFixAttemptRef = useRef(0);
const isAutoFixingRef = useRef(false);
const autoFixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const latestFilesRef = useRef<Record<string, string>>({});
```

Add a constant for max auto-fix attempts:

```typescript
const MAX_AUTO_FIX_ATTEMPTS = 3;
```

- [ ] **Step 3: Create error callback handlers**

Add callback functions that feed errors to the collector:

```typescript
const handleViteError = useCallback((errorText: string) => {
  if (isAutoFixingRef.current || !errorCollectorRef.current) return;
  errorCollectorRef.current.collect({ source: "vite", message: errorText });
}, []);

const handleRuntimeError = useCallback((errorText: string) => {
  if (isAutoFixingRef.current || !errorCollectorRef.current) return;
  errorCollectorRef.current.collect({ source: "runtime", message: errorText });
}, []);
```

- [ ] **Step 4: Create the auto-fix execution function**

Add the core auto-fix function that sends errors to the Engineer for repair:

```typescript
const runAutoFix = useCallback(async (
  files: Record<string, string>,
  attempt: number,
  signal: AbortSignal
) => {
  const collector = errorCollectorRef.current;
  if (!collector.hasErrors() || attempt > MAX_AUTO_FIX_ATTEMPTS) return;

  isAutoFixingRef.current = true;
  autoFixAttemptRef.current = attempt;

  updateSession(project.id, {
    agentStates: [{
      role: "engineer",
      status: "thinking",
      output: `自动修复中 (${attempt}/${MAX_AUTO_FIX_ATTEMPTS})...`,
    }],
  });

  try {
    const context = buildAutoFixContext(collector.formatForContext(), files);

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        prompt: "auto-fix",
        agent: "engineer",
        context,
        modelId: selectedModelRef.current,
        partialMultiFile: true,
      }),
      signal,
    });

    let fixedFiles: Record<string, string> | null = null;

    await readSSEBody(response.body!, (event) => {
      if (event.type === "files_complete" && event.files) {
        fixedFiles = event.files;
      }
    });

    if (fixedFiles && Object.keys(fixedFiles).length > 0) {
      const mergedFiles = { ...files, ...fixedFiles };
      latestFilesRef.current = mergedFiles;

      // Reset collector for next round
      collector.reset();

      // Mount the fixed files — this triggers HMR which may produce new errors
      const { mountIncremental } = await import("@/lib/container-runtime");
      await mountIncremental(mergedFiles);

      // Wait 3 seconds for errors to accumulate, then check again
      await new Promise<void>((resolve) => {
        autoFixTimerRef.current = setTimeout(resolve, 3000);
      });

      if (collector.hasErrors() && attempt < MAX_AUTO_FIX_ATTEMPTS) {
        await runAutoFix(mergedFiles, attempt + 1, signal);
      } else {
        // Auto-fix complete (success or max attempts reached) — save version
        onFilesGenerated(mergedFiles, latestVersionRef.current);
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error("[auto-fix] attempt", attempt, "failed:", err);
    }
  } finally {
    isAutoFixingRef.current = false;
    updateSession(project.id, {
      agentStates: [{
        role: "engineer",
        status: "done",
        output: "",
      }],
    });
  }
}, [project.id, onFilesGenerated]);
```

Note: `selectedModelRef` and `latestVersionRef` should already exist in `chat-area.tsx` (or be derived from existing state). Adjust names to match the actual variable names in the file. `readSSEBody` is imported from `@/lib/api-client`.

- [ ] **Step 5: Trigger auto-fix after files are mounted**

Find the existing `onFilesGenerated` calls in `chat-area.tsx`. After files are generated and the version is saved, start the error collection window. The cleanest integration point is to wrap the existing `onFilesGenerated` call:

Instead of directly calling `onFilesGenerated(finalFiles, version)`, use:

```typescript
// After version is saved, start error collection for auto-fix
latestFilesRef.current = finalFiles;
latestVersionRef.current = version;
errorCollectorRef.current.reset();
autoFixAttemptRef.current = 0;

// Call onFilesGenerated immediately (preview shows current files)
onFilesGenerated(finalFiles, version);

// Start error collection timer — after 3 seconds, check if auto-fix is needed
if (autoFixTimerRef.current) clearTimeout(autoFixTimerRef.current);
autoFixTimerRef.current = setTimeout(() => {
  const collector = errorCollectorRef.current;
  if (collector.hasErrors() && !isAutoFixingRef.current) {
    runAutoFix(finalFiles, 1, abortRef.current.signal);
  }
}, 3000);
```

Apply this pattern to the primary `onFilesGenerated` call sites in the full pipeline path (after post-processing) and the direct path (after merging files). Do NOT apply to the version restore path.

- [ ] **Step 6: Pass callbacks to PreviewFrame**

Find where `<PreviewFrame>` is rendered in the workspace (likely in `workspace.tsx` or wherever preview is composed). Pass the error callbacks:

```typescript
<PreviewFrame
  files={files}
  projectId={project.id}
  scaffoldDependencies={scaffoldDependencies}
  onViteError={handleViteError}
  onRuntimeError={handleRuntimeError}
/>
```

Note: If `PreviewFrame` is rendered in a different component than `ChatArea`, the callbacks need to be lifted through the `Workspace` component via props. Check `components/workspace/workspace.tsx` for the composition.

- [ ] **Step 7: Clean up timer on unmount**

In the component's cleanup (or add a new useEffect):

```typescript
useEffect(() => {
  return () => {
    if (autoFixTimerRef.current) clearTimeout(autoFixTimerRef.current);
  };
}, []);
```

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors.

- [ ] **Step 9: Manual test**

1. Start dev server: `npm run dev`
2. Create a new project with prompt "做一个消消乐游戏"
3. Observe:
   - If generation produces errors → auto-fix triggers (visible in Agent Status Bar)
   - If generation is clean → no auto-fix, version saved normally
4. Check browser console for `[auto-fix]` logs

- [ ] **Step 10: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: wire auto-fix error feedback loop into generation pipeline"
```

---

### Task 10: End-to-end manual verification

**Files:** None (testing only)

- [ ] **Step 1: Test match3 game generation**

1. Start dev server: `npm run dev`
2. Create project: "做一个欢乐消消乐游戏"
3. Verify:
   - Scene classified as "game", subtype as "match3"
   - Architect receives match3 architecture hints (check Activity Panel)
   - Engineer receives match3 rules
   - Generated game has 8x8 grid, click-to-swap mechanics, match detection
   - If runtime errors occur, auto-fix loop engages

- [ ] **Step 2: Test snake game generation**

1. Create project: "做一个贪吃蛇游戏"
2. Verify subtype "snake", appropriate architecture hints

- [ ] **Step 3: Test non-game project unaffected**

1. Create project: "做一个待办事项管理"
2. Verify no gameSubtype applied, no auto-fix unless actual errors

- [ ] **Step 4: Test auto-fix noise filtering**

1. Check that ResizeObserver warnings don't trigger auto-fix
2. Check that Supabase network errors don't trigger auto-fix

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found in manual testing"
```
