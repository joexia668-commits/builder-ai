# Game Generation Quality — Error Feedback Loop + Game Architecture Templates

**Date:** 2026-04-16
**Status:** Draft
**Problem:** 同样使用 DeepSeek V3 的竞品（Bolt.new / v0 / Lovable）能一次生成可玩的消消乐游戏，本项目生成的游戏各种 bug（逻辑错误、白屏崩溃、不可交互），且迭代修复也经常失败。

## Root Cause Analysis

### 根因 1：没有错误反馈循环（最致命）

当前管线：Engineer 生成代码 → WebContainer 运行 → 报错 → 无人知道。

- `container-runtime.ts` 把 Vite 错误只打到 `console.error`，从未送回 Engineer
- `engineer-circuit.ts` 的重试只知道"上一次解析失败"，不知道为什么失败
- 用户手动说"修 bug"时，`buildDirectEngineerContext` 只传用户文字 + 源码，不传错误信息
- 竞品（Bolt.new / Lovable）均实现了 sandbox → 捕获错误 → 自动回传 LLM → 修复循环

### 根因 2：游戏逻辑缺乏架构模板

Architect prompt 里没有任何游戏架构模板。它需要自己"发明"消消乐的文件拆分，每次结果不同 → Engineer 每次收到不同的 scaffold → 代码质量不稳定。竞品（Bolt.new）倾向单文件生成游戏，Lovable 有预置组件模板。

### 根因 3：多文件协调脆弱

消消乐被拆成 4+ 文件后：自定义 hook 返回值格式不一致（ADR 0022）、文件间 import/export 不匹配导致白屏、游戏状态分散在多个文件的 useRef 里导致不同步。

## Solution: Two-Part Approach

### Part 1: Error Feedback Loop

#### Architecture

```
Engineer 生成代码
    ↓
WebContainer 挂载 + Vite 编译
    ↓
┌─ 编译成功 → iframe 加载 → 监听 runtime error ─┐
│                                                 │
└─ 编译失败 → 捕获 Vite stderr ─────────────────┘
    ↓
错误收集（去重 + 截断前 5 条，每条 ≤ 300 字符）
    ↓
自动构建修复 context → 发起 "auto_fix" Engineer 请求
    ↓
挂载修复后代码 → 再检测
    ↓
最多 3 轮，超过则展示最后一版 + 错误提示给用户
```

#### Error Capture: Two Sources

**Source 1 — Vite Build Errors (container-runtime.ts):**
当前 `devProcess.output.pipeTo()` 只 console.log。改为：检测到 Vite 错误模式（`SyntaxError`、`Cannot find module`、`TypeError`、`[vite] Internal server error`）时，通过回调函数上报错误文本。

**Source 2 — Browser Runtime Errors (preview-frame.tsx):**
iframe 内通过 `window.addEventListener('error')` 和 `window.addEventListener('unhandledrejection')` 捕获。通过 `postMessage` 发回宿主页面。

#### Error Aggregation Rules

- 同一错误（message 相同）只保留首次
- 最多收集 5 条不同错误
- 每条截断到 300 字符
- 等待窗口：Vite 编译后等 3 秒收集运行时错误

#### Auto-fix Request Format

新增 intent `"auto_fix"`，走 direct path（跳过 PM/Architect），Engineer context：

```
【自动修复模式 — WebContainer 检测到以下错误】

错误 1 (编译): SyntaxError: Unexpected token at /components/GameBoard.jsx:42:15
错误 2 (运行时): TypeError: Cannot read properties of undefined (reading 'map') at GameBoard.jsx:78

当前代码：
// === FILE: /components/GameBoard.jsx ===
[source code]
// === FILE: /App.jsx ===
[source code]

修复要求：
1. 只修改导致上述错误的文件
2. 不要重构、不要加新功能
3. 确保所有 import 路径正确
4. 确保所有变量在使用前已定义
```

#### UI Behavior

- Agent Status Bar 显示 "自动修复中 (1/3)"
- Activity Panel 实时展示捕获的错误和修复尝试
- 3 轮后仍有错误：展示预览 + 黄色 banner "检测到运行时问题，你可以描述具体症状让我修复"

#### Noise Filters (不触发 auto-fix)

- 用户正在手动迭代（刚发了修复消息）
- 错误来自 Supabase 网络请求（不是代码 bug）
- ResizeObserver loop（浏览器噪音）

### Part 2: Game Architecture Templates

#### Game Subtype Classification

扩展 `scene-classifier.ts`，新增 `classifyGameSubtype()`：

```typescript
export type GameSubtype = "match3" | "snake" | "tetris" | "platformer" | "card" | "board" | "generic";
```

Keyword mapping:

| Subtype | Keywords |
|---------|----------|
| `match3` | 消消乐, 三消, match-3, candy crush, bejeweled, 宝石 |
| `snake` | 贪吃蛇, snake |
| `tetris` | 俄罗斯方块, tetris, 方块下落 |
| `platformer` | 马里奥, platformer, 跳跃, 平台 |
| `card` | 纸牌, 扑克, solitaire, card game |
| `board` | 棋, chess, 围棋, 五子棋 |
| `generic` | fallback |

#### Architect Hint Template (match3 example)

注入到 Architect prompt 的 sceneRules：

