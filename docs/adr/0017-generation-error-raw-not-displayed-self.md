# ADR 0017 — generationError.raw 具体错误详情未在 UI 展示

**日期**: 2026-04-14
**背景**: Claude 实现过程中自发现（-self）；用户看到"部分模块未生成"警告但无法知道具体缺了哪些文件

---

## 问题描述

当 `findMissingLocalImports` 检测到缺失文件时，设置了 generationError：
```typescript
updateSession(project.id, {
  generationError: {
    code: "missing_imports",
    raw: `AI 生成的代码引用了未创建的文件：/components/xxx.js、/hooks/yyy.js`,
  },
});
```

但 UI 只显示 `ERROR_DISPLAY[code]` 中的固定文案：
```
⚠️ 部分模块未生成
AI 生成的代码引用了未创建的文件，预览已用占位符替代，建议重新生成
```

`raw` 字段中的具体文件路径没有展示，用户和开发者都无法从 UI 判断缺失了哪些文件。

---

## 根因

`chat-area.tsx` 的错误渲染区域（约第 1288 行）只使用了 `display.title` 和 `display.description`，没有渲染 `generationError.raw`。

---

## 修复

在错误描述下方增加 `raw` 字段的展示（仅当 raw 存在且与 description 不同时显示）：

```tsx
{generationError.raw && generationError.raw !== display.description && (
  <p className="text-xs text-red-400 mt-1 break-all">{generationError.raw}</p>
)}
```

修复后用户看到的错误提示：
```
⚠️ 部分模块未生成
AI 生成的代码引用了未创建的文件，预览已用占位符替代，建议重新生成
AI 生成的代码引用了未创建的文件：/components/xxx.js、/hooks/yyy.js  ← 具体路径
```

diff 涉及文件：
- `components/workspace/chat-area.tsx`：错误渲染区域增加 raw 展示

---

## 预防措施

- 所有 `updateSession` 设置 `generationError` 时，`raw` 字段应包含可操作的诊断信息（具体文件路径、错误码等）
- UI 现在会自动展示这些信息，无需开发者打开 DevTools
