# 版本管理增强设计

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this spec.

**Goal:** 在现有数据库架构上补齐版本分支追踪、迭代上下文快照、变更文件记录三项能力，解决恢复版本时上下文不一致的问题。

**方案选型:** 增强型数据库版本管理（不引入 git）。评估并排除了服务端 bare repo（Vercel 无持久文件系统）、客户端虚拟 git（数据绑定浏览器）、真实 GitHub repo（延迟高、依赖重）三种方案。

---

## 1. 数据模型变更

### 1.1 Prisma Schema

在 `Version` 模型上增加 3 个可选字段：

```prisma
model Version {
  // ... 现有字段不变

  parentVersionId    String?
  parentVersion      Version?  @relation("VersionLineage", fields: [parentVersionId], references: [id])
  childVersions      Version[] @relation("VersionLineage")

  changedFiles       Json?     // { added: Record<string, string>, modified: Record<string, string>, removed: string[] }
  iterationSnapshot  Json?     // 生成时的 iterationContext 快照（rounds 数组）
}
```

### 1.2 TypeScript 类型

`lib/types.ts` 中 `ProjectVersion` 增加对应字段：

```typescript
interface ProjectVersion {
  // ... 现有字段不变
  parentVersionId?: string | null;
  changedFiles?: ChangedFiles | null;
  iterationSnapshot?: IterationContext | null;
}

interface ChangedFiles {
  readonly added: Record<string, string>;
  readonly modified: Record<string, string>;
  readonly removed: readonly string[];
}
```

### 1.3 字段语义

| 字段 | 正常生成 | 恢复操作 |
|------|---------|---------|
| `parentVersionId` | `null` | 指向被恢复的源版本 ID |
| `files` | 完整文件集（保留，兼容现有逻辑） | 复制源版本的 files |
| `changedFiles` | 与上一版本的差异 | `null`（恢复不算变更） |
| `iterationSnapshot` | 当前 rounds 快照 | 复制源版本的快照 |

---

## 2. computeChangedFiles 函数

新增于 `lib/version-files.ts`。

```typescript
function computeChangedFiles(
  prevFiles: Record<string, string> | null,
  newFiles: Record<string, string>
): ChangedFiles
```

- `added` — newFiles 有、prevFiles 没有的文件（存完整内容）
- `modified` — 两边都有但内容不同的文件（存新内容，不存 diff patch）
- `removed` — prevFiles 有、newFiles 没有的文件路径

选择存完整变更文件而非 line-level diff patch 的原因：LLM 生成的代码通常整个文件重写，diff 反而比原文件更大。

---

## 3. 版本创建变更

### 3.1 正常生成（chat-area.tsx 的 4 个创建点）

每次 `POST /api/versions` 时额外传入：

```typescript
{
  projectId,
  files,
  description,
  changedFiles: computeChangedFiles(prevVersionFiles, newFiles),
  iterationSnapshot: currentIterationContext
}
```

`prevVersionFiles` 取自 `versions` 数组最后一个元素的 files（通过 `getVersionFiles()`）。首次生成时 prevFiles 为 `null`，所有文件计入 `added`。

### 3.2 API 路由（POST /api/versions）

接收并存储新增的 `changedFiles` 和 `iterationSnapshot` 字段，无额外逻辑。

---

## 4. 恢复逻辑变更

### 4.1 restore API（POST /api/versions/[id]/restore）

```
新逻辑：
  newVersion.files              = sourceVersion.files
  newVersion.parentVersionId    = sourceVersion.id
  newVersion.iterationSnapshot  = sourceVersion.iterationSnapshot
  newVersion.changedFiles       = null
  newVersion.description        = "从 vN 恢复"
```

同时回写 `Project.iterationContext`：

```
if (sourceVersion.iterationSnapshot != null) {
  project.iterationContext = sourceVersion.iterationSnapshot
} else {
  // 旧版本无快照，不动当前上下文（降级策略）
}
```

### 4.2 前端状态同步（workspace.tsx）

`handleRestoreVersion` 回调中，如果 API 返回的新版本包含 `iterationSnapshot`，同步更新组件内的 `iterationContext` 状态，确保后续生成使用恢复后的上下文。

---

## 5. 时间线 UI 变更

保持水平线性布局，标注恢复来源。不做树状分支图。

```
V1 ── V2 ── V3 ── V4 ── V5 ── V6
                   ↑从V2恢复       ↑从V3恢复
```

### 5.1 version-node.tsx

- 恢复版本节点使用不同图标（回退箭头）
- Tooltip 显示"从 vN 恢复"

### 5.2 version-timeline.tsx

- 恢复节点下方显示来源标签 "← vN"

### 5.3 version-detail-popover.tsx

- 弹窗增加"恢复自 vN"信息
- 显示 `changedFiles` 摘要："修改了 N 个文件"（仅正常生成版本显示）

---

## 6. 数据迁移

- 3 个新字段全部是可选字段（`Json?` / `String?`）
- `npx prisma db push` 即可，无需迁移脚本
- 旧版本的新字段为 `null`，现有逻辑零影响
- 旧版本无 `iterationSnapshot`，恢复时不回退上下文（降级策略）

---

## 7. 影响范围

### 需要修改的文件

| 文件 | 变更 |
|------|------|
| `prisma/schema.prisma` | Version 加 3 个字段 + 自引用关系 |
| `lib/types.ts` | ProjectVersion 加字段 + ChangedFiles 类型 |
| `lib/version-files.ts` | 新增 computeChangedFiles 函数 |
| `app/api/versions/route.ts` | POST 接收并存储 changedFiles、iterationSnapshot |
| `app/api/versions/[id]/restore/route.ts` | 写入 parentVersionId、iterationSnapshot；回写 Project.iterationContext |
| `components/workspace/chat-area.tsx` | 4 个版本创建点传入 changedFiles + iterationSnapshot |
| `components/workspace/workspace.tsx` | handleRestoreVersion 同步 iterationContext |
| `components/timeline/version-node.tsx` | 恢复版本样式区分 |
| `components/timeline/version-timeline.tsx` | 恢复来源标签 |
| `components/timeline/version-detail-popover.tsx` | 弹窗增加恢复来源 + 变更摘要 |

### 不需要改的

- `/api/generate` 和 AI 生成流程
- Sandpack 配置
- 导出 / 部署
- 认证 / 权限

---

## 8. 不做的事

- **不引入 git 依赖**（isomorphic-git、bare repo、GitHub API）
- **不做树状分支图** — 水平空间有限，标注来源已足够
- **不做版本 diff view** — 有了 changedFiles 数据未来可加，不在本次范围
- **不做旧数据回填** — 旧版本无快照即为 null，降级处理
- **不改 files 字段存储方式** — 保留完整快照以兼容现有逻辑，changedFiles 是额外增量记录
