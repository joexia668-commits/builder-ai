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

## 修复方案

**方向 A — 给 bug_fix 加架构上下文：** ✅ 已实施
在 `buildDirectMultiFileEngineerContext` 中注入 `deriveArchFromFiles(currentFiles)` 的架构摘要（全量文件），加上"严禁重写/严禁删除 import"的约束指令。代码只传 triage 选中的文件，架构摘要覆盖全量文件。

**方向 B — 改动范围硬约束：** ⏭️ 暂不实施
经分析，实际 case 中 Engineer 只输出了 triage 选中的文件，未输出额外文件。问题在于缺少架构感知而非范围失控。后续观察是否需要。

---

## 临时缓解

用户遇到此问题时，可通过版本时间线回退到修复前的版本。
