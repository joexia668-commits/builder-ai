# 设计文档：项目重命名功能

**日期**: 2026-04-11  
**状态**: 已确认

## 需求

在项目创建后，允许用户随时编辑项目名称。入口覆盖 Home 页和 Workspace 页（侧边栏）。

## 方案选择

采用**方案 B：共享 `RenameProjectDialog` 组件**，与现有 `DeleteProjectDialog` 模式一致。

- API 层已就绪：`PATCH /api/projects/[id]` 支持更新 `name` 字段，无需后端改动
- 新增一个可复用的 Dialog 组件，各入口组件调用它，API 调用在父列表组件处理

## 组件设计

### 新增：`components/ui/rename-project-dialog.tsx`

```tsx
interface RenameProjectDialogProps {
  projectName: string;       // 预填当前名称
  onConfirm: (newName: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}
```

- Dialog 内含一个 `Input`，初始值为当前项目名称
- Enter 键触发确认
- `isLoading` 时按钮显示"保存中…"并禁用
- 名称为空时禁用确认按钮

### 修改：`components/home/project-card.tsx`

- 下拉菜单新增"重命名"选项（`Pencil` 图标），点击打开 `RenameProjectDialog`
- 新增 props：
  - `onRename: (id: string, newName: string) => void`
  - `isRenaming?: boolean`

### 修改：`components/home/project-list.tsx`

新增 `handleRename(id, newName)`:
1. 调用 `PATCH /api/projects/:id` with `{ name: newName }`
2. 成功后用 `map` 返回新数组更新本地 `projects` 状态（immutable）
3. `toast.success("项目已重命名")`
4. 失败时 `toast.error("重命名失败，请重试")`

### 修改：`components/sidebar/project-item.tsx`

- 删除原有独立删除按钮
- 新增 `MoreHorizontal` 图标触发的 `DropdownMenu`，包含：
  - **重命名**（`Pencil` 图标）→ 打开 `RenameProjectDialog`
  - **删除**（`Trash2` 图标，红色）→ 打开 `DeleteProjectDialog`
- 新增 props：
  - `onRename: (id: string, newName: string) => void`
  - `isRenaming?: boolean`

### 修改：`components/sidebar/conversation-sidebar.tsx`

新增 `handleRename(id, newName)`，逻辑与 `ProjectList.handleRename` 一致。

## 数据流

```
用户点击"重命名" (ProjectCard / ProjectItem)
  → 打开 RenameProjectDialog
  → 用户输入新名称并确认
  → onRename(id, newName) 回调
  → 父组件 handleRename()
      → PATCH /api/projects/:id { name }
      → 成功：setProjects(prev => prev.map(...))
      → toast.success / toast.error
```

## 不在本次范围内

- Workspace 页头部标题编辑（非本次需求）
- 项目描述的编辑（已有字段但不暴露入口）
