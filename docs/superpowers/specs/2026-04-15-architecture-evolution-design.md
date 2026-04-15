# Architecture Evolution: Modular Pipeline + WebContainer + Game Generation

> 将 BuilderAI 从小型 React 组件生成器升级为支持复杂项目（多页面应用、可玩游戏、中型 SaaS 原型）的一次性生成平台。

## Problem

当前架构有 6 个硬天花板，共同限制了项目复杂度：

| 约束 | 当前限制 | 影响 |
|------|---------|------|
| 项目规模 | ~3000 LOC / 20 文件 | 超出后 Architect 输出截断，Engineer token 不足 |
| 单次生成 | 90s Vercel Edge 超时 | 大型项目 scaffold 被截断 |
| 状态管理 | 仅 useState + props + localStorage | 跨页面状态共享不可能 |
| 路由 | 禁用 react-router，useState 模拟 | 真实多页面应用无法实现 |
| 沙箱 | Sandpack（Babel 打包，无 Node.js） | 禁用游戏引擎、大型库，兼容性问题多 |
| 生成模式 | 一次生成所有文件 | 文件数超过 8 个后质量急剧下降 |

## Constraints

- **用户体验**：单次输入 → 完整项目输出，用户零中间交互
- **渐进式交付**：30s 内出可交互骨架，后续模块逐步填充
- **简单项目不退化**：≤8 文件的项目走原有流程，零影响
- **阶段**：扩展期投资，一步到位而非打补丁

## Design

### 1. Pipeline Controller（程序化编排状态机）

用代码（非 LLM）做调度决策。LLM 只负责生成内容，不负责决定流程。

#### 状态机

```
IDLE
  │
  ▼
CLASSIFYING ──── PM 分析需求 + 判断 complexity
  │
  ├─ simple ─────────────────────────┐
  │                                   ▼
  │                            ARCHITECTING ─── Architect 规划文件
  │                                   │
  │                                   ▼
  │                            ENGINEERING ──── Engineer 按 layer 生成
  │                                   │
  │                                   ▼
  │                            POST_PROCESSING ─ import/export 检查修复
  │                                   │
  │                                   ▼
  │                               COMPLETE
  │
  └─ complex ────────────────────────┐
                                      ▼
                              DECOMPOSING ───── Decomposer 拆模块 + 定接口
                                      │
                                      ▼
                              SKELETON ────────  Architect + Engineer 生成骨架
                                      │          （用户此时可预览空壳）
                                      ▼
                              MODULE_FILLING ── 循环: 逐模块 Architect + Engineer
                                      │          （预览实时更新）
                                      ▼
                              POST_PROCESSING ─ 全局 import/export 检查修复
                                      │
                                      ▼
                                  COMPLETE
```

#### 状态转换表

| 转换 | 条件 |
|------|------|
| IDLE → CLASSIFYING | 用户发送 prompt |
| CLASSIFYING → ARCHITECTING | PM 返回 `complexity: "simple"` |
| CLASSIFYING → DECOMPOSING | PM 返回 `complexity: "complex"` |
| DECOMPOSING → SKELETON | Decomposer 返回模块列表 |
| SKELETON → MODULE_FILLING | 骨架生成完成 |
| MODULE_FILLING → MODULE_FILLING | 当前模块完成，还有下一个模块 |
| MODULE_FILLING → POST_PROCESSING | 所有模块完成 |
| ARCHITECTING → ENGINEERING | Architect 返回文件规划 |
| ENGINEERING → POST_PROCESSING | 所有 layer 生成完成 |
| POST_PROCESSING → COMPLETE | 检查修复完成 |
| 任意状态 → ERROR | Agent 调用失败 + 重试耗尽 |

#### Complexity 判断规则（PM 内）

```
simple: PM 输出的 modules ≤ 3 且 features ≤ 5
complex: modules > 3 或 features > 5 或场景为 game
```

### 2. Agent 体系

共 4 个 Agent，1 个新增，2 个调整，1 个不变。

| Agent | 新/旧 | 调用场景 | 输入 | 输出 |
|-------|-------|---------|------|------|
| **PM** | 旧，增强 | 所有项目 | 用户 prompt + 历史上下文 | PRD + `complexity: "simple" \| "complex"` |
| **Decomposer** | **新增** | complex 项目 | PRD | 模块列表 + 模块间接口 + 生成顺序 |
| **Architect** | 旧，职责收窄 | 所有项目 | PRD（simple）或 单模块描述（complex） | 文件列表 + 依赖图 |
| **Engineer** | 旧，不变 | 所有项目 | 文件规划 + 已完成代码 | 源代码 |

#### Decomposer 详细设计

