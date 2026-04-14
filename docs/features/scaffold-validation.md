# Scaffold 验证与修复（Scaffold Validation）

## 概述

Architect Agent 输出的 JSON scaffold 描述了所有待生成文件及其依赖关系图。在交给拓扑排序和 Engineer 之前，`lib/validate-scaffold.ts` 的 `validateScaffold()` 对 scaffold 执行 5 条确定性修复规则，防止幽灵依赖、自引用和循环依赖导致 `topologicalSort` 抛错或 Engineer 请求死循环。

## 设计思路

核心设计原则：**确定性修复优于报错中断**。LLM 偶发幻觉（phantom deps、循环依赖）是已知问题；如果直接抛错，用户看到的是空白页面。通过确定性规则自动修复后，最坏情况也只是少生成几个文件，而不是整个生成流程崩溃。

修复后返回 `warnings[]` 列表，UI 层通过 `scaffoldWarnings` 字段展示，便于排查。

参见 ADR 0015（export 拆分）相关的 scaffold 一致性要求。

## 代码逻辑

### 函数签名

```typescript
export function validateScaffold(raw: ScaffoldData): ScaffoldValidationResult

interface ScaffoldValidationResult {
  scaffold: ScaffoldData;   // 修复后的 scaffold（immutable，原始对象不变）
  warnings: string[];       // 每条修复操作的描述
}
```

### 5 条规则（按执行顺序）

**规则 4：移除自引用**（排在最前以免影响后续入度计算）

```typescript
files = files.map(f => ({
  ...f,
  deps: f.deps.filter(d => d !== f.path)
}))
// 警告：移除自引用: /components/Foo.js
```

**规则 1：移除幽灵依赖**（deps 指向 scaffold 中不存在的文件）

```typescript
const allPaths = new Set(files.map(f => f.path))
// WHITELISTED_DEPS = new Set(["/supabaseClient.js"])
files = files.map(f => ({
  ...f,
  deps: f.deps.filter(d => allPaths.has(d) || WHITELISTED_DEPS.has(d))
}))
// 警告：移除幽灵依赖: /App.js → /utils/missing.js
```

**规则 2：清理 hints 中的幽灵路径引用**

```typescript
const HINTS_PATH_RE = /\/[\w\-\/]+\.(js|jsx|ts|tsx)/g
// hints 中出现的路径若不在 scaffold 中，替换为 "(在当前文件内实现)"
// 警告：hints 引用了不存在的文件: /utils/phantom.js
```

**规则 3：DFS 检测并破除循环依赖**

使用 `findOneCycle()` + `breakCycles()` 迭代处理：

```typescript
function findOneCycle(files): string[] | null {
  // 3-color DFS：WHITE=未访问，GRAY=访问中，BLACK=已完成
  // GRAY 节点被再次访问时 → 发现环 → 沿 parent 指针回溯重建环路径
  // 返回 [v, a, b, ..., v] 形式的环
}

function breakCycles(files, warnings): readonly ScaffoldFile[] {
  // 迭代：每次找到一条环 → 选择移除哪条边
  // 选边策略：cycle 中找入度差 (src.inDegree - tgt.inDegree) 最大的边
  //   同入度差时选 src.deps 数量最多的边（更"中心"的节点作为边移除源）
  // 每次只移除一条边，至多迭代 N 次（N = files.length）
  // 警告：断开循环依赖: /components/A.js → /components/B.js
}
```

**规则 5：removeFiles 冲突检测**

```typescript
// scaffold.removeFiles 中出现在 scaffold.files 中的路径为冲突
// 冲突路径从 removeFiles 中移除（保留 scaffold.files 中的定义）
// 警告：removeFiles 与 scaffold files 冲突: /old.js（已从 removeFiles 移除）
```

### extractScaffoldFromTwoPhase（Architect 输出解析）

在 `validateScaffold` 之前，Architect 的两阶段输出先经过 `extractScaffoldFromTwoPhase(raw: string)` 解析：

```
<thinking>...</thinking>
<output>{ JSON ScaffoldData }</output>
```

1. 提取 `<output>...</output>` 之间的内容
2. 尝试 `JSON.parse`
3. 失败时尝试去除 markdown fence 后再解析
4. 仍失败 → 回退到单文件 Engineer 路径（`extractReactCode`）

## 覆盖场景

| 场景 | 规则 | 处理结果 |
|------|------|---------|
| `/App.js` deps 包含 `/App.js` | 规则 4 | 自引用移除 |
| `deps: ["/utils/api.js"]` 但 scaffold 无该文件 | 规则 1 | 幽灵依赖移除 |
| hints 中包含 `/components/missing.tsx` | 规则 2 | 替换为"(在当前文件内实现)" |
| A→B→C→A 三角循环 | 规则 3 | 找入度差最大边移除，如 C→A |
| removeFiles: ["/old.js"] 但 scaffold 也生成 /old.js | 规则 5 | 从 removeFiles 删除 /old.js |
| `/supabaseClient.js` 出现在 deps 中 | 规则 1 | 白名单，保留 |

## 未覆盖场景 / 已知限制

- **语义依赖错误**：规则只处理图结构，无法发现"A 依赖 B 但忘记在 deps 中声明"的情况。
- **多个独立循环最优破坏**：`breakCycles` 每次只处理一条环，选边启发式（入度差）未必全局最优。复杂循环图可能比手动规划多断几条边。
- **规则 2 的路径识别局限**：HINTS_PATH_RE 只匹配 `.js|.jsx|.ts|.tsx` 扩展名；`.css`、`.json` 等路径不处理。
- **循环检测上限**：`breakCycles` 最多迭代 `files.length` 次，理论上超大 scaffold 中若存在 O(N) 个独立循环可能不完全处理。

## 相关文件

- `lib/validate-scaffold.ts` — `validateScaffold`、`findOneCycle`、`breakCycles`
- `lib/topo-sort.ts` — 消费验证后的 scaffold
- `lib/types.ts` — `ScaffoldData`、`ScaffoldFile`、`ScaffoldValidationResult`
- `app/api/generate/route.ts` — 调用 `extractScaffoldFromTwoPhase` 和 `validateScaffold`
