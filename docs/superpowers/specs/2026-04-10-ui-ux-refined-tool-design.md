# UI/UX Redesign — Refined Tool

**Date:** 2026-04-10  
**Direction:** Clean Pro · Refined Tool (A)  
**Scope:** Global — Home 页 + Workspace（侧边栏、Chat、预览面板）  
**Depth:** 全面重设计（视觉 + 局部布局均可改）  
**Branch:** 需从 `main` 新建分支再实施

---

## 1. 全局设计语言

所有组件继承以下规则，不引入新依赖，仅调整 Tailwind class。

### 色彩 tokens

| Token | 值 | 用途 |
|---|---|---|
| `primary` | `#4f46e5` (indigo-600) | 按钮、激活态、链接 |
| `primary-hover` | `#4338ca` (indigo-700) | 按钮 hover |
| `primary-surface` | `#eef2ff` (indigo-50) | AI 消息背景、激活项背景 |
| `primary-border` | `#e0e7ff` (indigo-100) | AI 消息边框 |
| `primary-focus` | `#a5b4fc` (indigo-300) | input focus 边框、卡片 hover 边框 |
| `heading` | `#030712` (gray-950) | 页面标题、卡片名称 |
| `body` | `#374151` (gray-700) | 正文内容 |
| `secondary` | `#6b7280` (gray-500) | 描述文字、时间戳 |
| `muted` | `#9ca3af` (gray-400) | 占位符、辅助信息 |
| `border` | `#e5e7eb` (gray-200) | 卡片、输入框默认边框 |
| `surface` | `#f9fafb` (gray-50) | 页面背景、输入框默认底色 |

### 阴影系统

```
shadow-sm  → 0 1px 2px rgba(0,0,0,0.05)          卡片默认态
shadow-md  → 0 4px 12px rgba(0,0,0,0.08)          卡片 hover 态
shadow-lg  → 0 8px 24px rgba(0,0,0,0.10)          弹窗、下拉菜单
```

### 间距 & 圆角

- 卡片内边距：`p-4`（16px）
- 页面横向边距：`px-6`（24px）；现为 `px-4`
- 卡片圆角：`rounded-xl`（12px）——与现在一致
- 按钮圆角：`rounded-lg`（8px）
- 小元素（badge、tab）：`rounded-full` 或 `rounded-md`

### 过渡动效

所有交互态统一：`transition-all duration-150 ease-out`

---

## 2. Header

**文件：** `components/layout/header.tsx`

| 属性 | 改前 | 改后 |
|---|---|---|
| 高度 | `h-12` (48px) | `h-14` (56px) |
| logo 色 | `text-gray-900` | `text-[#030712]` + `letter-spacing: -0.4px` |
| 横向内边距 | `px-4` | `px-6` |
| Avatar 大小 | `w-7 h-7` | `w-[30px] h-[30px]` |

---

## 3. Home 页

**文件：** `app/page.tsx`、`components/home/project-list.tsx`、`components/home/project-card.tsx`

### 页面布局

- `max-w-5xl` → `max-w-[860px]`
- 顶部内边距：`py-8` → `py-9`（36px）

### 标题区（`project-list.tsx`）

- `h1` 字号：`text-2xl` → `text-[22px]`，字重 `font-bold`，`letter-spacing: -0.5px`，颜色 `text-[#030712]`
- 项目计数：从 `text-gray-500 text-sm` 改为 `text-[13px] text-[#6b7280]`
- "新建项目"按钮：`h-[34px] px-[14px] rounded-lg`，hover 时增加 `shadow` 光晕 `shadow-[0_2px_8px_rgba(79,70,229,0.25)]`

### Tab 筛选（新增）

在标题区和网格之间新增一个"全部 / 最近"胶囊 Tab，状态存入 `useState`，"最近"过滤 7 天内更新的项目。

```tsx
// 样式：background:#f3f4f6; padding:2px; border-radius:8px
// active tab: background:white; box-shadow: 0 1px 2px rgba(0,0,0,0.08)
```

