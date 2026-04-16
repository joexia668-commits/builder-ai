# BuilderAI 架构概览

BuilderAI 是一个 AI 驱动的多文件 Web 应用生成平台。用户输入自然语言需求，系统通过模块化流水线协作生成完整的 React 应用：简单项目走 PM → Architect → Engineer 三段路径；复杂项目（>3 模块或 >5 功能）由 PipelineController 状态机编排，经 Decomposer 拆解后由 Skeleton + 多轮 Module Engineer 并行填充。生成的应用在浏览器 WebContainer（真实 Node.js WASM，Vite HMR）中实时预览。

---

## 高层架构图

```
┌──────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router)                            │
│  ┌─────────────┬──────────────┬────────────────────────┐ │
│  │ Sidebar     │ Chat Area    │ Preview Panel          │ │
│  │ (项目列表)   │ (编排核心)    │ (WebContainer + Code) │ │
│  │             │ PipelineCtrl │ Vite HMR, incremental  │ │
│  └─────────────┴──────┬───────┴────────────────────────┘ │
│                       │ fetchSSE / fetchAPI               │
└───────────────────────┼──────────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────────┐
│  Next.js API Routes   │                                  │
│  ┌────────────────────▼─────────────────────────────┐    │
│  │ /api/generate (Edge Runtime, SSE, maxDuration=300s)│   │
│  │   → AI Provider (Gemini / DeepSeek / Groq)       │    │
│  │   → Stream Tap (实时文件边界解析)                   │    │
│  │   → Code Extraction + Validation                 │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ /api/projects  /api/messages  /api/versions      │    │
│  │ /api/deploy    /api/export    /api/auth           │    │
│  │   → Prisma ORM → Supabase PostgreSQL             │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## 意图路由

每次用户输入先经过 `classifyIntent(prompt, hasExistingCode)` 分类，路由到不同编排路径：

| 意图 | 触发条件 | Agent 路径 | 典型耗时 |
|------|---------|-----------|---------|
| `bug_fix` | "修复/bug/报错" 等关键词 | Engineer only | ~20s |
| `style_change` | "颜色/样式/dark mode" 等关键词 | Engineer only | ~20s |
| `new_project` | 无现有代码，或"重新做"关键词 | PM → Architect → Engineer × N（简单）<br>PM → Decomposer → Skeleton → Module Engineer × N（复杂） | ~60s / ~120s+ |
| `feature_add` | 默认（有现有代码） | PM → Architect → Engineer × N（含 V1 上下文）（简单）<br>PM → Decomposer → Skeleton → Module Engineer × N（复杂） | ~60s / ~120s+ |
| *complexity check* | >3 模块 OR >5 功能（PM 输出解析） | 复杂路径（Decomposer → Skeleton → Module Engineer × N） | ~120s+ |

详见 [意图分类与路由](features/intent-routing.md)。

---

## 场景分类（Scene Classification）

在意图之上，系统额外识别应用所属的**场景类型**，向 Architect 和 Engineer 注入场景专属规则，防止常见 LLM 反模式：

| Scene | 典型关键词 | 防止的问题 / 特殊能力 |
|-------|-----------|-----------|
| `game-engine` | phaser、物理引擎、平台游戏 | 启用 Phaser.js（WebContainer 支持）；注入游戏循环结构规则 |
| `game-canvas` | canvas、像素、碰撞检测 | 注入 Canvas 2D 物理模拟规则，防止 requestAnimationFrame 泄漏 |
| `game` | 游戏、贪吃蛇、snake | `useEffect` 依赖游戏状态 → 无限重渲染 |
| `dashboard` | 图表、仪表盘、chart | 引入 recharts（禁止包）→ 白屏 |
| `crud` | 管理、表单、todo | 每字段独立 `useState` → 状态爆炸 |
| `multiview` | 多页面、导航、tab | 引入 react-router-dom（禁止包）→ 白屏 |
| `animation` | 动画、拖拽、过渡 | 引入 framer-motion（禁止包）→ 白屏 |
| `persistence` | 保存、同步、持久化 | `insert` 替代 `upsert` → 重复写入错误 |

- **直接路径**（bug_fix / style_change）：从用户 prompt 关键词检测（`classifySceneFromPrompt`），全局注入
- **简单路径**：从 PM 结构化输出检测（`classifySceneFromPm`），全局注入
- **复杂路径**：Decomposer 按模块标注 `sceneType` + `engineeringHints`，每个模块只注入自己的场景规则。已知场景用硬编码规则兜底，未知场景用 LLM 生成的 `engineeringHints` 覆盖

详见 [场景化 Prompt 注入](features/scene-prompt-injection.md)。

---

## 核心模块

| 模块 | 入口文件 | 职责 |
|------|---------|------|
| 意图分类 | `lib/intent-classifier.ts` | 关键词路由，决定 Agent 编排路径 |
| 场景分类 | `lib/scene-classifier.ts` + `lib/scene-rules.ts` | 场景识别 + 场景规则注入（游戏/仪表盘/CRUD 等）。复杂路径下按模块 `sceneType` 注入，非全局 |
| 流水线控制器 | `lib/pipeline-controller.ts` | 可编程状态机，编排 IDLE → CLASSIFYING → DECOMPOSING → SKELETON → MODULE_FILLING → POST_PROCESSING → COMPLETE |
| Decomposer | `lib/decomposer.ts` | 复杂项目拆分为 ≤5 个模块，含接口契约、生成顺序、按模块 `sceneType` 和 `engineeringHints`（`parseDecomposerOutput`, `validateDecomposerOutput`, `buildDecomposerContext`） |
| Container Runtime | `lib/container-runtime.ts` | WebContainer 单例管理，支持全量挂载和增量 HMR 更新（`getContainer`, `mountAndStart`, `mountIncremental`, `teardownContainer`） |
| Agent 上下文 | `lib/agent-context.ts` | 为每个 Agent 构建差异化 prompt 上下文 |
| AI Provider | `lib/ai-providers.ts` + `lib/model-registry.ts` | 多模型抽象层 + 模型注册表 |
| Prompt 模板 | `lib/generate-prompts.ts` | 三 Agent 系统提示词 + Snip 压缩 + 重试指令 |
| 代码提取 | `lib/extract-code.ts` | 多层代码提取 + import/export 分析 |
| Scaffold 校验 | `lib/validate-scaffold.ts` | 依赖图修复：自引用 → 幽灵依赖 → 断环 → maxLines 钳位 → 黑名单依赖移除 |
| 拓扑排序 | `lib/topo-sort.ts` | 文件依赖 → 分层执行计划 |
| 分层容错 | `lib/engineer-circuit.ts` | 全层重试 → 逐文件重试 → 熔断 |
| 流式解析 | `lib/engineer-stream-tap.ts` + `lib/coalesce-chunks.ts` | SSE 旁路文件检测 + 事件合并 |
| 生成状态 | `lib/generation-session.ts` | 内存 pub-sub 存储，驱动实时 UI |
| ~~Sandpack 配置~~ | ~~`lib/sandpack-config.ts`~~ | 已删除，功能迁移至 `lib/container-runtime.ts` 和 `components/preview/preview-frame.tsx` |
| 导出/部署 | `lib/project-assembler.ts` + `lib/vercel-deploy.ts` + `lib/zip-exporter.ts` | 项目合并 + Vercel 部署 + ZIP 下载 |
| 认证 | `lib/auth.ts` + `lib/demo-bootstrap.ts` | 4 种登录方式 + Demo/Guest 冷启动 |

---

## 请求流转

完整的 Agent 编排流程（含直接路径和完整管道）详见 [Multi-Agent Pipeline](features/multi-agent-pipeline.md)。

Engineer 分层并行生成与三级容错详见 [Engineer Circuit](features/engineer-circuit.md)。

---

## 数据模型

详见 [Database Schema](database-schema.md)。

---

## 关键工程决策

| 决策 | 原因 |
|------|------|
| WebContainer 预览 | 通过 next.config.mjs 在 `/project/:path*` 路径注入 COOP/COEP headers，使 `SharedArrayBuffer` 可用；Vercel Hobby 支持自定义 headers |
| `window.location.href` 项目导航 | `router.push` 为客户端导航，不重新触发 COOP/COEP 响应头，`crossOriginIsolated` 在页面内保持 false，SharedArrayBuffer 不可用；改用 hard navigation（`window.location.href = /project/:id`）确保服务器端 headers 生效 |
| 模块化生成流水线 | Decomposer 将 >3 模块项目拆解，Skeleton 先建立类型和接口契约，各模块 Engineer 并行填充，渐进交付并降低单次 LLM token 上限压力 |
| 一次性渲染而非流式更新预览 | 频繁 remount 产生闪烁；WebContainer 增量 HMR（`mountIncremental`）避免重启，只推送变更文件 |
| `normalizeExports` 拆分 `export default function` | Sandpack Babel 不支持 `export { default as X }` 语法（ADR 0015）；迁移至 WebContainer/Vite 后仍保留以兼容旧版本快照 |
| 版本只 INSERT 不 UPDATE | 零数据丢失的完整时间线，回滚 = 读旧版本 → INSERT 新版本 |
| 多 Provider 工厂模式 | 统一 `AIProvider` 接口，Gemini 限速时自动 fallback 到 Groq |
| 拓扑排序分层并行 | 绕过单次请求 token 上限，最大化文件级并发 |
| Snip 上下文压缩 | 非直接依赖文件只注入 export 签名，大幅降低后期层 prompt 长度 |
| Architect 两阶段输出 | `<thinking>` 自由推理 + `<output>` 纯 JSON，避免 jsonMode 阻断思考链 |
| Scaffold 尾部截断抢救 | `extractScaffoldFromTwoPhase` 从不完整 JSON 逐元素救回已写完的 files 条目 |
| Prisma `$extends` 透明重试 | Supavisor 瞬态 drop socket 和冷启动 stale TCP 自动退避重试（100→200→400ms） |
| 缺失模块三层防御 | 提示词限制 + 生成后检测 + Sandpack Proxy stub，防止幻觉导入白屏 |
| 两阶段 Bug Fix Triage | 先用轻量 LLM 调用识别受影响文件，再只传这些文件给 Engineer，避免超时 |
| Guest 创建真实 User 记录 | 固定 email 格式防重复创建，刷新后项目数据可持久化 |
| Stream 超时精确识别 | Provider 层用 `abortController.signal.aborted` 区分内部超时与用户取消 |
| 迭代上下文 FIFO-5 持久化 | 最近 5 轮摘要存 `Project.iterationContext`，PM 写增量 PRD，Architect 从文件实时推导架构 |

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [意图分类与路由](features/intent-routing.md) | classifyIntent() 关键词匹配逻辑与优先级 |
| [场景化 Prompt 注入](features/scene-prompt-injection.md) | 8 种场景类型（含 game-engine/game-canvas）、检测时机、注入位置 |
| [Multi-Agent Pipeline](features/multi-agent-pipeline.md) | PM → Architect → Engineer 完整流程（含模块化复杂路径） |
| [Engineer Circuit](features/engineer-circuit.md) | 分层并行生成与三级容错 |
| [Scaffold 校验](features/scaffold-validation.md) | 依赖图修复与截断抢救 |
| [迭代上下文记忆](features/context-memory.md) | FIFO-5 历史 + 实时架构推导 |
| [代码后处理](features/code-post-processing.md) | import/export 一致性校验与修复 |
| [实时流式预览](features/live-streaming.md) | Stream tap + 文件进度展示 |
| [WebContainer 预览](features/sandpack-preview.md) | WebContainer 运行时、Vite HMR、COOP/COEP headers 配置 |
| [认证体系](features/auth-login.md) | 4 种登录方式 |
| [版本时间线](features/version-timeline.md) | 不可变快照与回滚 |
| [导出与部署](features/export-deploy.md) | ZIP 下载 + Vercel 部署 |
| [多模型支持](features/multi-model.md) | Provider 抽象与模型注册表 |
| [Database Schema](database-schema.md) | 数据表结构 |
| [API 参考](api-reference.md) | 所有 API 路由 |
| [环境配置](setup-guide.md) | 环境变量 + Demo 模式 |
