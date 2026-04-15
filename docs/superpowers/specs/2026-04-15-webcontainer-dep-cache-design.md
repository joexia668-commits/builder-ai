# WebContainer 依赖缓存 — 设计文档

**日期**: 2026-04-15
**状态**: Approved

## 问题

当前每次刷新页面、重新部署、或在项目间切换时，WebContainer 都会执行完整的 `teardownContainer()` → `getContainer()` → `npm install` → `npm run dev` 流程，耗时 10-15 秒。大部分项目共享相同的基础依赖（react、react-dom、lucide-react），重复安装浪费时间。

## 方案

**复用 WebContainer 实例 + 依赖指纹跳过 install**

核心思路：不再每次切换项目都 teardown WebContainer，而是保留实例，用依赖指纹判断是否需要重新 install。

### 场景分析

| 场景 | 当前行为 | 优化后 |
|------|---------|--------|
| 同一项目页面刷新 | teardown → boot → install → dev (~15s) | boot → 指纹比对 → 跳过 install → dev (~3s) |
| 项目列表点击进入项目 | teardown → boot → install → dev (~15s) | 复用容器 → 指纹比对 → 跳过/增量 install (~2-5s) |
| 不同项目之间切换 | teardown → boot → install → dev (~15s) | 复用容器 → 指纹比对 → 按需 install (~2-8s) |

注：页面刷新时 WebContainer 实例会被 GC，必须重新 boot，但模块级缓存可以避免重复 install。

## 详细设计

### 1. `container-runtime.ts` 改动

#### 新增状态

```typescript
let lastDepsHash: string | null = null;   // 上次成功 install 的依赖指纹
let devServerRunning = false;             // Vite dev server 是否在运行
```

#### 新增 `computeDepsHash(deps: Record<string, string>): string`

将 dependencies 对象 key 排序后 JSON.stringify，做简单字符串比对。轻量级，不需要 crypto — 仅用于内存比对。

#### 新增 `remountAndRestart(files, deps, onServerReady, onError)`

核心新函数，替代 `mountAndStart` 成为 preview-frame 的主入口。

流程：
1. `getContainer()` — 复用已有实例或 boot 新实例
2. 计算 `newHash = computeDepsHash(deps)`
3. 对比 `lastDepsHash`：
   - **相同**：只 mount 源文件（不写 `package.json`），不跑 `npm install`
   - **不同**：mount 全部文件（含新 `package.json`），跑 `npm install`，成功后更新 `lastDepsHash = newHash`
4. 如果 `devServerRunning` 为 true — Vite HMR 自动 pick up 变化，直接调 `onServerReady`（使用已缓存的 server URL）
5. 如果 `devServerRunning` 为 false — 启动 `npm run dev`，监听 `server-ready`

#### 修改 `teardownContainer()`

重置 `lastDepsHash = null` 和 `devServerRunning = false`。

#### 保留 `mountAndStart` 和 `mountIncremental`

不删除，避免破坏现有调用链。`mountAndStart` 作为 fallback。

### 2. `preview-frame.tsx` 改动

#### 修改 `startContainer` callback

- 不再调用 `teardownContainer()` — 去掉 teardown
- 改为调用新的 `remountAndRestart(prepared, deps, onServerReady, onError)`
- status 流变化：
  - 跳过 install 时：`booting` → `starting` → `ready`
  - 需要 install 时：`booting` → `installing` → `starting` → `ready`
- `remountAndRestart` 通过回调通知是否跳过了 install，以便 UI 正确设置 status

#### 修改 unmount cleanup

- 去掉组件卸载时的 `teardownContainer()` — 组件卸载不等于要销毁容器
- 把 teardown 移到 `workspace.tsx` 的 cleanup effect 中（离开项目页面回到首页时才 teardown）

#### `projectId` 变化时的 effect

- 保持 `[projectId]` 依赖不变
- `startContainer` 内部逻辑变了 — 会复用容器，只按需 install

#### incremental mount effect

不变 — 文件变化时仍然走 `mountIncremental`，不触发 install。

#### status labels

不需要改 — 现有 label 已经合理，跳过 install 时用户只会短暂看到 "启动预览环境..."。

### 3. `workspace.tsx` 改动

在 workspace 的 cleanup effect 中调用 `teardownContainer()`，确保离开项目页面回到首页时正确清理。

## 边界情况

### Vite dev server 复用

Vite 已运行在 3111 端口，切换项目后 mount 新文件，Vite HMR 自动 reload。不需要 kill 旧进程。如果文件结构差异大（entry file 变化），需要更新 `main.jsx` 的 import 路径并重新 mount。

### Vite 进程崩溃恢复

`devServerRunning` 在 `devProcess.exit` 回调中设为 false。下次 `remountAndRestart` 发现 `devServerRunning === false` 时自动重启 dev server，不需要重新 install。

### WebContainer boot 失败

`getContainer()` 失败 → 重置 `lastDepsHash`，走全量 fallback（等同当前行为）。

### npm install 失败

不更新 `lastDepsHash` → 下次仍会尝试 install。错误传递给 `onError`，UI 显示重试按钮（现有行为不变）。

### 页面刷新

WebContainer 实例丢失。模块级变量 `lastDepsHash` 也会重置。必须重新 boot + install — 浏览器限制无法避免。但 WebContainer 内部 npm cache 在同一 origin 下可能部分保留，install 比首次快。

## 不改动的部分

- `mountIncremental()` 不变
- SSE 流、代码生成流程不变
- 版本恢复不变
- 导出/部署不变
- 现有测试不受影响

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `lib/container-runtime.ts` | 新增 `lastDepsHash`、`devServerRunning`、`computeDepsHash()`、`remountAndRestart()`；修改 `teardownContainer()` |
| `components/preview/preview-frame.tsx` | 修改 `startContainer` 不再 teardown，改用 `remountAndRestart`；去掉 unmount teardown |
| `components/workspace/workspace.tsx` | 新增 cleanup effect 调用 `teardownContainer()` |
