# ADR 0016 — 后处理阶段误判旧文件为"缺失"导致文件内容错乱

**日期**: 2026-04-14
**背景**: Claude 实现过程中自发现（-self）；用户在验证 feature_add 迭代功能时，第三轮生成后 App.js 内容变成了 ThemeToggle 组件代码

---

## 问题描述

用户操作流程：
1. 生成计算器应用（new_project）
2. 加暗黑模式（feature_add）→ 正常
3. 新增语言选项（feature_add）→ App.js 内容被替换为 ThemeToggle 代码，`export default App;` 但 App 未声明

Code Editor 中 App.js 只有：
```javascript
import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
export function ThemeToggle() { ... }
export default App;  // App 未声明 → SyntaxError
```

---

## 根因

`chat-area.tsx` 中 Engineer 多文件生成完成后的后处理步骤（`findMissingLocalImportsWithNames`、`checkImportExportConsistency`）**只检查 `allCompletedFiles`（本轮新生成的文件），不包含 `currentFiles`（旧文件）**。

第三轮 Architect scaffold 只列了 5 个新文件（不含 App.js），Engineer 正确生成了这 5 个文件。但其中 `SettingsPanel.js` import 了 `/components/ThemeToggle.js`，而 ThemeToggle.js 是旧文件（在 `currentFiles` 里），不在 `allCompletedFiles` 里。

后处理流程：
```
findMissingLocalImportsWithNames(allCompletedFiles)
  → SettingsPanel.js import ThemeToggle.js
  → ThemeToggle.js 不在 allCompletedFiles
  → 误判为"缺失" → 触发补全请求
  → AI 补全时生成了错误的内容 → App.js 被污染
```

---

## 修复

在后处理步骤之前，先将 `currentFiles` 合入 `allCompletedFiles`，让 `findMissingLocalImports` 和 `checkImportExportConsistency` 看到完整的文件集合（旧 + 新）：

```typescript
// 后处理前合入旧文件
if (hasExistingCode) {
  const preserved = { ...currentFiles };
  for (const [p, code] of Object.entries(allCompletedFiles)) {
    preserved[p] = code;  // 新文件覆盖旧文件
  }
  Object.keys(allCompletedFiles).forEach((k) => delete allCompletedFiles[k]);
  Object.assign(allCompletedFiles, preserved);
}
```

diff 涉及文件：
- `components/workspace/chat-area.tsx`：后处理前合入 currentFiles

---

## 为什么之前没暴露

之前的代码没有 merge 逻辑 — `onFilesGenerated(allCompletedFiles)` 只传新生成的文件，旧文件直接丢失。后处理阶段的误判虽然存在，但因为最终结果只有新文件，旧文件引用本来就找不到，问题被更大的 bug（文件丢失）掩盖了。

引入 merge 后，旧文件被保留，但后处理仍然只看新文件 → 误判触发补全 → 补全结果污染了 merge 后的文件集。

---

## 预防措施

- 后处理步骤（missing imports、import/export consistency、disallowed imports）现在看到的是完整文件集
- 添加了 `console.warn("[pipeline]")` 级别日志，记录 allCompletedFiles、currentFiles 的 key 列表，方便线上排查
