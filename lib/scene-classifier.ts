import type { Scene, PmOutput } from "@/lib/types";

const MAX_SCENES = 3;

const PROMPT_KEYWORDS: Record<Exclude<Scene, "general">, readonly string[]> = {
  game: [
    "游戏", "贪吃蛇", "俄罗斯方块", "snake", "tetris", "game", "弹球",
    "打地鼠", "迷宫", "棋", "2048", "flappy", "pong", "扫雷", "消消乐",
  ],
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

export function classifySceneFromPm(_pm: PmOutput): Scene[] {
  // Placeholder — implemented in Task 3
  return ["general"];
}