```
【match3 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 核心游戏逻辑 + 渲染（maxLines: 400）
   - 8×8 网格状态（useRef）
   - swap 交换逻辑
   - match 检测（横向 + 纵向连续 ≥3）
   - cascade 下落 + 补充新方块
   - 动画（CSS transition 或 requestAnimationFrame）
   - 触摸/鼠标事件处理
   导出：GameBoard (default)

2. /components/GameUI.jsx — 得分、关卡、游戏状态 UI（maxLines: 100）
   导出：GameUI (default)

3. /App.jsx — 入口 + 状态胶水（maxLines: 80）
   导出：App (default)

关键约束：
- GameBoard 持有全部游戏状态（useRef），通过回调通知 App
- 不要拆分游戏核心逻辑到 utils 文件
- 匹配检测必须处理 cascade（消除→下落→再检测循环）
```

#### Engineer Subtype Rules (match3 example)

```
【match3 专属规则】
- 棋盘用二维数组：gridRef.current = Array(8).fill(null).map(() => Array(8).fill(null).map(() => randomColor()))
- 颜色种类 5-6 种
- swap 校验相邻性（上下左右，不含对角）
- swap 后无 match 必须 swap 回
- match 检测：遍历每行每列，找连续 ≥3 同色
- cascade 循环：清除→下落→填充→再检测→直到无 match
- 点击交互：第一次点击选中，第二次点击相邻则 swap，否则更换选中
```

每种 subtype 遵循同样原则：游戏核心逻辑集中在 1 个文件、给 maxLines 建议、明确 export 接口、明确不要拆分的逻辑。

## Integration Design

### Pipeline Flow Change

```
ChatArea
  ├─ classifyIntent → new_project / feature_add
  ├─ PM（不变）
  ├─ classifyGameSubtype(prompt, pm)           ← NEW
  ├─ Architect（注入 subtype 模板到 sceneRules） ← ENHANCED
  ├─ Engineer（注入 subtype 专属规则）            ← ENHANCED
  ├─ 后处理（不变）
  ├─ prepareFiles → WebContainer 挂载
  └─ Error Feedback Loop                        ← NEW
        ├─ 收集错误（Vite + iframe runtime）
        ├─ 3 秒等待窗口
        ├─ 有错误 → buildAutoFixContext → Engineer → mountIncremental → 再收集（≤3 轮）
        └─ 无错误 → 完成，保存版本
```

### Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `lib/scene-classifier.ts` | 新增 `classifyGameSubtype()` | +40 |
| `lib/scene-rules.ts` | Architect hint 模板 + Engineer subtype 规则 | +150 |
| `lib/types.ts` | `GameSubtype` 类型 + `auto_fix` intent | +5 |
| `lib/container-runtime.ts` | Vite 错误回调上报 | +20 |
| `components/preview/preview-frame.tsx` | iframe runtime error 捕获 + postMessage | +30 |
| `lib/error-collector.ts` | **NEW** — 错误聚合、去重、截断、噪音过滤 | ~80 |
| `lib/agent-context.ts` | 新增 `buildAutoFixContext()` | +30 |
| `components/workspace/chat-area.tsx` | auto-fix 循环编排 | +60 |
| `lib/generate-prompts.ts` | subtype 规则注入 | +15 |
| `app/api/generate/handler.ts` | 处理 `auto_fix` agent | +10 |

**Total: ~440 lines added, 1 new file (`error-collector.ts`), rest are edits.**

### Data Flow: gameSubtype

```
classifyGameSubtype(prompt, pm)
  → gameSubtype: "match3"
  → 局部变量（不持久化、不存 DB）
  → getSceneRules(scenes, gameSubtype) → 增强后的规则字符串
  → 注入 Architect context + Engineer context
```

不改 DB schema，不改 iterationContext，不改 SSE 协议。

### Data Flow: Error Capture

```
preview-frame.tsx
  │ iframe onError / onUnhandledRejection
  │   → postMessage({ type: 'runtime-error', message, source, line })
  │
  │ container-runtime.ts onViteError callback
  │   → chat-area 传入的 onBuildError(errorText)
  ↓
chat-area.tsx
  │ errorCollector.collect(error)
  │ 3 秒后 flush()
  │   → errors.length > 0 → buildAutoFixContext → Engineer → mountIncremental → 再收集
  │   → errors.length === 0 → 完成
```

### What Does NOT Change

- PM prompt / Architect prompt 结构不变（sceneRules 内容更丰富而已）
- SSE 协议不新增 event type（auto-fix 复用 `files_complete`）
- 版本保存逻辑不变（auto-fix 完成后才 POST /api/versions）
- Complex path（Decomposer → Module Orchestrator）不变
- DB schema 不变

## LLM Call Budget

| Scenario | Extra Calls | Total |
|----------|-------------|-------|
| 一次成功 | +0 | 5–8 |
| 1 轮 auto-fix | +1 | 6–9 |
| 2 轮 auto-fix | +2 | 7–10 |
| 最坏 3 轮 | +3 | 8–11 |

## Implementation Phases

**Phase 1 (先做):** Game Architecture Templates — `scene-classifier.ts` + `scene-rules.ts` + `generate-prompts.ts` + `types.ts`。改动小，立刻提升游戏生成一次通过率。

**Phase 2 (后做):** Error Feedback Loop — `container-runtime.ts` + `preview-frame.tsx` + `error-collector.ts` + `agent-context.ts` + `chat-area.tsx` + `handler.ts`。基础设施升级，对所有项目类型生效。
