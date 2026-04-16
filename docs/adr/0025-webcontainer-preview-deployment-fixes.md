# ADR 0025: WebContainer 预览环境部署修复

## 问题描述

从 Sandpack 迁移到 WebContainer 后（feat/modular-pipeline 分支），预览功能在 Vercel 部署环境下完全无法工作，涉及多个层级的兼容性问题。

## 根因与修复

### 1. SharedArrayBuffer 不可用（COOP/COEP 缺失）

**现象**：`DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated`

**根因**：WebContainer 依赖 `SharedArrayBuffer`，需要页面启用跨域隔离（`crossOriginIsolated === true`）。迁移时未配置 COOP/COEP 响应头。

**修复**：在 `next.config.mjs` 中为 `/project/:path*` 路径添加：
- `Cross-Origin-Embedder-Policy: credentialless`（兼容跨域资源，Chrome 96+/Firefox 119+/Safari 17+）
- `Cross-Origin-Opener-Policy: same-origin`

**注意**：`require-corp` 会阻断所有未带 `Cross-Origin-Resource-Policy` 头的跨域资源，`credentialless` 更宽松。Headers 只作用于 workspace 页面，不影响登录、OAuth 等。

### 2. Tailwind CDN 被 COEP 拦截

**现象**：`net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`

**根因**：`cdn.tailwindcss.com` 返回 302 重定向且不带 CORS 头，被 COEP 策略拦截。

**修复**：替换为 jsDelivr 托管的 `@tailwindcss/browser@4`（jsDelivr 所有响应带 `Access-Control-Allow-Origin: *`）。

**副作用**：Tailwind 版本从 v3 升级到 v4，部分 utility class 可能有差异，但常用类名兼容。

### 3. Vite 无法解析 .js 文件中的 JSX

**现象**：`[plugin:vite:import-analysis] Failed to parse source for import analysis because the content contains invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension.`

**根因**：AI 生成的文件使用 `.js` 扩展名但包含 JSX 语法。Vite 的 `import-analysis` 插件用 `es-module-lexer` 解析源码，不支持 JSX。`esbuild.loader` 和 `@vitejs/plugin-react` 的 `include` 配置均无法在 `import-analysis` 之前生效。

**修复**：在挂载到 WebContainer 之前，`renameJsToJsx()` 将所有 `.js` 文件重命名为 `.jsx`，同时重写 import 路径中的 `.js` 为 `.jsx`。

### 4. 绝对路径 import 无法解析

**现象**：`Failed to resolve import "/modules/order-management/index.js" from "src/views/OrderManagementView.jsx". Does the file exist?`

**根因**：AI 生成的代码使用绝对路径 import（如 `from "/modules/..."`、`from "/components/..."`），但 `mountAndStart` 将文件挂载到 `/src/` 子目录下。Vite 从项目根解析绝对路径，找不到文件。

**修复**：不再将文件嵌套到 `/src/`，直接挂载到项目根目录。`main.jsx` 和 `index.html` 引用也相应调整。

### 5. npm 依赖未自动安装

**现象**：`Failed to resolve import "recharts" from "components/Charts/CategoryDistributionChart.jsx". Does the file exist?`

**根因**：AI 生成的代码引用了 `recharts` 等第三方包，但 `package.json` 只包含基础依赖（react, react-dom, lucide-react）和 scaffold 指定的依赖。当 scaffold 未列出某个包时，该包不会被安装。

**修复**：`detectNpmImports()` 扫描所有文件中的 npm 包引用（排除相对/绝对路径和已知内置包），自动添加到 `package.json` 的 dependencies。scaffold 指定的版本号优先，未指定的用 `latest`。

## 预防措施

- `preview-frame.tsx` 添加了 `crossOriginIsolated` 前置检查，若为 false 直接显示明确错误提示
- WebContainer 的 npm install 和 Vite dev server 输出被捕获并 pipe 到 console，方便调试
- `docs/architecture.md` 已修正"Vercel Hobby 不支持 COOP/COEP"的错误说明

## 已知限制

- `credentialless` COEP 需要 Chrome 96+、Firefox 119+、Safari 17+，旧浏览器不支持
- Tailwind v4 Browser CDN 与 AI 生成的 v3 class name 可能有少量不兼容
- `detectNpmImports` 使用 `latest` 版本，极端情况下可能引入 breaking change
- 本地代理（Clash/V2Ray）可能干扰 WebContainer 与 StackBlitz CDN 的通信
