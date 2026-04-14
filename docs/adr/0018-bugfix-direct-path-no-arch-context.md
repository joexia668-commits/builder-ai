# ADR 0018 — bug_fix 直接路径缺少架构感知，导致 Engineer 过度修复

**日期**: 2026-04-14
**背景**: 用户手工测试发现；粘贴错误日志触发 bug_fix 后，Engineer 重写了整个应用，丢失大量功能并添加了未请求的登录功能

---

## 问题描述

用户操作流程：
1. 计算器项目经过多轮 bug_fix 后，feature_add 生成出现 "Element type is invalid" 错误
2. 用户粘贴错误日志到对话框，输入"修复"
3. intent 分类为 `bug_fix` → 走直接路径（跳过 PM + Architect）
4. Engineer 看到错误日志 + 现有代码 → 判断"问题太多" → 重写整个 app
5. 新版本界面完全不同，功能丢失，莫名添加了登录功能

---

## 根因

`bug_fix` 直接路径只给 Engineer 提供：
- 用户 prompt（错误日志）
- 现有代码文件（via `buildDirectMultiFileEngineerContext`）

**缺少：**
- 架构上下文（app 是什么、有哪些功能）
- 改动范围硬约束（只改 triage 选中的文件）
- 设计意图（为什么这样设计、不能改什么）

对比 feature_add 路径有 `deriveArchFromFiles` + scaffold 文件范围约束 + merge 兜底，bug_fix 路径的保护层最薄。

---

## 影响范围

当用户报告的错误涉及多个文件（如 import/export 不匹配），Engineer 容易判定"整体结构有问题"而全面重写，导致：
- UI 完全改变
- 已有功能丢失
- 添加未请求的功能（如登录页面）

---

## 修复方案（待实施）

**方向 A — 给 bug_fix 加架构上下文：**
在 `buildDirectMultiFileEngineerContext` 中调用 `deriveArchFromFiles(currentFiles)`，在 prompt 开头注入架构摘要，让 Engineer 知道"这是一个计算器 app，有暗黑模式和历史记录功能"。

**方向 B — 改动范围硬约束：**
triage 阶段已选出需要修改的文件（≤3 个）。在 prompt 中明确禁止修改 triage 未选中的文件，即使 Engineer 输出了额外文件也丢弃。

**推荐：A + B 同时实施。**

---

## 临时缓解

用户遇到此问题时，可通过版本时间线回退到修复前的版本。
