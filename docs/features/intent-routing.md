# 意图路由（Intent Routing）

## 概述

用户每次发送消息时，系统首先对 prompt 进行意图分类，决定走哪条生成路径——直接路由到 Engineer（bug_fix / style_change）还是完整三 Agent 流水线（new_project / feature_add）。意图分类器位于 `lib/intent-classifier.ts`，是整个生成流程的入口决策点。

## 设计思路

关键取舍：用 keyword-matching 而非语义模型。优点是零延迟、零成本、可预测；缺点是无法处理语义模糊的 prompt（见"未覆盖场景"）。

优先级顺序（从高到低）：

1. 无现有代码 → 强制 `new_project`（无论 prompt 内容）
2. BUG_KEYWORDS 命中 → `bug_fix`
3. STYLE_KEYWORDS 命中 → `style_change`
4. 颜色表达式命中（`hasColorIntent`）→ `style_change`
5. NEW_PROJECT_KEYWORDS 命中 → `new_project`
6. 默认 → `feature_add`

## 代码逻辑

### 函数签名

```typescript
export function classifyIntent(
  prompt: string,
  hasExistingCode: boolean
): Intent
```

`Intent` 类型定义在 `lib/types.ts`，值为 `"new_project" | "bug_fix" | "style_change" | "feature_add"`。

### 关键字列表

```typescript
const BUG_KEYWORDS = [
  "bug", "错误", "不工作", "修复", "报错", "没有反应",
  "失效", "崩溃", "出错", "fix", "broken", "doesn't work",
  "不能用", "失败", "exception", "异常",
]

const STYLE_KEYWORDS = [
  "颜色", "字体", "样式", "布局", "ui", "美化", "主题",
  "color", "font", "style", "layout", "theme", "dark mode", "深色",
  "background", "背景", "间距", "padding", "margin", "设计",
  "圆角", "阴影", "shadow", "border-radius", "加粗", "字号",
]

const NEW_PROJECT_KEYWORDS = [
  "重新做", "重新设计", "全新", "new project", "start over",
  "重做", "从头", "推倒重来",
]
```

### 颜色意图检测

`hasColorIntent(lower: string): boolean` 补充处理 STYLE_KEYWORDS 未覆盖的颜色表达：

```typescript
// 精确匹配汉字颜色词（防误判"角色"、"特色"等）
const CHINESE_COLOR_RE = /[红橙黄绿蓝紫粉黑白灰青棕]色|底色|背景色|主色|文字色|边框色|字体色/;

// CSS 十六进制或 rgb 值
const CSS_COLOR_RE = /#[0-9a-fA-F]{3,6}|rgb\(|rgba\(/i;
```

### 调用链

```
components/workspace/chat-area.tsx
  └── handleSend()
        └── classifyIntent(prompt, hasExistingCode)    // Phase 0
              └── 返回 Intent
        └── if bug_fix | style_change → directPath()
        └── if new_project | feature_add → fullPipeline()
```

## 覆盖场景

| 场景 | 分类结果 |
|------|---------|
| 无任何现有代码 | `new_project` |
| "修复登录按钮报错" | `bug_fix`（"修复" + "报错"） |
| "fix the broken modal" | `bug_fix`（"fix" + "broken"） |
| "把背景色改成 #1a1a2e" | `style_change`（CSS_COLOR_RE 命中） |
| "调整主色为红色系" | `style_change`（CHINESE_COLOR_RE "红色" 命中） |
| "dark mode 切换" | `style_change`（STYLE_KEYWORDS "dark mode"） |
| "重新做一个电商首页" | `new_project`（NEW_PROJECT_KEYWORDS "重新做"） |
| "加一个搜索功能" | `feature_add`（无关键词命中，默认） |
| "颜色 bug 都修一下" | `bug_fix`（BUG_KEYWORDS 优先级高于 STYLE_KEYWORDS） |

## 未覆盖场景 / 已知限制

- **语义意图**：prompt 语义上是 bug fix，但不包含已知关键词（如"为什么点了没反应"）→ 误分为 `feature_add`，走完整流水线。
- **复合意图**：同时修 bug 又改样式时，只取最高优先级 `bug_fix`，样式改动不会被单独处理。
- **非中英文**：关键词列表仅覆盖中文和英文，日文/韩文/法文等语言无法分类，默认 `feature_add`。
- **否定句**："不要改颜色" → 仍命中 STYLE_KEYWORDS 中的"颜色"，可能误判为 `style_change`。

## 相关文件

- `lib/intent-classifier.ts` — 分类器核心逻辑
- `lib/types.ts` — `Intent` 类型定义
- `components/workspace/chat-area.tsx` — 调用 `classifyIntent` 的入口（Phase 0）
