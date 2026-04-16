import type { Scene, GameSubtype } from "@/lib/types";

const SCENE_ENGINEER_RULES: Record<Exclude<Scene, "general">, string> = {
  game: `【游戏/动画类应用 - useEffect 无限循环防护】
如果应用涉及游戏循环、动画、定时器（贪吃蛇、俄罗斯方块、计时器等），必须遵守：
1. 游戏状态（蛇身坐标、方块位置等高频变化数据）用 useRef 存储，不用 useState
2. 只有需要触发 UI 重绘的数据（分数、游戏结束标志）才用 useState
3. setInterval/requestAnimationFrame 的 useEffect 依赖数组必须为 []，在回调内通过 ref.current 读写状态
4. 需要重绘画面时，用一个独立的 forceUpdate 计数器：const [tick, setTick] = useState(0)，在 interval 回调末尾 setTick(t => t + 1)
5. 键盘事件监听器的 useEffect 依赖数组也必须为 []，方向存入 useRef
6. 触摸事件（touchstart/touchend）同样必须依赖数组为 []，在回调内通过 ref.current 写入方向，不要将方向存入 useState 再放入依赖：
   错误：useEffect(() => { window.addEventListener('touchstart', e => setDir(swipe(e))); }, [dir])
   正确：const dirRef = useRef('RIGHT');
         useEffect(() => { const fn = e => { dirRef.current = swipe(e) || dirRef.current; }; window.addEventListener('touchstart', fn); return () => window.removeEventListener('touchstart', fn); }, []);
错误示例：
  useEffect(() => { const id = setInterval(() => setSnake(move(snake)), 200); return () => clearInterval(id); }, [snake])
正确示例：
  const snakeRef = useRef(initialSnake); const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => { snakeRef.current = move(snakeRef.current); setTick(t => t + 1); }, 200); return () => clearInterval(id); }, []);`,

  dashboard: `【数据可视化类应用 - 无 recharts 纯 SVG/CSS 绘图】
禁止使用 recharts/chart.js/d3/nivo 等图表库，必须用纯 SVG 或 CSS 实现：
1. 柱状图：<svg> + <rect> 元素，用 Math.max 归一化高度，添加数值标签
2. 折线图：<svg> + <polyline>，points 属性拼接坐标字符串，可加 <circle> 标记数据点
3. 饼图：多个 <circle> 叠加，用 stroke-dasharray 和 stroke-dashoffset 实现扇区
4. 数值卡片：纯 div + Tailwind，不需要 SVG
5. 响应式：用 viewBox="0 0 width height" + preserveAspectRatio="xMidYMid meet"
6. 坐标轴：用 <line> + <text> 手动绘制，不依赖任何库
7. 数据源：仪表盘必须使用 hardcoded mock 数据（直接定义在组件或常量文件中），禁止从 Supabase 或任何远程 API 读取数据。原因：沙箱环境无预置数据，远程请求必然返回空/报错导致图表渲染 NaN
错误示例：import { BarChart, XAxis, YAxis } from 'recharts'
错误示例：const { data } = await supabase.from('DynamicAppData').select('*')  // 禁止！表为空会导致 NaN
正确示例：
  const salesData = [
    { month: '1月', value: 4200 }, { month: '2月', value: 5800 },
    { month: '3月', value: 3900 }, { month: '4月', value: 7100 },
  ];
  <svg viewBox="0 0 400 200" className="w-full">
    {salesData.map((d, i) => (
      <rect key={i} x={i * 50 + 10} y={200 - d.value / 40} width={40} height={d.value / 40} fill="#6366f1" rx={4} />
    ))}
  </svg>`,

  crud: `【CRUD/表单类应用 - 状态管理与数据流】
1. 表单状态用单个 useState 对象管理，不要每个字段一个 useState：
   const [form, setForm] = useState({ name: '', email: '', age: '' })
   const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
2. 列表数据和表单数据分离：const [items, setItems] = useState([]); const [form, setForm] = useState(EMPTY_FORM)
3. 编辑模式：用 editingId 标记正在编辑的项，提交时根据 editingId 决定 create 或 update
4. 删除前确认：用 window.confirm 或自定义 modal，不要直接删除
5. 提交后清空表单：setForm(EMPTY_FORM); setEditingId(null)
6. 乐观更新：先更新本地 state，再异步写入存储；失败时回滚并提示
错误示例：
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); // 字段越多越混乱
正确示例：
  const EMPTY = { name: '', email: '' };
  const [form, setForm] = useState(EMPTY);
  const handleSubmit = () => { setItems(prev => [...prev, { ...form, id: Date.now() }]); setForm(EMPTY); };`,

  multiview: `【多视图/多页面应用 - useState 路由模式】
禁止使用 react-router-dom 或任何路由库，必须用 useState 实现视图切换：
1. App.js 中定义视图状态：const [view, setView] = useState('home')
2. 条件渲染各视图：{view === 'home' && <HomeView />}，不要用 switch/case 返回组件
3. 导航通过 props 传递：<HomeView onNavigate={setView} />
4. 需要传参的视图用对象状态：const [route, setRoute] = useState({ view: 'home', params: {} })
5. 返回按钮：<button onClick={() => setView('home')}>返回</button>
6. 保持各视图状态：如需跨视图保持数据（如表单草稿），将状态提升到 App.js
错误示例：
  import { BrowserRouter, Route } from 'react-router-dom'
正确示例：
  const [route, setRoute] = useState({ view: 'home', params: {} });
  const navigate = (view, params = {}) => setRoute({ view, params });
  {route.view === 'home' && <HomeView onNavigate={navigate} />}
  {route.view === 'detail' && <DetailView id={route.params.id} onBack={() => navigate('home')} />}`,

  animation: `【动画/交互类应用 - 无 framer-motion 纯 CSS/JS 动画】
禁止使用 framer-motion/react-spring/GSAP 等动画库：
1. 入场/离场动画：CSS transition + 条件 className 切换
   className={\`transform transition-all duration-300 \${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}\`}
2. 循环动画：Tailwind animate-* 类（animate-spin/animate-pulse/animate-bounce）或 @keyframes
3. 拖拽排序：onMouseDown/onMouseMove/onMouseUp + transform: translate()，位置存 useRef
4. 轮播/滑动：translateX 百分比 + transition，索引用 useState
5. 列表动画：新增项用 setTimeout + setState 两步渲染（先插入 opacity-0，下一帧改 opacity-100）
6. 手势交互：用 touch 事件替代 mouse 事件实现移动端兼容
错误示例：import { motion, AnimatePresence } from 'framer-motion'
正确示例：
  const [show, setShow] = useState(false);
  <div className={\`transition-all duration-500 \${show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}\`}>
    Content
  </div>`,

  persistence: `【数据持久化应用 - Supabase/localStorage 正确用法】
1. Supabase 读写必须 await，不要忘记 error 处理：
   const { data, error } = await supabase.from('DynamicAppData').select('*').eq('appId', APP_ID)
   if (error) { console.error(error); return; }
2. 写入用 upsert 而非 insert（避免重复键冲突）：
   await supabase.from('DynamicAppData').upsert({ appId: APP_ID, key: 'todos', data: { items } })
3. localStorage 读取时必须 try-catch + JSON.parse 防御：
   let saved = []; try { saved = JSON.parse(localStorage.getItem('key') || '[]'); } catch {}
4. localStorage 写入用 useEffect 监听状态变化，不要在每次 setState 后手动调用：
   useEffect(() => { localStorage.setItem('key', JSON.stringify(items)); }, [items]);
5. 初始加载用 useState 惰性初始化：
   const [items, setItems] = useState(() => { try { return JSON.parse(localStorage.getItem('key') || '[]'); } catch { return []; } })
6. Supabase 初始加载放在 useEffect([], ...)，不要在 render 中直接 await
错误示例：
  const data = supabase.from('DynamicAppData').select('*') // 忘记 await
正确示例：
  useEffect(() => { supabase.from('DynamicAppData').select('*').eq('appId', APP_ID).then(({ data }) => data && setItems(data)); }, []);`,

  "game-engine": `## 游戏引擎规则 (Phaser.js)
- 使用 Phaser 3 框架，import Phaser from 'phaser'
- 入口文件创建 Phaser.Game 实例并挂载到 DOM 容器
- 场景用 class extends Phaser.Scene，实现 preload/create/update
- 物理引擎用 Arcade Physics (this.physics.add)
- 素材用几何图形（this.add.rectangle/circle）或 emoji（this.add.text）
- 不要在 React 组件内写游戏逻辑
- 碰撞检测用 this.physics.add.collider / overlap
- 相机跟随用 this.cameras.main.startFollow(player)
- 输入用 this.input.keyboard.createCursorKeys()`,

  "game-canvas": `## 游戏规则 (Canvas 原生)
- 使用 Canvas 2D API，不引入游戏引擎
- Canvas 元素通过 useRef 获取
- 游戏循环用 requestAnimationFrame，在 useEffect 中启动
- useEffect cleanup 必须 cancelAnimationFrame
- 游戏状态用普通对象（不用 useState），通过 useRef 持有
- 只用 useState 触发 UI 重渲染（分数、游戏结束状态）
- 碰撞检测用 AABB（轴对齐包围盒）
- 输入用 addEventListener('keydown'/'keyup')，cleanup 时 removeEventListener
- 绘制用 ctx.fillRect / ctx.arc / ctx.fillText`,
};

