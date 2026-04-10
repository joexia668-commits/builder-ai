import type { Intent } from "@/lib/types";

const BUG_KEYWORDS = [
  "bug", "错误", "不工作", "修复", "报错", "没有反应",
  "失效", "崩溃", "出错", "fix", "broken", "doesn't work",
  "不能用", "失败", "exception", "异常",
] as const;

const STYLE_KEYWORDS = [
  "颜色", "字体", "样式", "布局", "ui", "美化", "主题",
  "color", "font", "style", "layout", "theme", "dark mode", "深色",
  "background", "背景", "间距", "padding", "margin", "设计",
] as const;

const NEW_PROJECT_KEYWORDS = [
  "重新做", "重新设计", "全新", "new project", "start over",
  "重做", "从头", "推倒重来",
] as const;

/**
 * Classifies the intent of a user prompt based on keywords and context.
 * Priority order: new_project (no code) > bug_fix > style_change > new_project (keywords) > feature_add
 */
export function classifyIntent(
  prompt: string,
  hasExistingCode: boolean
): Intent {
  if (!hasExistingCode) return "new_project";

  const lower = prompt.toLowerCase();

  if (BUG_KEYWORDS.some((kw) => lower.includes(kw))) return "bug_fix";
  if (STYLE_KEYWORDS.some((kw) => lower.includes(kw))) return "style_change";
  if (NEW_PROJECT_KEYWORDS.some((kw) => lower.includes(kw))) return "new_project";

  return "feature_add";
}
