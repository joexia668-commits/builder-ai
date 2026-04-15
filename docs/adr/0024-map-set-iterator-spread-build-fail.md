# 0024 Map/Set 迭代器展开导致 Vercel 构建失败

## 问题描述

Vercel 生产构建失败，报错：

```
./lib/sandpack-config.ts:162:27
Type error: Type 'MapIterator<[string, ...]>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.
```

`deduplicateImports()` 函数中使用 `[...moduleMap.entries()]` 和 `[...e.named]` 展开 Map/Set 迭代器，在 TypeScript 编译目标低于 ES2015 且未开启 `downlevelIteration` 时会报类型错误。本地 `next dev` 不会触发此错误，仅在 `next build`（Vercel 生产构建）时暴露。

## 根因

`deduplicateImports()`（0023 ADR 引入的去重逻辑）使用了两处迭代器展开语法：

1. `[...moduleMap.entries()]` — 展开 `Map.entries()` 返回的 `MapIterator`
2. `[...e.named]` — 展开 `Set<string>`

这两种写法依赖 `Symbol.iterator`，需要 `--downlevelIteration` 编译选项或 `--target >= es2015`。项目 tsconfig 未开启 `downlevelIteration`，导致严格类型检查失败。

## 修复 diff

```diff
- const entry = [...moduleMap.entries()].find(
+ const entry = Array.from(moduleMap.entries()).find(

- const namedPart = e.named.size > 0 ? `{ ${[...e.named].join(", ")} }` : "";
+ const namedPart = e.named.size > 0 ? `{ ${Array.from(e.named).join(", ")} }` : "";
```

## 预防措施

- 避免对 Map/Set 使用 `[...iterator]` 展开语法，统一使用 `Array.from()`
- 提交前运行 `npx tsc --noEmit` 验证类型检查通过（本地 dev server 不会暴露此类错误）
