# EPIC 1: 多 Agent 协作可视化对话系统

| Field | Value |
|-------|-------|
| Goal | 实现多 Agent 协作可视化的代码生成对话系统 |
| Business Value | 展示对 Atoms 核心卖点的理解 + 工程落地能力 |
| Total Estimate | ~2h |
| Phase | Phase 1 of 4 |

## 功能描述

用户输入需求后，PM / Architect / Engineer 三个 Agent 依次发言，形成可视化的团队协作对话流。每个 Agent 独立一次 SSE 请求（拆分请求策略，规避 Vercel 60s 超时）。

## Agent 定义

| Agent | 角色 | 颜色 | 头像 | 职责 |
|-------|------|------|------|------|
| PM | Product Manager | `#6366f1` (indigo) | 📋 | 分析需求，输出结构化 PRD |
| Architect | System Architect | `#f59e0b` (amber) | 🏗️ | 设计技术方案，选择组件结构 |
| Engineer | Full-Stack Engineer | `#10b981` (emerald) | 👨‍💻 | 生成完整可运行的 React 函数组件（供 Sandpack 渲染） |

## Agent System Prompts 要点

### PM Agent
- 输入：用户原始需求
- 输出：结构化 PRD（功能列表、用户故事、优先级）
- 风格：简洁、有条理，用 markdown 列表

### Architect Agent
- 输入：PM 的 PRD 输出
- 输出：技术方案（组件结构、数据流、UI 布局描述）
- 风格：技术导向，包含伪代码或结构图

### Engineer Agent
- 输入：用户原始需求 + PM 的 PRD + Architect 的技术方案（全量上下文）
- 输出：完整可运行的 React 函数组件（`export default function App()`）
- 约束：
  - **只输出代码本身，不得包含 ` ```jsx ` 或 ` ``` ` 等 Markdown 代码围栏**
  - 不输出任何解释性文字，代码即全部内容
  - 样式使用内联 `style` 或 `/styles.css`，不引入外部 CSS 框架
- 风格：代码为主，结构清晰，组件命名 App

## API 设计

```
POST /api/generate
  Body: {
    projectId: string,
    prompt: string,
    agent: 'pm' | 'architect' | 'engineer',
    context?: string   // 上一个 Agent 的输出
  }
  Response: SSE stream (text/event-stream)

  Event format:
  data: {"type":"thinking","content":"分析需求中..."}
  data: {"type":"chunk","content":"## 需求分析\n..."}
  data: {"type":"done","messageId":"msg_xxx"}
```

## 前端协作流程

```
1. 用户输入 prompt → 保存 user message → UI 显示用户消息气泡
2. 设置 activeAgent = 'pm'
   → POST /api/generate { agent: 'pm', prompt }
   → 显示 PM thinking animation
   → 流式渲染 PM 消息气泡（带 typing effect）
   → PM done → 保存 PM message → pmOutput = content
3. 设置 activeAgent = 'architect'
   → 等待 800ms + 显示过渡提示："PM 已将需求文档移交给架构师..."
   → POST /api/generate { agent: 'architect', context: pmOutput }
   → 显示 Architect thinking animation
   → 流式渲染 Architect 消息气泡
   → Architect done → 保存 Architect message → architectOutput = content
4. 设置 activeAgent = 'engineer'
   → 等待 800ms + 显示过渡提示："架构师已将技术方案移交给工程师..."
   → POST /api/generate {
       agent: 'engineer',
       context: `用户原始需求：\n${prompt}\n\nPM 需求文档：\n${pmOutput}\n\n架构师技术方案：\n${architectOutput}`
     }
   → 显示 Engineer thinking animation
   → 流式渲染 Engineer 消息气泡
   → code_complete 事件 → 触发预览刷新（EPIC 2）
   → Engineer done → 保存 Engineer message + 创建 version（EPIC 3）
5. 设置 activeAgent = null（全部完成）
```

## UI 交互细节

### 消息气泡
- 左侧：Agent 头像（圆形） + 角色标签（小字灰色）
- 主题色左边框（4px）
- 内容区：markdown 渲染（PM/Architect）或代码高亮（Engineer）
- 时间戳：右下角小字

### Thinking 状态
- 三个跳动的圆点动画（Agent 主题色）
- 文字提示："PM 正在分析需求..."

### Agent 移交过渡状态（新增）
- 在上一个 Agent 完成后、下一个 Agent 开始前，插入 800ms 过渡
- 状态栏出现短暂的"移交中..."提示文字，配合箭头高亮动画
- 过渡文案：
  - PM → Architect："PM 已将需求文档移交给架构师..."
  - Architect → Engineer："架构师已将技术方案移交给工程师..."
- 目的：强化"真实团队协作"的感知（UX Psychology），避免切换过快显得机械

### Agent 状态栏（Chat 区顶部横排）
- 三个 Agent 小卡片横排显示在消息列表上方
- 当前活跃 Agent：高亮边框 + 脉冲动画 + 状态文字（"正在分析..."）
- 已完成 Agent：绿色勾 ✓ + 主题色背景
- 未开始 Agent：灰色，降低透明度
- Agent 间有箭头连线（→），表示协作流方向
- 布局：`[PM 📋 ✓] → [Arch 🏗 ⟳] → [Eng 👨‍💻 ...]`

### 左侧对话列表
- 每个项目一行：项目名 + 最近消息预览（截断 30 字）+ 时间戳
- 当前选中项目高亮（主题色左边框）
- 底部固定"+ 新建项目"按钮（打开创建弹窗）
- 项目列表从数据库加载，刷新后保持

### 对话区
- 自动滚动到最新消息
- 用户消息靠右，Agent 消息靠左
- 支持多轮对话（迭代修改，EPIC 后续扩展）

## 数据持久化

每条消息保存到 Message 表：
```typescript
{
  projectId: string,
  role: 'user' | 'pm' | 'architect' | 'engineer',
  content: string,      // 完整的 Agent 输出
  metadata: {
    agentName: string,
    agentColor: string,
    thinkingDuration?: number  // ms
  }
}
```

刷新页面后从数据库恢复对话历史。

## 验收标准

- [ ] 用户输入后 PM 先流式发言分析需求
- [ ] PM 结束后 800ms 过渡动画 + 移交文字，再由 Architect 接力
- [ ] Architect 结束后 800ms 过渡动画 + 移交文字，再由 Engineer 接力
- [ ] Engineer 接收到全量上下文（用户需求 + PM PRD + Architect 方案）
- [ ] Engineer 输出纯 React 代码，无 Markdown 围栏标签
- [ ] Engineer 最终输出可被 Sandpack 渲染的 React 组件
- [ ] 每个 Agent 视觉上可区分（颜色、头像、标签）
- [ ] Thinking 动画正常展示
- [ ] 顶部 Agent 状态横排卡片实时更新（活跃/完成/待开始）
- [ ] 左侧对话列表展示项目历史，点击可切换项目
- [ ] 对话历史持久化到数据库
- [ ] 刷新页面后对话记录恢复
- [ ] 单个 Agent 请求 < 30s（不触发 Vercel 超时）

## 依赖

- EPIC 0（项目骨架 + 认证）完成