**输入：**

```json
{
  "prd": "PM 输出的完整 PRD",
  "existingFiles": ["当前已有文件路径（feature_add 场景）"],
  "sceneTypes": ["game", "dashboard"]
}
```

**输出：**

```json
{
  "skeleton": {
    "description": "应用骨架：路由、布局、共享类型",
    "files": ["/App.js", "/types.ts", "/Layout.js", "/router.js"],
    "sharedTypes": "type Product = { id: string; name: string; price: number }; ..."
  },
  "modules": [
    {
      "name": "product-management",
      "description": "商品列表 + 新增/编辑表单 + 删除确认",
      "estimatedFiles": 4,
      "deps": [],
      "interface": {
        "exports": ["ProductList", "ProductForm"],
        "consumes": ["Product type from skeleton"],
        "stateContract": "products: Product[], selectedProduct: Product | null"
      }
    }
  ],
  "generateOrder": [["product-management", "order-list"], ["dashboard"]]
}
```

**约束：**

| 决策 | 选择 | 原因 |
|------|------|------|
| 模块数量上限 | 5 个 | 超过 5 个模块接口复杂度爆炸 |
| 每模块文件上限 | 8 个 | Engineer 当前舒适区 |
| 模块间通信 | props + shared types | 不引入事件总线等复杂机制 |
| generateOrder | 二维数组 | 同一层可并行，层间串行 |
| skeleton 包含真实代码 | 是 | 路由、Layout、类型定义是真实代码 |

### 3. WebContainer 集成

用 WebContainer 替换 Sandpack 作为预览沙箱。

#### 替换范围

| 当前组件 | 替换为 |
|---------|--------|
| `@codesandbox/sandpack-react` | `@webcontainer/api` |
| `buildSandpackConfig()` | `writeFilesToContainer()` |
| `normalizeExports()` | 删除（WebContainer 不需要 Babel hack） |
| Sandpack 依赖白名单 | 真实 `npm install` |

#### 生命周期

```
页面加载
  │
  ├─ 预加载 WebContainer（boot 一次，全局复用）
  │     const wc = await WebContainer.boot()
  │     耗时 ~3-5s，首次访问时触发，后续复用
  │
  ├─ 项目生成完成 / 模块更新时
  │     await wc.mount(fileTree)
  │     await wc.spawn('npm', ['install'])
  │     await wc.spawn('npm', ['start'])
  │     wc.on('server-ready', (port, url) => {
  │       iframe.src = url
  │     })
  │
  └─ 模块增量更新时（渐进式交付）
        await wc.mount(newModuleFiles)    // 只写入新模块文件
        // Vite dev server 自动 hot reload
```

#### 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| boot 时机 | 页面加载时预加载 | 避免生成完成后还要等 boot |
| npm install 策略 | 骨架阶段装一次，模块阶段增量装 | 骨架确定核心依赖，模块只补新包 |
| dev server | Vite | 比 webpack 快，HMR 体验好 |
| 文件更新方式 | 增量 mount | 只写变更文件，触发 HMR |
| Sandpack fallback | 不保留 | 扩展期一步到位 |
| `checkDisallowedImports()` | 保留但放宽 | 仍禁服务端库，允许前端库 |

#### 渐进式预览流程

```
骨架生成完成 → mount + npm install + npm start → 用户看到空壳（~30s）
模块 1 完成   → 增量 mount → Vite HMR → 页面出现商品管理（~45s）
模块 2 完成   → 增量 mount → Vite HMR → 页面出现订单列表（~60s）
...直到所有模块完成
```

#### 风险与缓解

| 风险 | 缓解 |
|------|------|
| WebContainer boot 慢（~5s） | 页面加载时预 boot |
| npm install 慢（~10-15s） | 骨架 install 和模块生成并行 |
| 浏览器内存占用高 | 单实例复用，切换项目时 teardown |

### 4. SSE 协议扩展

#### 新增事件

| 事件 | 用途 |
|------|------|
| `pipeline_state` | 状态机转换通知 |
| `skeleton_ready` | 骨架可预览，附带文件和依赖 |
| `module_start` | 开始生成某模块 |
| `module_complete` | 某模块完成，附带文件 |
| `module_failed` | 某模块失败 |

#### 事件格式

```
data: {"type":"pipeline_state","state":"DECOMPOSING","message":"正在拆解模块..."}
data: {"type":"skeleton_ready","files":{"/App.js":"..."},"dependencies":{"react":"^18","zustand":"^4"}}
data: {"type":"module_start","module":"product-management","index":0,"total":3}
data: {"type":"module_complete","module":"product-management","files":{"/components/ProductList.js":"..."},"index":0,"total":3}
data: {"type":"module_failed","module":"dashboard","error":"parse_failed","index":2,"total":3}
data: {"type":"done","summary":{"total":3,"succeeded":2,"failed":1}}
```

