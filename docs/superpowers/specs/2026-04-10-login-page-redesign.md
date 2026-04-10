# Login Page Redesign

**Date:** 2026-04-10
**Scope:** `app/login/page.tsx`, `components/layout/login-button.tsx`, `components/layout/guest-login-buttons.tsx`
**Approach:** Direct rewrite with `/ui-ux-pro-max` guidance at each style decision point

---

## Design Direction

**Style:** 浅色展示型（C）— 浅紫渐变全屏背景，白色浮层卡片居中，突出三个 Agent 角色。
**Layout:** 紧凑居中（A）— 单卡片，不做分屏或全屏抽屉。

---

## Visual Spec

### Page wrapper (`app/login/page.tsx`)

- 全屏背景：`bg-gradient-to-br from-[#eef2ff] via-[#ede9fe] to-[#faf5ff]`（150° 浅蓝→浅紫→极淡紫）
- 居中容器：`min-h-screen flex items-center justify-center`

### Card

- 宽度：`w-full max-w-[340px]`
- 圆角：`rounded-[20px]`
- 内边距：`p-8`
- 阴影：`shadow-[0_8px_40px_rgba(79,70,229,0.14),0_2px_8px_rgba(0,0,0,0.04)]`
- 背景：`bg-white`

### Logo 区

- Logo 文字：`text-[22px] font-black tracking-[-0.5px] text-[#030712]`，`AI` 部分 `text-indigo-600`
- 副标题：`text-[12px] text-[#6b7280]`，文案改为 **"用自然语言构建 Web 应用"**

### Agent 卡片组

三个卡片横排，每卡：
- 背景：`bg-[#f5f3ff]`，边框：`border border-[#ede9fe]`，圆角：`rounded-[12px]`
- 图标：emoji（原有），`text-xl`
- 角色名：`text-[9px] font-bold text-indigo-600`
- 子标题（新增）：`text-[8px] text-[#9ca3af]`，内容：PM→"需求分析"，Architect→"方案设计"，Engineer→"代码生成"

### GitHub 登录按钮 (`login-button.tsx`)

- 样式：`w-full rounded-[10px] h-[42px]`，indigo 实底
- hover：`hover:shadow-[0_4px_16px_rgba(79,70,229,0.3)]`
- 图标间距：`gap-[7px]`

### 分割线

- 细线 + 居中"或"文字，颜色 `#d1d5db`

### 游客按钮 (`guest-login-buttons.tsx`)

- "Continue as Guest"：`border-[1.5px] border-[#e5e7eb] rounded-[10px] h-[40px]`，hover 加深边框
- "Try as Guest"：ghost，`text-[#9ca3af]`，无边框

---

## Files Changed

| File | Change |
|------|--------|
| `app/login/page.tsx` | 渐变背景、卡片样式、Agent 卡片子标题、副标题文案 |
| `components/layout/login-button.tsx` | 圆角、阴影、hover 效果 |
| `components/layout/guest-login-buttons.tsx` | 边框样式统一、ghost 变体微调 |

---

## Implementation Notes

- 使用 `/ui-ux-pro-max` 技能在每个组件的样式落地时输出精确的 Tailwind 值
- 不引入新依赖，全部使用现有 Tailwind + shadcn/ui
- 不改动任何逻辑（signIn、GuestLoginButtons 的状态逻辑保持不变）
- 改动后运行 `npm run lint` 和本地预览确认

---

## Success Criteria

- 登录页背景为浅紫渐变，白卡居中浮起，视觉层次清晰
- 三个 Agent 卡片有角色名 + 子标题
- GitHub 按钮 hover 时有紫色光晕阴影
- 游客按钮样式统一，不喧宾夺主
- 移动端（max-w-sm）下卡片不溢出
