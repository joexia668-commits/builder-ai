# ADR 0011 — partialMultiFile 截断时救回已完整文件

**日期**: 2026-04-13  
**背景**: Claude 自发现（-self）；DeepSeek bug_fix 路径生成 19KB 输出，最后一个文件被截断，导致整批文件被丢弃

## 问题描述

`extractAnyMultiFileCode` 中，任何一个文件的 `isDelimitersBalanced` 检查失败就返回 null，导致前面已完整的文件也被丢弃。

## 根因

原设计假设所有文件要么全部完整要么全部失败，没有考虑流式截断只影响最后一个文件的场景。

## 修复

修改 `extractAnyMultiFileCodeByMarker`：当最后一个文件 `isDelimitersBalanced` 失败时，检查是否有已完整的文件。如果有，丢弃最后一个截断文件，返回已完整的部分。

```diff
- if (!isDelimitersBalanced(code)) return null;
+ if (!isDelimitersBalanced(code)) {
+   if (i === paths.length - 1 && Object.keys(result).length > 0) break;
+   return null;
+ }
```

同时新增 Markdown fenced block fallback 解析器：DeepSeek 有时输出 ` ```jsx\n// /App.js\n... ``` ` 而非 `// === FILE: ===` 格式，fallback 也能解析。

## 预防措施

- 截断只丢弃受影响的最后一个文件
- 强化 `buildDirectMultiFileEngineerContext` 格式提示