const SCENE_ARCHITECT_HINTS: Record<Exclude<Scene, "general">, string> = {
  game: "本项目为 game 类型，建议将游戏逻辑（状态机/碰撞检测）与 UI 渲染拆分为独立文件。",
  "game-engine": "使用 Phaser 3 框架。场景用 Phaser.Scene 类。物理用 Arcade Physics。素材用几何图形。",
  "game-canvas": "使用 Canvas 2D API。游戏循环用 requestAnimationFrame。状态用普通对象不用 React state。",
  dashboard: "本项目为 dashboard 类型，图表须用纯 SVG 实现，建议每种图表类型拆为独立组件。",
  crud: "本项目为 crud 类型，建议将表单组件、列表组件、数据操作逻辑分离为独立文件。",
  multiview: "本项目为 multiview 类型，建议在 App.js 用 useState 统一管理视图路由，每个视图为独立组件。",
  animation: "本项目为 animation 类型，禁止使用 framer-motion，动画须用纯 CSS transition/animation 或 requestAnimationFrame 实现。",
  persistence: "本项目涉及数据持久化，建议将数据读写逻辑集中到独立的 hooks 或 service 文件中。",
};

const GAME_SUBTYPE_ENGINEER_RULES: Record<Exclude<GameSubtype, "generic">, string> = {
  match3: `【match3 专属规则】
- 棋盘用二维数组：gridRef.current = Array(8).fill(null).map(() => Array(8).fill(null).map(() => randomColor()))
- 颜色种类 5-6 种，用字符串或数字枚举，每种颜色对应一个 Tailwind bg 色
- swap 必须校验相邻性（上下左右，不含对角线）
- swap 后如果没有 match，必须 swap 回来（无效交换）
- match 检测：遍历每行每列，找连续 ≥3 同色方块
- cascade 循环：清除 match → 上方方块下落填补空位 → 空位顶部随机生成新方块 → 再检测 match → 直到无 match
- 点击交互：第一次点击选中（高亮边框），第二次点击如果与选中方块相邻则执行 swap，否则更换选中目标
- 动画：swap 和下落用 CSS transition（transform + transition-all 300ms），不用 requestAnimationFrame`,

  snake: `【snake 专属规则】
- 蛇身用坐标数组：snakeRef.current = [{x:10,y:10},{x:9,y:10},{x:8,y:10}]
- 方向用 useRef 存储，键盘事件更新方向，禁止直接反向（左→右）
- 每 tick：蛇头按方向移动一格，蛇身跟随（unshift 新头，pop 尾巴；吃到食物不 pop）
- 食物随机生成在非蛇身位置
- 碰撞检测：蛇头碰墙壁或自身 → 游戏结束
- 网格渲染：用 div grid 或 canvas fillRect，每格 20-30px`,

  tetris: `【tetris 专属规则】
- 棋盘用二维数组 (20行×10列)，0=空，非0=已固定方块颜色
- 7 种标准方块（I/O/T/S/Z/J/L），每种用旋转矩阵表示 4 个朝向
- 当前方块用 {type, rotation, x, y} 描述
- 每 tick（setInterval 500-800ms）：方块下落一行，碰到底部或已固定方块则固定
- 固定后检测满行：满行消除，上方整体下移
- 旋转：顺时针旋转 rotation，检测旋转后是否越界或碰撞，碰撞则取消旋转（wall kick 可选）
- 左右移动：检测目标位置是否合法
- 预览：显示下一个方块`,

  platformer: `【platformer 专属规则】
- 使用 Phaser 3 框架（已在 game-engine scene 白名单中）
- 玩家用 this.physics.add.sprite，启用 Arcade Physics 重力
- 平台用 this.physics.add.staticGroup
- 碰撞：this.physics.add.collider(player, platforms)
- 跳跃：着地时按上键设置 player.setVelocityY(-330)，空中不能二段跳
- 左右移动：cursors.left/right 设置 player.setVelocityX(±160)
- 相机跟随：this.cameras.main.startFollow(player)
- 素材用几何图形（this.add.rectangle）或 emoji text`,

  card: `【card 专属规则】
- 牌组用数组，每张牌 {suit, rank, faceUp}
- 洗牌用 Fisher-Yates shuffle
- 拖拽牌堆：onMouseDown 记录起始位置，onMouseMove 更新位置，onMouseUp 判断放置区域
- 翻牌动画：CSS rotateY transition（0deg → 180deg），背面/正面用 backface-visibility
- 牌面渲染：div + Tailwind（圆角白色卡片，花色用 emoji ♠♥♦♣）`,

  board: `【board 专属规则】
- 棋盘用二维数组，每格存储棋子状态（null/player1/player2）
- 回合制：turnRef.current 记录当前回合，点击后切换
- 胜负检测：每次落子后检查行/列/对角线（五子棋检查连续5子，井字棋检查3子）
- 棋盘渲染：CSS grid，每格用 div + onClick，棋子用 emoji 或 SVG circle
- 禁止落子在已占位置
- 悔棋（可选）：用历史数组记录每步`,
};

