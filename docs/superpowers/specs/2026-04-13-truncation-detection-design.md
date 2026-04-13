# Engineer 代码截断检测与恢复

## 问题

Engineer 生成多文件时，LLM 输出可能在文件内部被截断（token 上限或流式中断），产生语法不完整的代码。当前 `extractMultiFileCodePartial` 只校验花括号 `{}` 平衡，导致多种截断模式静默通过，Sandpack 报 `SyntaxError`。

**已知触发案例**：

```
import { Edit2, Save, X } from 'lucide    ← 字符串未闭合
```

Sandpack 报 `SyntaxError: Unterminated string constant (2:31)`。`runLayerWithFallback` 的 partial salvage + retry 未救回，因为文件被分类为 `ok`（零花括号，`isBracesBalanced` 返回 true）。

## 设计参考

Claude Code 查询引擎（[deep-dive-claude-code/ch04-query-engine](https://github.com/sawzhang/deep-dive-claude-code/blob/main/part2-core-engine/ch04-query-engine.md)）的 `max_output_tokens` 两阶段恢复：

1. 升级 token 上限 → 重试
2. 注入恢复消息 "Resume directly — no apology, no recap. Pick up mid-thought."
3. 最多 3 次恢复尝试
4. **Withholding 模式**：恢复成功前不向上层暴露错误

我们的映射：
- 检测截断（当前空缺）→ 标记为 `failed`
- 已有 `runLayerWithFallback` 重试机制（2 layer + 2 per-file）
- 重试 hint 采用文件级（完整重新生成），不做断点续写

## 目标

扩展 `extractMultiFileCodePartial` 的完整性校验，覆盖六种截断模式，使截断文件被正确标记为 `failed`，触发现有重试流程。

## 截断模式覆盖

### 修复后覆盖（梯队 1 + 2）

| 截断类型 | 检测函数 | 示例 |
|---------|---------|------|
| `{}` 不平衡 | `isDelimitersBalanced` | `function App() { return 1;` |
| `()` 不平衡 | `isDelimitersBalanced` | `export default function App(` |
| `[]` 不平衡 | `isDelimitersBalanced` | `const arr = [1, 2,` |
| `'` `"` 未闭合 | `hasUnterminatedLiteral` | `import { X } from 'lucide` |
| `` ` `` 未闭合 | `hasUnterminatedLiteral` | `` const x = `hello ${ `` |
| `/* */` 未闭合 | `hasUnterminatedLiteral` | `/* TODO: fix this` |

### 不覆盖（梯队 3 — 需 AST parser，YAGNI）

| 截断类型 | 原因 |
|---------|------|
| JSX 标签未闭合 | `<` `>` 在比较运算中也出现，无法简单计数 |
| 不完整表达式 | `const x =` / `return x &&` 需完整语法分析 |
| 正则未闭合 | `/pattern` 无法区分除法运算符 |

## 数据流

```
LLM 原始输出
  ↓
extractMultiFileCodePartial(raw, expectedFiles)
  ├─ 逐文件解析（现有 FILE marker 分割）
  ├─ isDelimitersBalanced(code)     ← 升级：{} + () + []
  ├─ hasUnterminatedLiteral(code)   ← 新增：字符串 + 模板 + 多行注释
  │     不通过 → 加入 failed[]
  ↓
route.ts emit SSE（零改动）:
  partial_files_complete { files: ok, failed: [...截断文件...] }
  ↓
readEngineerSSE → { files, failedInResponse }（零改动）
  ↓
runLayerWithFallback（零改动）
  └─ remaining 非空 → retry with retryHint
       └─ getMultiFileEngineerPrompt 注入通用截断 hint
```

## 新增函数

### `isDelimitersBalanced(code: string): boolean`

替换现有 `isBracesBalanced`，检查三对分隔符：

```typescript
function isDelimitersBalanced(code: string): boolean {
  let braces = 0;
  let parens = 0;
  let brackets = 0;
  for (const ch of code) {
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  return braces === 0 && parens === 0 && brackets === 0;
}
```

### `hasUnterminatedLiteral(code: string): boolean`

状态机遍历，复用 `stripComments` 的字符级扫描模式：

```typescript
export function hasUnterminatedLiteral(code: string): boolean {
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // 单行注释 — 跳到行尾
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }

    // 多行注释 — 跳到 */
    if (ch === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      if (i >= code.length) return true;  // 未闭合注释
      i += 2;
      continue;
    }

    // 单引号/双引号字符串
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") i++;
        i++;
      }
      if (i >= code.length) return true;  // 未闭合字符串
      i++;
      continue;
    }

    // 模板字面量
    if (ch === "`") {
      i++;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") i++;
        i++;
      }
      if (i >= code.length) return true;  // 未闭合模板
      i++;
      continue;
    }

    i++;
  }
  return false;
}
```

## `extractMultiFileCodePartial` 改动

在现有 brace balance 检查位置替换为双重检查：

```typescript
const code = deduplicateDefaultExport(codeLines.join("\n").trim());