### 项目卡片（`project-card.tsx`）

- 默认态：`bg-white border border-[#e5e7eb] rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.05)]`
- Hover 态：`hover:border-[#a5b4fc] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]`
- 版本 badge：从 `variant="secondary"` 改为 `bg-[#eef2ff] text-[#4f46e5] text-[11px] font-medium rounded-full px-[7px] py-[2px]`
- `···` 菜单按钮：仅 hover 时 `opacity-100`（现已是，保持）
- 底部时间戳与 `···` 菜单同行，时间戳 `text-[11px] text-[#9ca3af]`

### 新建项目虚线卡片（新增）

在项目列表网格末尾追加一个虚线卡片，替代顶部的独立"新建项目"按钮：

```tsx
<div className="border-[1.5px] border-dashed border-[#d1d5db] rounded-xl min-h-[108px]
                flex flex-col items-center justify-center gap-1.5 cursor-pointer
                transition-all duration-150 hover:border-[#a5b4fc] hover:bg-[#f5f3ff]">
  <div className="w-7 h-7 rounded-[8px] bg-[#eef2ff] flex items-center justify-center
                  text-[#4f46e5] text-base font-medium">+</div>
  <span className="text-[13px] font-medium text-[#6b7280]">新建项目</span>
</div>
```

顶部"新建项目"按钮保留（桌面端显示），虚线卡片为第二入口。

### 空态（`project-list.tsx`）

- 移除大号 emoji `🚀`，改为渐变圆角方块图标：`w-[52px] h-[52px] rounded-[14px] bg-gradient-to-br from-[#eef2ff] to-[#ede9fe] border border-[#e0e7ff]` 内含 `🚀` (text-2xl)
- 标题字号 `text-base font-semibold text-[#111827]`
- 描述 `text-[13px] text-[#6b7280] leading-relaxed`

---

## 4. Workspace 侧边栏

**文件：** `components/sidebar/conversation-sidebar.tsx`、`components/sidebar/project-item.tsx`

### 尺寸变化

- 桌面宽度：`w-60` (240px) → `w-[220px]`
- 平板宽度：`w-12` (48px) 保持不变（icon-only 模式不改）

### 样式

- 背景：`bg-gray-50` → `bg-white`（与 Header 统一）
- 顶部"新建项目"区域内边距：`p-2 lg:p-3` → `p-[10px]`

### Section 标签（新增）

在 `nav` 内项目列表前加：

```tsx
<div className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-[0.07em] px-2 pt-2 pb-1">
  最近项目
</div>
```

### 项目 item（`project-item.tsx`）

- 默认：`flex items-center gap-2 px-2 py-[7px] rounded-lg cursor-pointer hover:bg-[#f9fafb]`
- **激活态（当前项目）**：
  - 背景 `bg-[#eef2ff]`
  - 左侧 3px 指示条：`before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r-sm before:bg-[#4f46e5]`
  - 文字 `text-[#3730a3] font-semibold`
- 左侧圆点：`w-1.5 h-1.5 rounded-full bg-[#d1d5db]`，激活态 `bg-[#4f46e5]`，替换掉现有较复杂的 icon
- 显示项目名 + 相对时间（`今天` / `昨天` / `4月X日`）
- `···` 删除菜单：`opacity-0 group-hover:opacity-100`

---

## 5. Chat 区域

**文件：** `components/workspace/chat-area.tsx`、`components/agent/agent-message.tsx`

### 用户消息气泡

- 圆角：`rounded-2xl rounded-tr-sm` → `rounded-[16px_16px_4px_16px]`
- 颜色 `bg-[#4f46e5]` 保持

### Agent 消息

**移除** 现有的 `border-l-2` colored left border + `bg-gray-50`。  
**改为** 按 Agent 角色使用轻薄彩色气泡：

