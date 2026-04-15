# ADR 0020 — iterationSnapshot 缺少当前轮次

**日期**: 2026-04-15  
**背景**: Claude 自发现（-self）；本地验证版本恢复功能时发现

## 问题描述

恢复到 V2 时，`iterationSnapshot` 只包含 V1 的 round，缺少 V2 自己的 round。

预期行为：V2 的快照应包含 V1 + V2 两轮 round，恢复后 PM/Architect 基于 V2 时的完整上下文继续迭代。

## 根因

版本创建（`POST /api/versions`）和 `appendRound()` 的执行顺序错误：

```
旧逻辑：
1. 保存版本 → iterationSnapshot = iterationContext（此时还没追加当前 round）
2. appendRound() → 追加当前 round 到 iterationContext
3. PATCH /api/projects → 持久化更新后的 context

结果：V2 的 snapshot 存的是追加 V2 round 之前的状态 = 只有 V1
```

涉及 `chat-area.tsx` 中 **3 处**版本创建路径：
- 直接路径（bug_fix / style_change）：2 个创建点共用 1 个 appendRound 块
- 全流程多文件路径：1 个创建点 + 1 个 appendRound 块
- 全流程旧版单文件路径：1 个创建点 + 共用上面的 appendRound 块

## 修复

**chat-area.tsx**：3 处路径全部改为 **先计算 round + appendRound，再保存版本**：

```typescript
// 直接路径 — 先算 context
const directRound: IterationRound = { userPrompt: prompt, intent, pmSummary: null, timestamp: roundTimestamp };
const directUpdatedCtx = appendRound(iterationContext, directRound);

// 再存版本，snapshot 用已包含当前 round 的 context
const res = await fetchAPI("/api/versions", {
  method: "POST",
  body: JSON.stringify({
    ...otherFields,
    iterationSnapshot: directUpdatedCtx,  // 包含当前 round
  }),
});

// 最后同步状态
onIterationContextChange?.(directUpdatedCtx);
```

全流程多文件路径和旧版单文件路径同理。

## 风险分析

| 场景 | 风险 | 防御 |
|------|------|------|
| appendRound 提前但版本保存失败 | context 已更新但版本未创建 | 与旧逻辑风险相同（fire-and-forget PATCH 本来就可能与版本不同步） |
| 多文件路径 continue 跳过旧版路径 | 全流程多文件和旧版单文件各自独立计算 round | 两条路径互斥（continue），不会重复追加 |

## 预防措施

- iterationSnapshot 的语义是"这个版本生成完成时的完整上下文"，包含当前轮次
- 任何新增的版本创建路径都必须在保存前先 appendRound