const GAME_SUBTYPE_ARCHITECT_HINTS: Record<Exclude<GameSubtype, "generic">, string> = {
  match3: `【match3 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 核心游戏逻辑 + 渲染（maxLines: 400）
   - 8×8 网格状态（useRef）、swap、match 检测、cascade、动画、输入处理
   导出：GameBoard (default)
2. /components/GameUI.jsx — 得分、关卡、游戏状态 UI（maxLines: 100）
   导出：GameUI (default)
3. /App.jsx — 入口 + 状态胶水（maxLines: 80）
   导出：App (default)
关键约束：GameBoard 持有全部游戏状态（useRef），通过 onScoreChange/onGameOver 回调通知 App。不要拆分游戏核心逻辑到 utils 文件。匹配检测必须处理 cascade（消除→下落→再检测循环）。`,

  snake: `【snake 游戏架构建议】
推荐文件结构（2-3 文件）：
1. /components/GameBoard.jsx — 蛇身移动、碰撞、食物、渲染（maxLines: 300）
   导出：GameBoard (default)
2. /App.jsx — 入口 + 分数/状态 UI（maxLines: 100）
   导出：App (default)
关键约束：蛇身坐标、方向、食物位置全部用 useRef，只有 score/gameOver 用 useState。`,

  tetris: `【tetris 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 棋盘、方块下落、旋转、消行（maxLines: 400）
   导出：GameBoard (default)
2. /components/NextPiece.jsx — 下一个方块预览（maxLines: 60）
   导出：NextPiece (default)
3. /App.jsx — 入口 + 分数/等级 UI（maxLines: 100）
   导出：App (default)
关键约束：棋盘状态和当前方块用 useRef，消行检测在方块固定时执行。`,

  platformer: `【platformer 游戏架构建议】
推荐文件结构（3 文件）：
1. /scenes/GameScene.js — Phaser.Scene 子类，preload/create/update（maxLines: 400）
   导出：GameScene (default)
2. /components/GameContainer.jsx — Phaser.Game 初始化 + React 包装（maxLines: 80）
   导出：GameContainer (default)
3. /App.jsx — 入口 + HUD overlay（maxLines: 80）
   导出：App (default)
关键约束：所有游戏逻辑在 Phaser Scene 内，React 只做 UI overlay。`,

  card: `【card 游戏架构建议】
推荐文件结构（3 文件）：
1. /components/GameBoard.jsx — 牌堆、拖拽、翻牌逻辑（maxLines: 350）
   导出：GameBoard (default)
2. /components/Card.jsx — 单张牌渲染 + 翻牌动画（maxLines: 80）
   导出：Card (default)
3. /App.jsx — 入口 + 新游戏/分数 UI（maxLines: 80）
   导出：App (default)
关键约束：牌组状态集中在 GameBoard，Card 是纯展示组件。`,

  board: `【board 游戏架构建议】
推荐文件结构（2-3 文件）：
1. /components/GameBoard.jsx — 棋盘渲染 + 落子 + 胜负判定（maxLines: 300）
   导出：GameBoard (default)
2. /App.jsx — 入口 + 回合/胜负状态 UI（maxLines: 100）
   导出：App (default)
关键约束：棋盘状态用 useRef 或 useState（回合制不需要高频更新），胜负检测在每次落子后执行。`,
};