#### 前端消费

```
pipeline_state   → 更新状态栏
skeleton_ready   → writeFilesToContainer → npm install + start → 骨架预览
module_start     → 进度条更新（"生成商品管理 1/3..."）
module_complete  → 增量 mount → Vite HMR → 进度推进
module_failed    → 显示该模块失败提示，继续下一个
done             → 最终状态汇总
```

#### 错误处理

| 场景 | 处理 |
|------|------|
| Decomposer 失败 | 降级为 simple 路径 |
| 骨架生成失败 | 整体失败，提示重试 |
| 单个模块失败 | 跳过，继续其他模块，最终提示用户 |
| 所有模块失败 | 保留骨架，提示手动迭代 |

### 5. 游戏生成专项

#### 游戏类型 → 引擎选择

| 游戏类型 | 引擎 | 原因 |
|---------|------|------|
| 平台跳跃（马里奥） | Phaser.js | 内置物理、精灵、相机、瓦片地图 |
| 简单 2D（贪吃蛇、俄罗斯方块） | Canvas 原生 | 不需要物理引擎 |
| 弹幕/射击 | Phaser.js | 碰撞检测、粒子系统 |
| 棋牌/卡牌 | React DOM | 回合制，DOM 交互更合适 |

PM 输出中新增 `gameType` 字段，PipelineController 据此决定引擎。

#### 游戏模块拆解示例（超级马里奥）

```json
{
  "skeleton": { "files": ["/App.js", "/types.ts", "/constants.ts"] },
  "modules": [
    { "name": "game-engine", "deps": [], "estimatedFiles": 3 },
    { "name": "physics", "deps": ["game-engine"], "estimatedFiles": 2 },
    { "name": "entities", "deps": ["game-engine", "physics"], "estimatedFiles": 4 },
    { "name": "level", "deps": ["game-engine", "entities"], "estimatedFiles": 3 }
  ],
  "generateOrder": [["game-engine"], ["physics"], ["entities"], ["level"]]
}
```

#### scene-rules 新增

**game-engine 场景（Phaser.js）：**

- Architect：使用 Phaser 3；场景用 Phaser.Scene；物理用 Arcade Physics；素材用几何图形或 emoji
- Engineer：入口创建 Phaser.Game 实例；游戏逻辑在 Scene 的 preload/create/update 中；不在 React 组件内写游戏逻辑；用几何图形作精灵

**game-canvas 场景（纯 Canvas）：**

- Architect：Canvas 2D API；requestAnimationFrame 游戏循环；状态用普通对象
- Engineer：Canvas 通过 useRef 获取；游戏循环在 useEffect 中；碰撞用 AABB；输入用 addEventListener

#### `checkDisallowedImports()` 调整

- game 场景：允许 phaser
- dashboard 场景：允许 recharts
- 始终禁用：express, prisma, fs, path 等服务端库

## Files Changed

### 需要改动的文件

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| **编排层** | | |
| `components/workspace/chat-area.tsx` | 重构 | 抽出 PipelineController，替换硬编码流程 |
| `lib/engineer-circuit.ts` | 微调 | 作用域从整个项目缩小到单个模块 |
| **新增文件** | | |
| `lib/pipeline-controller.ts` | 新增 | 状态机核心 |
| `lib/decomposer.ts` | 新增 | Decomposer Agent context builder + 输出解析 |
| `lib/container-runtime.ts` | 新增 | WebContainer boot、mount、npm install、dev server |
| **Prompt 层** | | |
| `lib/generate-prompts.ts` | 扩展 | Decomposer system prompt + 游戏专用 prompt |
| `lib/scene-classifier.ts` | 扩展 | 新增 game-engine / game-canvas 分类 |
| `lib/scene-rules.ts` | 扩展 | 新增游戏场景规则 |
| `lib/intent-classifier.ts` | 微调 | PM 输出增加 complexity 字段 |
| **预览层** | | |
| `components/preview/preview-frame.tsx` | 重写 | Sandpack → WebContainer iframe |
| `lib/sandpack-config.ts` | 删除 | 被 container-runtime.ts 替代 |
| **SSE 层** | | |
| `app/api/generate/handler.ts` | 扩展 | 支持新事件类型 |
| `lib/types.ts` | 扩展 | 新增类型定义 |
| **后处理** | | |
| `lib/extract-code.ts` | 微调 | checkDisallowedImports 按场景放宽 |
| `lib/agent-context.ts` | 扩展 | Decomposer context builder、模块级 Architect context |
| **UI 层** | | |
| `components/agent/agent-status-bar.tsx` | 扩展 | 模块级进度展示 |
| `components/preview/activity-panel.tsx` | 扩展 | 模块粒度活动日志 |

