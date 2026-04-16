# WebContainer 预览（WebContainer Preview）

> 注：该文件原名 sandpack-preview.md，Preview 引擎已从 Sandpack 替换为 WebContainer。文件路径保持不变以维持文档链接兼容性。

## 概述

AI 生成的 React 代码运行在 WebContainer 沙箱中（浏览器内 WASM Node.js 运行时，通过 Vite dev server 提供服务）。`lib/container-runtime.ts` 负责 WebContainer 的启动、文件挂载和增量热更新；`components/preview/preview-frame.tsx` 是 React 层，管理生命周期、文件预处理和 iframe 渲染。

`lib/sandpack-config.ts` 已删除。Sandpack 相关逻辑（`normalizeExports`、`buildSandpackConfig`）不再使用；export 标准化现由 preview-frame.tsx 在挂载前执行。

## 设计思路

选用 WebContainer 而非 Sandpack 的核心原因：支持真实 Node.js 运行时，允许安装任意 npm 包（包括 Phaser.js 等游戏引擎），且 Vite HMR 使得增量模块填充（复杂路径）无需重新启动整个运行时。代价是启动延迟（~15–20s）和严格的跨域隔离要求（COOP/COEP headers）。

supabase auth mock 保留有状态设计（`_authState.session`），确保 `signInWithPassword` → `getSession` 的 session 读取能正常工作，否则登录页会陷入死循环。

## COOP/COEP 要求

WebContainer 依赖 `SharedArrayBuffer`，浏览器要求页面处于 `crossOriginIsolated` 状态，必须同时满足：

| Header | 值 | 说明 |
|--------|---|------|
| `Cross-Origin-Embedder-Policy` | `credentialless` | 允许 iframe 加载第三方资源 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 防止跨域 opener 访问 |

这两个 header 仅在 `/project/:path*` 路由上设置（在 `next.config.mjs` 中配置），主页和 API 路由不受影响。

**关键约束**：导航到 `/project/:id` 必须使用 `window.location.href`（硬导航），不能使用 Next.js 的 `router.push()`（客户端路由不会重新应用响应头，导致 `crossOriginIsolated` 为 false，WebContainer 启动失败）。

```typescript
// 正确：硬导航，触发服务器响应头
window.location.href = `/project/${id}`;

// 错误：客户端路由，不重新应用 COOP/COEP
router.push(`/project/${id}`);
```

## 代码逻辑

### 启动与挂载流程

```
preview-frame.tsx
    │
    ▼ status: "booting"
getContainer()                    // lib/container-runtime.ts
  → 若容器已存在则复用（单例）
  → 否则 WebContainer.boot()
    │
    ▼ status: "installing"
mountAndStart(files, deps, onReady, onError)
  → container.mount(fileTree)     // 写入所有生成文件
  → container.spawn("npm", ["install"])
    │
    ▼ status: "starting"
  → container.spawn("npx", ["vite", "--port", "3001"])
  → 监听 server-ready 事件
    │
    ▼ status: "ready"
  → iframe.src = "http://localhost:3001"
```

### 增量更新（`mountIncremental`）

模块填充阶段（复杂路径）每完成一个模块，调用：

```typescript
mountIncremental(newFiles: Record<string, string>): Promise<void>
// 仅写入变更文件（container.fs.writeFile）
// Vite HMR 检测到文件变化，自动热更新 iframe
// 不重启 Node.js 进程，不重新 npm install
```

骨架挂载后（`skeleton_ready`），后续每个 `module_complete` 事件触发一次 `mountIncremental`，用户实时看到功能逐步出现。

### preview-frame.tsx 文件预处理

在调用 `mountAndStart` 之前，preview-frame.tsx 对生成文件执行以下预处理：

