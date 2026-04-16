# ADR 0028: 项目页面必须用 hard navigation（window.location.href）以启用 COOP/COEP

**发现方**: Claude（实现过程中自发现）  
**分支**: feat/modular-pipeline  
**日期**: 2026-04-16

---

## 问题描述

WebContainer 要求 `window.crossOriginIsolated === true`，而这需要浏览器收到正确的跨域隔离响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

`next.config.mjs` 已为 `/project/:path*` 配置了这两个 header。但在 E2E 测试和实际使用中，进入项目页后 `window.crossOriginIsolated` 一直为 `false`，WebContainer 报错 `SharedArrayBuffer is not defined`，preview-frame 显示 "预览环境不可用"。

## 根因

Next.js 的 `router.push('/project/:id')` 是**客户端路由跳转（SPA navigation）**：

- 浏览器不发出新的 HTTP 请求
- 服务端响应头（COOP/COEP）不会被重新评估
- 当前 browsing context 的 `crossOriginIsolated` 状态维持上一页的值（通常为 `false`）

因此，从 `/`（主页，无 COOP/COEP）通过 `router.push` 跳转到 `/project/:id` 后，`crossOriginIsolated` 仍为 `false`。

只有**硬导航（full page load）** 才会让浏览器重新走 HTTP 请求 → 接收新响应头 → 建立新的 browsing context isolation 状态。

## 修复

将所有跳转到 `/project/:id` 的 `router.push` 改为 `window.location.href`：

```diff
// components/home/project-list.tsx
- router.push(`/project/${project.id}`);
+ window.location.href = `/project/${project.id}`;

// components/sidebar/conversation-sidebar.tsx
- router.push(`/project/${project.id}`);
+ window.location.href = `/project/${project.id}`;
```

`useRouter` import 在 `project-list.tsx` 中已完全移除（不再有其他用途）。

## 验证

E2E 测试（`e2e/check-iso.spec.ts`，临时测试文件）确认 hard navigation 后 `crossOriginIsolated: true`。

## 预防措施

- 任何新增的"跳转到 /project/:id"入口必须用 `window.location.href`，不得用 `router.push`
- 代码注释中已标注原因：`// Hard navigation so COOP/COEP headers are applied (required by WebContainer)`
- 若未来迁移到 Next.js 15+ App Router 的 `<Link>` 组件，需确认 COOP/COEP 是否在 client navigation 时生效（截至 Next.js 14 不生效）