if (!isDelimitersBalanced(code)) {
  failed.push(path);
  continue;
}
if (hasUnterminatedLiteral(code)) {
  failed.push(path);
  continue;
}

ok[path] = code;
```

## 同步更新调用点

`isBracesBalanced` 被以下位置调用，全部改为 `isDelimitersBalanced`：

| 调用位置 | 行为变化 |
|---------|---------|
| `extractMultiFileCodePartial` | 扩展检查 + 新增 `hasUnterminatedLiteral` |
| `extractMultiFileCode`（严格版） | 检查范围扩展（行为只扩展不收窄） |
| `extractAnyMultiFileCode` | 同上 |
| `isCodeComplete`（单文件） | 同上 |

严格版和 `extractAnyMultiFileCode` 不加 `hasUnterminatedLiteral` — 这些路径失败后已有其他重试机制。

## 类型扩展

`lib/types.ts`：

```typescript
// 现有
export type AttemptReason = "initial" | "parse_failed" | "per_file_fallback";

// 改为
export type AttemptReason = "initial" | "parse_failed" | "string_truncated" | "per_file_fallback";
```

## Retry hint 更新

`lib/generate-prompts.ts` 的 retryHint（`attempt > 1` 时注入）措辞更新为通用截断覆盖：

```
你上一次生成以下文件时输出不完整（可能是字符串/括号被截断或代码结构不完整），
请完整重新生成，确保所有字符串闭合、所有括号/方括号/花括号配对、注释块完整。
```

不改 `RequestMeta` 结构，不传递失败原因类型 — 统一措辞同时覆盖 `parse_failed` 和 `string_truncated`。

## 文件影响范围

| 文件 | 改动 |
|------|------|
| `lib/extract-code.ts` | `isBracesBalanced` → `isDelimitersBalanced`（加 `()` `[]`）；新增 `hasUnterminatedLiteral`；`extractMultiFileCodePartial` 加检查 |
| `lib/types.ts` | `AttemptReason` 加 `"string_truncated"` |
| `lib/generate-prompts.ts` | retryHint 措辞更新 |
| `__tests__/extract-code.test.ts` | ~14 个新测试用例 |

**零改动**：`runLayerWithFallback`、`route.ts`、`chat-area.tsx`、`sandpack-config.ts`

## 测试策略

### `isDelimitersBalanced`

| 用例 | 输入 | 期望 |
|------|------|------|
| 花括号平衡 | `function App() { return 1; }` | `true` |
| 花括号不平衡 | `function App() { return 1;` | `false` |
| 圆括号不平衡 | `function App(` | `false` |
| 方括号不平衡 | `const arr = [1, 2,` | `false` |
| 混合平衡 | `fn([{x: 1}])` | `true` |
| 混合不平衡 | `fn([{x: 1}]` | `false` |

### `hasUnterminatedLiteral`

| 用例 | 输入 | 期望 |
|------|------|------|
| 正常文件 | `import { X } from 'react';\nconst y = "ok";` | `false` |
| 单引号截断 | `import { X } from 'lucide` | `true` |
| 双引号截断 | `import { X } from "lucide` | `true` |
| 模板字面量截断 | `` const x = `hello ${ `` | `true` |
| 转义引号不误判 | `const x = 'it\\'s fine';` | `false` |
| 注释内引号不误判 | `// don't touch\nconst x = 1;` | `false` |
| 多行注释未闭合 | `/* TODO: fix this` | `true` |
| 多行注释已闭合 | `/* comment */ const x = 1;` | `false` |

### `extractMultiFileCodePartial` 集成

| 用例 | 输入 | 期望 |
|------|------|------|
| 字符串截断文件 | 含 `from 'lucide` 的文件 | 该文件在 `failed`，其余在 `ok` |
| 圆括号截断文件 | 含 `function App(` 的文件 | 该文件在 `failed` |
| 多行注释截断 | 含 `/* todo` 的文件 | 该文件在 `failed` |
| 所有文件正常 | 正常多文件输出 | `failed` 为空 |

## 后续独立 spec

**Import/export 一致性校验**（不在本次范围内）：

Engineer 生成完所有文件后、送入 Sandpack 前，校验 named import vs default export 是否匹配。当前 `findMissingLocalImports` 只检查路径是否存在，不检查导出名是否匹配。推荐方案：扩展 `findMissingLocalImports` 增加 named vs default 校验（~50 行），检测到不匹配时自动修正 import 语句。
