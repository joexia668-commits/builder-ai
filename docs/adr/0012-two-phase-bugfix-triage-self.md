# ADR 0012 — 两阶段 Bug Fix Triage

**日期**: 2026-04-14  
**背景**: Claude 自发现（-self）；DeepSeek 在 bug_fix 路径忽略"只输出修改的文件"指令，把 27 个文件全部重新生成（19KB+），超时截断导致 parse_failed

## 问题描述

`buildDirectMultiFileEngineerContext` 把所有文件完整代码传给 LLM，依赖提示词约束它"只输出修改的文件"。DeepSeek 忽略此约束，重新生成全部文件，导致：
1. 输出量过大（19KB+）→ 超过 150s 超时
2. 最后一个文件截断 → `parse_failed`

## 根因

LLM 看到所有文件代码后倾向于全部重写，提示词约束不够可靠。

## 修复

新增两阶段调用：
1. **Phase 1 Triage**：只传文件路径列表（不传代码），让 LLM 返回需要修改的文件路径 JSON 数组。`triageMode: true` + `maxOutputTokens: 512`
2. **Phase 2 Fix**：只传 triage 识别出的文件（≤3 个）给 Engineer

Fallback：triage 返回空/超过 3 个文件/解析失败时，回退到全量文件行为。

实测：27 个文件 → triage 识别出 1 个 → 只传 1 个文件 → 几秒完成

## 预防措施

- 从根本上控制 LLM 输入量，不依赖提示词约束输出量
- Fallback 保证最坏情况不比现在差