### 不需要改动的文件

`lib/ai-providers.ts`、`lib/model-registry.ts`、`lib/validate-scaffold.ts`、`lib/version-files.ts`、`lib/project-assembler.ts`、`prisma/schema.prisma`、所有 API routes（除 generate）。

### 改动量估算

| 类别 | 新增 | 修改 | 删除 |
|------|-----|------|------|
| 新增文件（3 个） | ~800 | — | — |
| 编排重构 | ~200 | ~300 | ~200 |
| Prompt + Scene | ~150 | ~100 | — |
| 预览层 | ~250 | — | ~300 |
| SSE + 类型 | ~100 | ~50 | — |
| UI | ~100 | ~50 | — |
| **合计** | **~1600** | **~500** | **~500** |

## Implementation Phases

```
Phase 1 (2周): 编排重构
  ├─ pipeline-controller.ts（状态机）
  ├─ decomposer.ts（新 Agent）
  ├─ chat-area.tsx 重构（接入状态机）
  ├─ generate-prompts.ts + scene 扩展
  └─ SSE 新事件 + handler 扩展

Phase 2 (2周): WebContainer 集成
  ├─ container-runtime.ts
  ├─ preview-frame.tsx 重写
  ├─ 删除 sandpack-config.ts
  └─ 渐进式预览更新

Phase 3 (1周): 游戏生成 + 测试
  ├─ 游戏场景 prompt 优化
  ├─ checkDisallowedImports 放宽
  └─ E2E 测试：游戏 + 复杂项目 + 简单项目回归

Phase 4 (1周): 打磨
  ├─ 进度 UI 优化
  ├─ 错误处理边界测试
  └─ 性能优化（WebContainer 预加载、npm cache）
```

## Branch Strategy

架构完全重构，不分阶段合回 main。所有 Phase 在同一分支完成，全部验证通过后再考虑替换 main。

```
main (当前版本，外部用户持续访问，只做 bugfix)
  │
  └─ feat/modular-pipeline    ← Phase 1-4 全部在此分支开发
        独立 Vercel Preview + Supabase dev 环境
        全部 Phase 完成 + E2E 测试通过后，替换 main
```

**替换 main 的条件（全部满足后，由人工手动合并）：**
1. 所有 4 个 Phase 开发完成
2. 简单项目回归测试通过（不退化）
3. 复杂项目（多页面应用）E2E 测试通过
4. 游戏生成（至少贪吃蛇 + 平台跳跃）E2E 测试通过
5. Preview 环境人工验收通过

**严格要求：禁止自动合入 main。** 必须由人工确认后手动执行合并操作。CI/CD 不得配置自动 merge。

## Backward Compatibility

- **simple 项目**：complexity 判断为 simple 时，走原有 PM → Architect → Engineer 流程，零改动
- **direct path**（bug_fix / style_change）：不经过 PipelineController，完全不变
- **feature_add 迭代**：用户在已有复杂项目上追加功能时，PM 重新判断 complexity。如果追加的功能范围小（如"加一个搜索框"），走 simple/direct path 修改已有模块文件。如果追加的功能范围大（如"加一个新的用户管理模块"），走 complex path，Decomposer 只拆出新增模块（skeleton 复用已有文件），Engineer 在已有代码基础上增量生成。
- **API 接口**：无变化（新增 SSE 事件是向后兼容的）
- **数据库**：无 schema 变化
- **版本存储**：Version 模型不变，模块化生成的最终结果仍然作为一个整体保存

## Risks

| 风险 | 缓解 |
|------|------|
| Decomposer 输出模块边界不合理 | 降级为 simple 路径 |
| 模块间集成后 import/export 不一致 | POST_PROCESSING 阶段全局检查修复 |
| WebContainer boot + npm install 总时间过长 | 预加载 + 骨架 install 与模块生成并行 |
| 游戏 Phaser.js 代码 LLM 生成质量不稳定 | 游戏专用 scene-rules 约束 + 模块化降低单次生成复杂度 |
| 复杂项目总生成时间 3-5 分钟 | 渐进式交付，30s 即可预览骨架 |
| WebContainer 浏览器内存占用 | 单实例复用，teardown 策略 |

## Out of Scope

- 全栈后端生成（Express / API routes）— 低优先级，未来扩展
- Vue / Svelte 等非 React 模板
- AI 模型替换或微调
- 用户间协作编辑
- 模板库系统（未来优化手段）