```
1. deduplicateImports(files)
   → 移除同一文件内重复的 import 声明（防止 Babel SyntaxError，ADR 0022）

2. stub 注入：findMissingLocalImportsWithNames(files)
   → AI 引用但未生成的文件 → 注入 Proxy stub
     export const X = () => null;
     export default new Proxy({}, { get(_, key) { ... return () => null } })

3. 注入 /supabaseClient.js（buildSupabaseClientCode(projectId)）
   → 含 auth mock + x-app-id header（ADR 0007）
   → AI 生成代码通过 import { supabase } from '/supabaseClient.js' 访问
```

### supabase auth mock

```typescript
function buildSupabaseClientCode(projectId: string): string
// 注入 x-app-id header（ADR 0007：Supabase RLS 要求）
// auth mock 实现：
//   signInWithPassword({ email }) → _authState.session = { access_token: "demo" }
//   signUp               → session: null
//   signOut              → _authState.session = null
//   getSession           → { session: _authState.session }
//   onAuthStateChange    → 返回 mock subscription 对象
```

`/supabaseClient.js` 始终注入，AI 生成代码可通过 `import { supabase } from '/supabaseClient.js'` 访问。真实 Supabase CRUD（`supabase.from(...).select()` 等数据操作）走真实 Supabase 连接，不受 mock 影响。

### 状态转换

| 状态 | 含义 | UI 表现 |
|------|------|---------|
| `booting` | WebContainer WASM 初始化 | 加载动画 |
| `installing` | npm install 依赖 | 进度提示 |
| `starting` | Vite dev server 启动 | 进度提示 |
| `ready` | iframe 可用 | 显示预览 |
| `error` | 任一阶段失败 | 错误信息 + 重试按钮 |

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| 复杂路径骨架挂载 | `mountAndStart` 全量启动，骨架文件先行可见 |
| 复杂路径模块增量填充 | `mountIncremental` 逐模块写入，Vite HMR 热更新 |
| AI 引用了未生成的文件 | Proxy stub 注入，防 "Element type is invalid: got undefined" |
| AI 代码调用 `supabase.auth.signInWithPassword` | auth mock 返回成功，防登录页死循环 |
| 重复 import 声明 | `deduplicateImports` 预处理，防 Babel SyntaxError |
| 游戏引擎场景（game-engine） | WebContainer 支持真实 npm 安装 Phaser.js |
| 导航到 /project/:id | 强制 `window.location.href` 硬导航，确保 COOP/COEP 生效 |

## 未覆盖场景 / 已知限制

- **启动延迟**：首次 WebContainer 启动约 15–20s（WASM 初始化 + npm install）。后续增量更新无此延迟。
- **SharedArrayBuffer 浏览器要求**：Safari 15.2+ 支持，旧版浏览器不兼容；Firefox 需手动启用。
- **跨域 iframe**：Playwright E2E 测试无法读取 iframe 内部 DOM（跨域隔离限制），预览功能测试需通过截图或视觉验证。
- **非 React 框架**：当前 Vite 配置固定为 React 模板，Vue/Svelte 不支持。
- **真实 Supabase CRUD**：auth mock 仅拦截认证方法；数据操作走真实 Supabase 连接，受 RLS 和网络限制影响。
- **容器单例**：同一标签页内多个项目切换时复用同一个 WebContainer 实例，切换项目需重新 mount 文件（不重启 WASM）。

## 相关文件

- `lib/container-runtime.ts` — WebContainer 启动、挂载、增量更新（`getContainer`、`mountAndStart`、`mountIncremental`）
- `components/preview/preview-frame.tsx` — React 层：状态管理、文件预处理、iframe 渲染（已完全重写）
- `lib/extract-code.ts` — `findMissingLocalImportsWithNames`（供 stub 注入使用）
- `docs/adr/0007-supabase-rls-x-app-id.md` — RLS x-app-id header ADR
- `docs/adr/0022-deduplicate-imports.md` — import 去重 ADR
- `next.config.mjs` — COOP/COEP 响应头配置（`/project/:path*` 路由）
