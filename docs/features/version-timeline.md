# 版本时间轴（Version Timeline）

## 概述

每次 AI 生成完成后，系统将当前完整文件集作为不可变快照写入 `Version` 表。用户可在时间轴中点击任意历史版本恢复，恢复操作本身也会创建新版本（而非修改旧版本），保证历史链的完整性。`lib/version-files.ts` 提供向后兼容的文件读取工具，处理旧版单文件格式。

## 设计思路

核心设计：**INSERT-only**，版本从不被修改或删除（手动清理除外）。优点是简单可靠，恢复操作风险零；代价是随时间增长存储无上限（已知限制）。

`getVersionFiles()` 的向后兼容逻辑：早期版本只保存 `code`（单文件字符串），新版本保存 `files`（`Record<string, string>`）。两者共存于同一表中，统一通过此函数读取。

## 代码逻辑

### 版本创建（POST /api/versions）

```typescript
// 每次生成完成后自动调用
POST /api/versions { projectId, code: "", files: mergedFiles }

// 服务端逻辑：
const lastVersion = await prisma.version.findFirst({
  where: { projectId },
  orderBy: { versionNumber: "desc" },
})
const versionNumber = (lastVersion?.versionNumber ?? 0) + 1
await prisma.version.create({
  data: { projectId, versionNumber, code: "", files: mergedFiles }
})
```

`code` 字段保留为空字符串（向后兼容 schema），`files` 存储 JSON 格式的完整文件映射。

### 版本恢复（POST /api/versions/[id]/restore）

```typescript
// 读取目标版本
const target = await prisma.version.findUnique({ where: { id } })
const files = getVersionFiles(target)

// 创建新版本（不修改旧版本）
const newVersion = await prisma.version.create({
  data: { projectId, versionNumber: next, code: target.code, files: target.files }
})

// 同步更新 Project 的当前代码
await prisma.project.update({
  where: { id: projectId },
  data: { code: target.code, files: target.files }
})
```

恢复后，`Project.files` 更新为旧版内容，`Workspace` 重新加载后展示历史版本的代码。

### getVersionFiles

```typescript
// lib/version-files.ts
export function getVersionFiles(
  version: { code: string; files?: Record<string, string> | null }
): Record<string, string> {
  if (version.files) return version.files as Record<string, string>
  return { "/App.js": version.code }  // 旧版单文件兼容
}
```

统一入口，调用方无需区分新旧格式。

### 版本号管理

```typescript
// 每次创建从 DB 查询最新版本号，+1 后写入
// 无乐观锁：Vercel Serverless 环境下并发冲突概率极低（单用户单项目操作）
```

### 版本列表（GET /api/versions?projectId=xxx）

```typescript
// 返回按 versionNumber 倒序的版本列表
// 前端时间轴组件展示版本节点，点击触发 restore
```

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| 多文件生成完成 | files 字段保存完整文件映射 |
| 旧版只有 code 字段 | getVersionFiles 回退为 { "/App.js": code } |
| 用户点击历史版本恢复 | POST restore → INSERT 新版本 → 更新 Project |
| 恢复后继续迭代 | 恢复版本成为新的"当前代码"，下一次生成在其基础上增量 |
| 首次生成（versionNumber=0）| lastVersion=null → versionNumber=1 |

## 未覆盖场景 / 已知限制

- **无版本 diff 视图**：无法直观对比两个版本间的代码差异，只能全量查看。
- **iterationContext 不随版本回退**：恢复历史版本时 `iterationContext`（PM 历史轮次）不回退，PM 可能基于过时历史生成错误的增量 PRD。（已记录为已知问题，memory/project_rounds_no_rollback.md）
- **无限增长**：版本记录没有自动清理机制，长期使用的项目版本数量无上限。
- **并发版本号冲突**：多设备并发生成时，`versionNumber` 自增查询无锁，极端情况下可能产生重复号（实际影响极小）。
- **versions.code 字段废弃但未删除**：schema 中仍保留 `code: String`，新版本写入空字符串，存在轻微存储浪费。

## 相关文件

- `lib/version-files.ts` — `getVersionFiles`（新旧格式统一读取）
- `app/api/versions/route.ts` — GET（列表）/ POST（创建）
- `app/api/versions/[id]/restore/route.ts` — POST（恢复）
- `prisma/schema.prisma` — `Version` 模型（versionNumber, code, files）
- `components/timeline/version-timeline.tsx` — 时间轴 UI 组件
- `hooks/use-versions.ts` — 版本数据 CRUD + 时间轴 state
