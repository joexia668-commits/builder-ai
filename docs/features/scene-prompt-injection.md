# 场景化 Prompt 注入（Scene-Based Prompt Injection）

## 概述

在意图分类（Intent）之上，系统额外识别用户需求所属的**应用场景类型（Scene）**，并向 Architect 和 Engineer 注入针对性规则，从源头杜绝特定场景下的常见 LLM 反模式。

直接路径和简单路径使用全局关键词匹配（零额外 LLM 调用）。复杂路径（Decomposer → Module Orchestrator）由 Decomposer 按模块标注 `sceneType`，每个模块只注入自己相关的场景规则，避免全局注入导致的规则矛盾。

---

## 设计背景

不同类型的应用有截然不同的 LLM 生成陷阱：

| 场景 | 典型反模式 | 后果 |
|------|-----------|------|
| 游戏 | `useEffect(() => {...}, [snake])` 将游戏状态放入依赖数组 | 无限重渲染，游戏崩溃 |
| 数据可视化 | 引入 `recharts`（被禁止的包） | Sandpack 无法解析，白屏 |
| CRUD | 每个字段单独一个 `useState` | 状态爆炸，提交逻辑混乱 |
| 多视图 | 引入 `react-router-dom`（被禁止的包） | Sandpack 无法解析，白屏 |
| 动画交互 | 引入 `framer-motion`（被禁止的包） | 同上 |
| 数据持久化 | `insert` 替代 `upsert` → 重复写入错误 | 运行时 Supabase 报错 |

意图路由只知道"这是新项目还是 bug 修复"，不知道"这是一个游戏"。场景分类补齐了这一维度。

---

## 6 种 Scene 类型

| Scene | 触发关键词（举例） | 注入规则摘要 |
|-------|--------------------|-------------|
| `game` | 游戏、贪吃蛇、俄罗斯方块、snake、tetris | useRef 游戏状态、setInterval 依赖 `[]`、forceUpdate tick 计数器 |
| `dashboard` | 仪表盘、图表、dashboard、chart、统计 | 纯 SVG/CSS 绘图，禁 recharts |
| `crud` | 管理、增删改查、表单、todo、待办 | 单对象 form state、editingId 模式、乐观更新 |
| `multiview` | 多页面、标签页、tab、导航、设置页 | `useState` 路由，禁 react-router-dom |
| `animation` | 动画、拖拽、drag、过渡、animate | 纯 CSS/JS 动画，禁 framer-motion |
| `persistence` | 保存、同步、数据库、持久化、cloud | upsert 不用 insert、localStorage 键名规范 |

同一个项目可命中多个 scene（最多 3 个），规则叠加注入。

---

## 检测时机

```
用户 prompt
    │
    ├─ classifySceneFromPrompt(prompt)    ← 直接路径（bug_fix / style_change）
    │       立即从 prompt 关键词检测
    │
    └─ full pipeline
           PM 输出 PmOutput（features/modules/persistence）
           │
           classifySceneFromPm(pmOutput) ← 全局场景检测（prompt + PM features/modules）
           │
           ├─ 简单路径：detectedScenes → Architect + Engineer 均注入（全局）
           │
           └─ 复杂路径：
                Decomposer 接收 detectedScenes 作为 hint
                → 输出 ModuleDefinition[].sceneType（按模块标注）
                → 输出 ModuleDefinition[].engineeringHints（LLM 生成的编码要点）
                │
                ├─ Skeleton Architect：仍使用全局 detectedScenes
                ├─ Module Architect：使用 module.sceneType（fallback 全局）
                ├─ Module Engineer：使用 module.sceneType（fallback 全局）
                └─ Post-processing：使用所有模块 sceneType 的并集
```

直接路径从 prompt 检测；简单路径从 PM 结构化输出检测；复杂路径由 Decomposer 按模块标注 `sceneType`，每个模块独立获得场景规则。

---

## 注入位置

### Architect
在 `resolveArchContext()` 中，于 PM 输出前追加场景提示：

```
【场景提示】本项目为 game 类型，建议将游戏逻辑（状态机/碰撞检测）与 UI 渲染拆分为独立文件。
```

目的：引导 Architect 在文件拆分和职责分配上遵循场景最佳实践。

### Engineer（多文件）
在 `getMultiFileEngineerPrompt()` 的 `设计说明：` 之前注入完整规则块：

```
【游戏/动画类应用 - useEffect 无限循环防护】
1. 游戏状态用 useRef 存储...
2. setInterval 的 useEffect 依赖数组必须为 []...
...
```

### Engineer（单文件直接路径）
在 `buildDirectEngineerContext()` 输出后追加相同规则块。

---

### 复杂路径：按模块注入（Per-Module Scene Rules）

复杂路径下，全局注入会导致矛盾。例如"欢乐消消乐"可能同时命中 `game` + `animation` + `multiview`，导致所有模块收到互相矛盾的规则。

解决方案：Decomposer 为每个模块标注独立的 `sceneType` 和 `engineeringHints`：

```json
{
  "name": "game-board",
  "sceneType": "game",
  "engineeringHints": "游戏状态用 useRef 避免 re-render 循环，只有得分/游戏结束用 useState"
}
{
  "name": "score-panel",
  "sceneType": "general",
  "engineeringHints": "纯展示组件，接收 score/level props"
}
```

- **已知场景**（`sceneType` 非 `general`）：注入硬编码规则（强约束）+ `engineeringHints`（补充）
- **未知场景**（`sceneType` = `general`）：仅注入 `engineeringHints`（LLM 生成的编码指导），覆盖关键词列表未覆盖的场景
- **向后兼容**：若模块无 `sceneType` 字段（旧格式），fallback 到全局 `detectedScenes`

---

## 核心文件

| 文件 | 职责 |
|------|------|
| `lib/scene-classifier.ts` | `classifySceneFromPrompt` + `classifySceneFromPm` — 关键词匹配，返回 `Scene[]`（直接路径和简单路径） |
| `lib/scene-rules.ts` | `getEngineerSceneRules` + `getArchitectSceneHint` — 根据 scene 列表返回注入文本 |
| `lib/types.ts` | `Scene` 类型定义 + `ModuleDefinition.sceneType` + `ModuleDefinition.engineeringHints` |
| `lib/decomposer.ts` | 复杂路径：解析和校验 Decomposer 输出中的 `sceneType`（非法值 → `general`）和 `engineeringHints`（缺失 → `""`） |
| `lib/agent-context.ts` | `buildModuleArchitectContext` — 按模块 `sceneType` 注入场景提示 + `engineeringHints` |
| `lib/generate-prompts.ts` | `getMultiFileEngineerPrompt` — 接收 `sceneRules` + `engineeringHints` 并注入 prompt |
| `components/workspace/chat-area.tsx` | 调用分类器，将 per-module scene rules 传入各 Agent 上下文 |

---

## 相关文件

- `lib/intent-classifier.ts` — 意图分类（与 scene 分类互补，不互斥）
- `docs/features/intent-routing.md` — 意图路由详情
- `docs/architecture.md` — 整体架构中的场景分类位置
