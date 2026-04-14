# 代码后处理（Code Post-Processing）

## 概述

Engineer 生成完成后，合并所有文件（`{ ...currentFiles, ...newFiles }`）之前不进行后处理。合并完成后，系统依次执行三项静态检查：补全缺失文件、修复 import/export 不匹配、移除禁止的外部包引用。每项检查超过 3 个问题时静默跳过，依靠 Sandpack Proxy stub 兜底防止白屏。相关逻辑位于 `lib/extract-code.ts`，调用点在 `components/workspace/chat-area.tsx`。

## 设计思路

关键取舍：后处理在**合并后的完整文件集**上运行（ADR 0016）。旧实现在合并之前运行，会将 V1 的旧文件误判为"缺失"，触发大量无效修复请求。合并前后的区别：合并后 `currentFiles` 中的旧文件已在集合中，静态分析不会误判。

三项检查限制均为 ≤3 的原因：超过 3 个问题意味着生成质量已严重偏差，继续发起多次修复请求会显著增加延迟且可能引入更多问题。

## 代码逻辑

### 检查一：findMissingLocalImportsWithNames

```typescript
export function findMissingLocalImportsWithNames(
  files: Readonly<Record<string, string>>
): Map<string, Set<string>>
// 扫描所有文件中以 "/" 开头的本地导入路径
// 返回 Map<缺失路径, 该路径的 named import 集合>
// 白名单：WHITELISTED_LOCAL = new Set(["/supabaseClient.js"])
```

两遍扫描：

1. **Pass 1**（named imports）：`import [Default,] { Foo, Bar as B } from '/path'` → 提取原始导出名（`Bar as B` → 记录 `Bar`）
2. **Pass 2**（default/namespace imports）：`from '/path'` → 确保路径被跟踪（即使无 named imports）

**调用逻辑**（chat-area.tsx）：

```typescript
const missingFiles = findMissingLocalImportsWithNames(mergedFiles)
if (missingFiles.size > 0 && missingFiles.size <= 3) {
  // 发起补全请求：buildMissingFileEngineerPrompt(missingPaths, mergedFiles)
  // → POST /api/generate { agent: "engineer" }
}
// missingFiles.size > 3 → 静默跳过，Sandpack stub 兜底
```

### 检查二：checkImportExportConsistency

```typescript
export function checkImportExportConsistency(
  files: Readonly<Record<string, string>>
): ImportExportMismatch[]

interface ImportExportMismatch {
  importerPath: string;
  exporterPath: string;
  missingNamed: string[];   // 被导入但目标文件未导出的名称
  missingDefault: boolean;  // 被 default import 但目标无 default export
}
```

依赖 `extractFileExports()` 和 `extractFileImports()` 两个解析函数：

```typescript
// extractFileExports: 提取文件所有 named exports 和 default export 状态
// 跳过 export type（TypeScript 类型，无运行时影响）
export function extractFileExports(code: string): { named: Set<string>; hasDefault: boolean }

// extractFileImports: 提取所有本地路径的 import 信息
// 跳过 import type、外部包（非 "/" 开头）
export function extractFileImports(
  code: string
): Array<{ path: string; named: string[]; hasDefault: boolean }>
// "Foo as Bar" → named 记录原始导出名 "Foo"
```

**调用逻辑**：

```typescript
const mismatches = checkImportExportConsistency(mergedFiles)
if (mismatches.length > 0 && mismatches.length <= 3) {
  // buildMismatchedFilesEngineerPrompt(mismatches, mergedFiles)
  // → POST /api/generate { agent: "engineer" }
}
```

### 检查三：checkDisallowedImports

```typescript
const ALLOWED_EXTERNAL_PACKAGES = new Set(["react", "react-dom", "lucide-react"])

export function checkDisallowedImports(
  files: Readonly<Record<string, string>>
): DisallowedImport[]

interface DisallowedImport {
  filePath: string;
  packageName: string;  // 完整包名（如 "@mui/material/Button"）
}
```

包名解析：scoped package `@scope/pkg` → base 为 `@scope/pkg`；普通包取第一段（`lodash/fp` → `lodash`）。

**调用逻辑**：

```typescript
const disallowed = checkDisallowedImports(mergedFiles)
if (disallowed.length > 0 && disallowed.length <= 3) {
  // buildDisallowedImportsEngineerPrompt(disallowed, mergedFiles)
  // → POST /api/generate { agent: "engineer" }
}
```

### 执行顺序与 merge 时机

```
// merge 必须在后处理之前（ADR 0016）
const mergedFiles = { ...currentFiles, ...allCompletedFiles }

// 按序执行三项检查
①  findMissingLocalImportsWithNames(mergedFiles)   → ≤3: 补全请求
②  checkImportExportConsistency(mergedFiles)        → ≤3: 修复请求
③  checkDisallowedImports(mergedFiles)              → ≤3: 修复请求

// 最后执行 removeFiles
scaffold.removeFiles?.forEach(p => delete mergedFiles[p])
```

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| AI 生成了 import '/components/Foo.js' 但未生成该文件 | 检查一：补全请求 |
| A.js 导入 B.js 的 `useData`，但 B.js 只有 default export | 检查二：修复 B.js 的导出 |
| AI 生成了 `import axios from 'axios'` | 检查三：移除或替换为 fetch |
| V1 文件已存在，新文件引用 V1 文件 | ADR 0016：合并后旧文件已在集合中，不误判为缺失 |
| 缺失文件 > 3 | 静默跳过，buildSandpackConfig Proxy stub 防白屏 |
| /supabaseClient.js 出现在 import 中 | 白名单，不触发任何检查 |

## 未覆盖场景 / 已知限制

- **动态 import**：`import(path)` 形式不被静态正则检测。
- **re-export 链**：`export { Foo } from '/bar'` 形式的间接导出不被 `extractFileExports` 追踪。
- **> 3 个问题静默跳过**：超过阈值的问题不修复，用户可能看到运行时错误。
- **检查三无法处理所有外部包**：Sandpack 的可用包实际上包含 `@supabase/supabase-js`、Tailwind CDN 等，但这些通过其他注入机制提供，不在 `ALLOWED_EXTERNAL_PACKAGES` 中。

## 相关文件

- `lib/extract-code.ts` — 所有检查函数和解析工具
- `lib/generate-prompts.ts` — `buildMissingFileEngineerPrompt`、`buildMismatchedFilesEngineerPrompt`、`buildDisallowedImportsEngineerPrompt`
- `lib/types.ts` — `ImportExportMismatch`、`DisallowedImport`、`PartialExtractResult`
- `components/workspace/chat-area.tsx` — 后处理调用链（merge → 三项检查 → removeFiles → sandpack）
- `docs/adr/0016-postprocessing-merge-order.md` — merge 时机修复 ADR
