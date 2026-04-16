# ADR 0027: 相对路径 import 未被 stub 机制检测 (self)

## 问题描述

AI 生成的代码使用相对路径 import（如 `import { HomeView } from './views/HomeView.jsx'`），但 `findMissingLocalImportsWithNames` 和 `findMissingLocalImports` 只检测绝对路径 import（以 `/` 开头），导致缺失文件无法被 stub，Vite 报错 `Failed to resolve import`。

**现象**：
```
[vite] Pre-transform error: Failed to resolve import "./views/HomeView.jsx" from "App.jsx". Does the file exist?
```

## 根因

1. **Regex 只匹配 `/` 开头**：`/from\s+['"](\/.+?)['"]/g` — `\.\/` 和 `\.\.\/` 开头的路径被完全忽略
2. **遍历 `Object.values(files)` 丢失文件路径上下文**：不知道 import 来自哪个文件，无法将 `./views/X` 解析为 `/views/X`

## 修复

- 新增 `resolveImportPath(importPath, fromFile)` 辅助函数，将相对路径解析为绝对路径
- Regex 扩展为 `/(\.[./][^'"]*|\/[^'"]+)/`，同时匹配 `./`、`../`、`/` 开头的路径
- 两个函数均改为遍历 `Object.entries(files)`，利用 file key 作为 resolve 基准

## 预防措施

- 新增 6 个测试用例覆盖：`./path`、`../path`、嵌套目录相对解析、已存在路径不误报
