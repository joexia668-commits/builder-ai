# bugfix 直接路径架构感知注入

**日期**: 2026-04-14
**关联**: ADR 0018 — bug_fix 直接路径缺少架构感知，导致 Engineer 过度修复

---

## 问题

bug_fix 直接路径跳过 PM + Architect，只将 triage 选中的文件代码传给 Engineer。Engineer 看不到项目的完整文件结构和依赖关系，修复时可能删除对未传入文件的 import，导致功能丢失。

### 复现场景

1. 27 文件的计算器项目，某轮迭代将 `HistoryView.js` 替换为 `EnhancedHistoryView.js`，但 `App.js` 的 import 未同步更新
2. 运行时报 `Element type is invalid`（import 了不存在的文件）
3. 用户粘贴错误日志，输入"修复"
4. triage 正确选出 `/App.js` + `/components/CalculatorView.js`（2 个文件）
5. Engineer 只看到这 2 个文件的代码，不知道 `EnhancedHistoryView.js` 的存在
6. Engineer 把 App.js 中无法解析的 import 全部删除 → 7 个 import 变成 1 个 → 功能丢失

### 根因

`buildDirectMultiFileEngineerContext` 只传 triage 选中文件的代码，不传项目的整体架构信息。Engineer 无法做出正确的修复决策（应该把 `HistoryView` 改成 `EnhancedHistoryView`，而不是删掉 import）。

---

## 方案

在 bug_fix/style_change 的多文件直接路径中，将 `deriveArchFromFiles(全量文件)` 的架构摘要注入到 Engineer prompt 里。

### 设计要点

- **架构摘要覆盖全量文件**：对 `currentFiles`（全部 27 个文件）调用 `deriveArchFromFiles`，而不是对 triage 后的子集
- **代码仍然只传 triage 选中的文件**：保持 token 节省，不传 25 个无关文件的代码
- **零额外 LLM 调用**：`deriveArchFromFiles` 是纯正则分析，<1ms
- **不改变单文件 V1 路径**：单文件不存在跨文件 import 丢失问题

### 改动文件

#### 1. `lib/agent-context.ts` — `buildDirectMultiFileEngineerContext`

新增可选参数 `archSummary?: string`。当提供时，在 prompt 的"用户反馈"之后插入：

- 架构摘要（文件列表 + exports + 依赖关系 + 状态管理 + 持久化）
- 约束指令："你的任务是定向修复上述反馈中的问题，严禁重写、重构或添加未提及的功能。保持应用的整体架构、功能和 UI 不变。所有现有 import 必须保留，除非 import 的目标文件确实不存在。"

不传 `archSummary` 时行为与现有完全一致。

#### 2. `components/workspace/chat-area.tsx` — 直接路径

在 `isMultiFileV1` 分支中，构建 `baseDirectContext` 之前：

```typescript
const archSummary = isMultiFileV1 ? deriveArchFromFiles(currentFiles) : "";

const baseDirectContext = isMultiFileV1
  ? buildDirectMultiFileEngineerContext(prompt, triageFiles, archSummary || undefined)
  : buildDirectEngineerContext(prompt, currentFiles);
```

关键：`deriveArchFromFiles(currentFiles)` 用全量文件，`triageFiles` 仍然是 triage 选中的子集。

### 不改的东西

- 单文件 V1 路径（`buildDirectEngineerContext`）
- triage 逻辑 / `MAX_PATCH_FILES`（triage 工作正常）
- merge 逻辑（不加 Direction B 硬约束，Engineer 没有输出额外文件）
- `deriveArchFromFiles` 本身（现有输出已满足需求）

---

## 注入后的 prompt 结构示例

```
你是一位全栈工程师。根据用户反馈，精准修改以下多文件 React 应用。

用户反馈：修复 Element type is invalid...

当前应用架构（从代码实时分析，请在此基础上增量修改）：

文件结构（27 个文件）：
  /App.js (45 lines) — exports: App (default)
  /components/Navigation.js (30 lines) — exports: Navigation (default)
  /components/EnhancedHistoryView.js (120 lines) — exports: EnhancedHistoryView (default)
  ...

依赖关系：
  /App.js → [/components/Navigation.js, /components/CalculatorView.js, ...]

状态管理：useState, useContext
持久化：localStorage

重要约束：你的任务是定向修复上述反馈中的问题，严禁重写、重构或添加未提及的功能。
保持应用的整体架构、功能和 UI 不变。所有现有 import 必须保留，除非 import 的目标文件确实不存在。

当前应用文件列表：
- /App.js
- /components/CalculatorView.js

当前版本代码（逐文件参考）：
<source file="/App.js">...</source>
<source file="/components/CalculatorView.js">...</source>

输出格式（严格遵守）：...
```

---

## 预期效果

Engineer 看到架构摘要后，能发现 `EnhancedHistoryView.js` 的存在，将 `import HistoryView from '/components/HistoryView.js'` 修复为 `import EnhancedHistoryView from '/components/EnhancedHistoryView.js'`，而不是删除该 import。
