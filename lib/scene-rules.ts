import type { Scene } from "@/lib/types";

const SCENE_ENGINEER_RULES: Record<Exclude<Scene, "general">, string> = {
  game: `【游戏/动画类应用 - useEffect 无限循环防护】
如果应用涉及游戏循环、动画、定时器（贪吃蛇、俄罗斯方块、计时器等），必须遵守：
1. 游戏状态（蛇身坐标、方块位置等高频变化数据）用 useRef 存储，不用 useState
2. 只有需要触发 UI 重绘的数据（分数、游戏结束标志）才用 useState
3. setInterval/requestAnimationFrame 的 useEffect 依赖数组必须为 []，在回调内通过 ref.current 读写状态
4. 需要重绘画面时，用一个独立的 forceUpdate 计数器：const [tick, setTick] = useState(0)，在 interval 回调末尾 setTick(t => t + 1)
5. 键盘事件监听器的 useEffect 依赖数组也必须为 []，方向存入 useRef
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
错误示例：import { BarChart, XAxis, YAxis } from 'recharts'
正确示例：
  <svg viewBox="0 0 400 200" className="w-full">
    {data.map((d, i) => (
      <rect key={i} x={i * 50 + 10} y={200 - d.value * 2} width={40} height={d.value * 2} fill="#6366f1" rx={4} />
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
};

const SCENE_ARCHITECT_HINTS: Record<Exclude<Scene, "general">, string> = {
  game: "本项目为 game 类型，建议将游戏逻辑（状态机/碰撞检测）与 UI 渲染拆分为独立文件。",
  dashboard: "本项目为 dashboard 类型，图表须用纯 SVG 实现，建议每种图表类型拆为独立组件。",
  crud: "本项目为 crud 类型，建议将表单组件、列表组件、数据操作逻辑分离为独立文件。",
  multiview: "本项目为 multiview 类型，建议在 App.js 用 useState 统一管理视图路由，每个视图为独立组件。",
  animation: "本项目为 animation 类型，禁止使用 framer-motion，动画须用纯 CSS transition/animation 或 requestAnimationFrame 实现。",
  persistence: "本项目涉及数据持久化，建议将数据读写逻辑集中到独立的 hooks 或 service 文件中。",
};

export function getEngineerSceneRules(scenes: Scene[]): string {
  const blocks = scenes
    .filter((s): s is Exclude<Scene, "general"> => s !== "general")
    .map((s) => SCENE_ENGINEER_RULES[s])
    .filter(Boolean);
  return blocks.join("\n\n");
}

export function getArchitectSceneHint(scenes: Scene[]): string {
  const hints = scenes
    .filter((s): s is Exclude<Scene, "general"> => s !== "general")
    .map((s) => SCENE_ARCHITECT_HINTS[s])
    .filter(Boolean);
  if (hints.length === 0) return "";
  return `\n【场景提示】${hints.join(" ")}`;
}