| Agent | 背景 | 边框 |
|---|---|---|
| pm | `bg-[#eef2ff]` | `border-[#e0e7ff]` |
| architect | `bg-[#f5f3ff]` | `border-[#ede9fe]` |
| engineer | `bg-[#f0fdf4]` | `border-[#dcfce7]` |
| 其他/默认 | `bg-[#f9fafb]` | `border-[#f3f4f6]` |

气泡圆角：`rounded-[4px_16px_16px_16px]`（左上直角，其余圆润）

### Agent Avatar

- 移除 `border-2` + `style={{ borderColor: agent.color }}`
- 改为：`w-[30px] h-[30px] rounded-full flex items-center justify-center shadow-[0_1px_3px_rgba(0,0,0,0.08)]`
- 背景色使用对应 `primary-surface`（PM=`#eef2ff`，architect=`#f5f3ff`，engineer=`#f0fdf4`）

### Agent 名称 & 状态行

- 名称：`text-[11px] font-semibold`，颜色保持 `agent.color`
- 状态文字：`text-[11px] text-[#9ca3af]`

### PM 输出卡片（`pm-output-card.tsx`）

- 标题：`text-[13px] font-semibold text-[#3730a3]`
- feature item 前缀改为 `✦`（`text-[#a5b4fc] text-[10px]`）替代原来的 bullet

### 消息列表间距

- `gap` 从当前自动间距改为统一 `gap-4`（16px）

### Chat Input（`chat-input.tsx`）

- 外层 wrap：`bg-[#f9fafb] border-[1.5px] border-[#e5e7eb] rounded-xl`
- Focus within：`border-[#a5b4fc] bg-white`（用 `:focus-within` 伪类）
- 内边距：`px-3 py-2.5`
- 发送按钮：`w-[30px] h-[30px] rounded-lg bg-[#4f46e5] hover:bg-[#4338ca]`，内含向上箭头 SVG

---

## 6. 预览面板

**文件：** `components/preview/preview-panel.tsx`

### 工具栏

- Tab（预览/代码）改为胶囊样式，与 Home 页 tabs 保持一致：
  ```
  outer: bg-[#f3f4f6] p-[2px] rounded-lg
  active: bg-white rounded-md shadow-[0_1px_2px_rgba(0,0,0,0.08)] text-[#111827]
  inactive: text-[#6b7280]
  font-size: text-xs font-medium
  ```
- "Export ↓"保持 secondary（`border border-[#e5e7eb] bg-white text-[#374151]`）
- "Deploy ↗"改为 primary（`bg-[#4f46e5] text-white`），hover `bg-[#4338ca]`，两者 `h-[28px] rounded-md text-[11px]`

### 空态

- 移除 `text-5xl` emoji，改为渐变圆角方块（同 Home 空态图标样式）
- 文案：`正在等待生成 — 在左侧输入需求，AI 将为你生成应用` 改为两行：`<strong>BuilderAI</strong>` 标题 + 描述

---

## 7. 不涉及的范围

- **Version Timeline**：当前已有，不在本次改动内
- **多文件编辑器（Monaco）**：不改动
- **移动端 tab bar**：视觉小调（颜色统一），不改布局
- **功能逻辑**：无任何功能变更，仅视觉和样式

---

## 8. 实施指引

1. 从 `main` 新建分支 `feat/ui-refined-tool`
2. 按以下顺序实施，每个文件改完可单独验证：
   1. 全局 token 提取（如有 Tailwind config 的 theme extend，可在此统一）
   2. `header.tsx`
   3. `project-card.tsx` + `project-list.tsx`（含空态）
   4. `conversation-sidebar.tsx` + `project-item.tsx`
   5. `agent-message.tsx` + `pm-output-card.tsx`
   6. `chat-input.tsx`
   7. `preview-panel.tsx`
3. 每个文件改动后：`npm run build` 确保无 TS 错误
4. 完成后跑 `npm run test:e2e` 确认功能无回归