const GAME_SCENES = new Set<Scene>(["game", "game-engine", "game-canvas"]);

/**
 * When a known game subtype is active, filter out scenes that would inject
 * contradictory rules (e.g. Canvas rules for a CSS-based match3 game).
 * Also removes "animation" when any game scene is present — game subtypes
 * already include their own animation guidance.
 */
const SUBTYPE_EXCLUDED_SCENES: Partial<Record<GameSubtype, ReadonlySet<Scene>>> = {
  match3: new Set(["game-canvas", "game-engine", "animation"]),
  snake: new Set(["game-engine", "animation"]),
  tetris: new Set(["game-engine", "animation"]),
  board: new Set(["game-engine", "game-canvas", "animation"]),
  card: new Set(["game-engine", "game-canvas", "animation"]),
  platformer: new Set(["game-canvas", "animation"]),
};

function filterScenes(scenes: Scene[], gameSubtype?: GameSubtype): Exclude<Scene, "general">[] {
  const excluded = gameSubtype ? SUBTYPE_EXCLUDED_SCENES[gameSubtype] : undefined;
  return scenes.filter((s): s is Exclude<Scene, "general"> => {
    if (s === "general") return false;
    if (excluded && excluded.has(s)) return false;
    return true;
  });
}

export function getEngineerSceneRules(scenes: Scene[], gameSubtype?: GameSubtype): string {
  const filtered = filterScenes(scenes, gameSubtype);
  const blocks = filtered
    .map((s) => SCENE_ENGINEER_RULES[s])
    .filter(Boolean);

  // Append game subtype rules if applicable
  if (gameSubtype && gameSubtype !== "generic" && scenes.some((s) => GAME_SCENES.has(s))) {
    const subtypeRule = GAME_SUBTYPE_ENGINEER_RULES[gameSubtype];
    if (subtypeRule) blocks.push(subtypeRule);
  }

  return blocks.join("\n\n");
}

export function getArchitectSceneHint(scenes: Scene[], gameSubtype?: GameSubtype): string {
  const filtered = filterScenes(scenes, gameSubtype);
  const hints = filtered
    .map((s) => SCENE_ARCHITECT_HINTS[s])
    .filter(Boolean);

  // Append game subtype architecture hints if applicable
  if (gameSubtype && gameSubtype !== "generic" && scenes.some((s) => GAME_SCENES.has(s))) {
    const subtypeHint = GAME_SUBTYPE_ARCHITECT_HINTS[gameSubtype];
    if (subtypeHint) hints.push(subtypeHint);
  }

  if (hints.length === 0) return "";
  return `【场景提示】${hints.join(" ")}`;
}
