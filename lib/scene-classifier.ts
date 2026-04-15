import type { Scene, PmOutput } from "@/lib/types";

const MAX_SCENES = 3;

const PROMPT_KEYWORDS: Record<Exclude<Scene, "general">, readonly string[]> = {
  game: [
    "游戏", "贪吃蛇", "俄罗斯方块", "snake", "tetris", "game", "弹球",
    "打地鼠", "迷宫", "棋", "2048", "flappy", "pong", "扫雷", "消消乐",
  ],
  "game-engine": [],
  "game-canvas": [],
  dashboard: [
    "仪表盘", "图表", "dashboard", "chart", "统计", "可视化", "报表", "analytics",
  ],
  crud: [
    "管理", "增删改查", "表单", "列表", "crud", "todo", "待办", "记录", "笔记",
  ],
  multiview: [
    "多页面", "设置页", "导航", "标签页", "tab", "页面切换", "sidebar", "菜单",
  ],
  animation: [
    "动画", "拖拽", "drag", "animate", "过渡", "轮播", "carousel", "slider",
  ],
  persistence: [
    "保存", "同步", "数据库", "持久化", "cloud", "存储",
  ],
};

export function classifySceneFromPrompt(prompt: string): Scene[] {
  const lower = prompt.toLowerCase();
  const matched: Scene[] = [];

  for (const [scene, keywords] of Object.entries(PROMPT_KEYWORDS) as [Exclude<Scene, "general">, readonly string[]][]) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.push(scene);
    }
  }

  if (matched.length === 0) return ["general"];
  return matched.slice(0, MAX_SCENES);
}

const PM_FEATURE_KEYWORDS: Record<Exclude<Scene, "general">, readonly string[]> = {
  game: ["移动", "碰撞", "得分", "关卡", "生命", "游戏"],
  "game-engine": [],
  "game-canvas": [],
  dashboard: ["图表", "统计", "趋势", "指标", "分析"],
  crud: ["添加", "删除", "编辑", "筛选", "搜索", "管理", "记录"],
  multiview: ["切换", "导航", "页面"],
  animation: ["拖拽", "排序", "动画", "过渡", "滑动"],
  persistence: [],
};

const PM_MODULE_KEYWORDS: Record<Exclude<Scene, "general">, readonly RegExp[]> = {
  game: [/game/i, /board/i, /loop/i, /score/i],
  "game-engine": [],
  "game-canvas": [],
  dashboard: [/chart/i, /graph/i, /analytics/i, /stats/i, /dashboard/i],
  crud: [/form/i, /list/i, /table/i, /editor/i],
  multiview: [],
  animation: [],
  persistence: [],
};

const MULTIVIEW_MODULE_THRESHOLD = 3;

export function classifySceneFromPm(pm: PmOutput): Scene[] {
  const matched: Scene[] = [];
  const featuresText = pm.features.join(" ").toLowerCase();
  const modulesText = pm.modules.join(" ");

  for (const [scene, keywords] of Object.entries(PM_FEATURE_KEYWORDS) as [Exclude<Scene, "general">, readonly string[]][]) {
    if (keywords.length > 0 && keywords.some((kw) => featuresText.includes(kw))) {
      matched.push(scene);
    }
  }

  for (const [scene, patterns] of Object.entries(PM_MODULE_KEYWORDS) as [Exclude<Scene, "general">, readonly RegExp[]][]) {
    if (!matched.includes(scene) && patterns.some((re) => re.test(modulesText))) {
      matched.push(scene);
    }
  }

  if (!matched.includes("multiview") && pm.modules.length >= MULTIVIEW_MODULE_THRESHOLD) {
    matched.push("multiview");
  }

  if (!matched.includes("persistence") && (pm.persistence === "supabase" || pm.persistence === "localStorage")) {
    matched.push("persistence");
  }

  if (matched.length === 0) return ["general"];
  return matched.slice(0, MAX_SCENES);
}
