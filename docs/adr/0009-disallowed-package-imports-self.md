# ADR 0009 — 禁止包引用检测与自动修复

**日期**: 2026-04-13  
**背景**: Claude 自发现（-self）；LLM 生成的代码引用了 Sandpack 不支持的外部包（如 react-router-dom），导致 `DependencyNotFoundError`

## 问题描述

Engineer 提示词明确禁止使用 `react-router-dom`、`recharts` 等包，但 Architect 提示词没有同等约束。Architect 设计了路由架构，Engineer 忠实执行，导致生成的代码引用了不可用的包。

## 根因

Architect 提示词缺少路由库禁令和替代方案说明。

## 修复

1. **Architect 提示词加强**：明确禁止路由库，给出 `useState` 视图切换替代方案
2. **生成后校验**：`checkDisallowedImports(files)` 扫描所有文件的外部 import，与允许列表（react/react-dom/lucide-react）对比
3. **自动修复**：检测到违规（≤3 文件）时，用 `buildDisallowedImportsEngineerPrompt` 发起修复请求，prompt 包含常见替换方案

## 预防措施

- Architect 从设计源头杜绝路由架构
- `checkDisallowedImports` 兜底，检测后自动重试
