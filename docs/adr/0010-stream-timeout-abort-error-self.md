# ADR 0010 — Stream 超时识别与 AbortError 区分

**日期**: 2026-04-13  
**背景**: Claude 自发现（-self）；DeepSeek 生成大量文件时超过 90s 超时，AbortError 被错误归类为 `unknown` 而非 `generation_timeout`

## 问题描述

1. `STREAM_TIMEOUT_MS = 90_000` 对 DeepSeek 大文件生成不够用
2. 超时触发的 `AbortError` 在 `inferErrorCode` 中无法被识别为超时（"the operation was aborted" 不包含 "timeout"）
3. 前端显示"生成失败"而非"生成超时"，用户无法理解原因

## 根因

- AbortError 可能由多种原因触发（内部超时、用户取消、Vercel 强杀、网络中断），不能简单用 message 匹配
- 90s 超时对 DeepSeek 跨太平洋请求 + 大文件生成不足

## 修复

1. **超时提升**：`STREAM_TIMEOUT_MS` 从 90s 提升到 150s
2. **精确识别**：在每个 Provider 的 catch 块中，用 `abortController.signal.aborted` 判断是否为我们自己的 timer 触发，是则抛 `"stream timeout"`（包含 "timeout" 关键词，能被 `inferErrorCode` 识别）
3. 其他 AbortError（用户取消等）走原有错误路径

## 预防措施

- Provider 层明确标记超时原因，不依赖 error message 字符串匹配
