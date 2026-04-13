# ADR 0008 — Import/Export 一致性校验

**日期**: 2026-04-13  
**背景**: Claude 自发现（-self）；LLM 生成多文件时，named import 与 named export、default import 与 default export 经常不匹配，Sandpack 运行时报错

## 问题描述

Engineer 生成多个文件时，文件 A 用 `import { Foo } from '/B.js'`，但文件 B 只有 `export default function Foo`（没有 named export）。反过来也会出现 default import 但目标文件没有 default export 的情况。

## 根因

LLM 生成多文件时各文件独立生成，对其他文件的 export 形式没有记忆，导致 import/export 不匹配。

## 修复

在 `lib/extract-code.ts` 新增三个函数：
- `extractFileExports(code)` — regex 提取所有 named export 和 default export
- `extractFileImports(code)` — regex 提取所有本地路径的 named/default import
- `checkImportExportConsistency(files)` — 交叉检查所有文件对

在 `chat-area.tsx` Engineer 生成完成后、送入 Sandpack 前调用。若检测到不匹配（≤3 文件），用 `buildMismatchedFilesEngineerPrompt` 发起一轮定向修复请求，LLM 重新生成涉及的文件。

## 预防措施

- 生成后自动校验，一轮重试修复
- 超过 3 个文件的不匹配跳过，交给 Sandpack 运行时处理
