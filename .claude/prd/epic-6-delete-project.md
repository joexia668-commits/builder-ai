# EPIC 6: 删除项目功能

| Field | Value |
|-------|-------|
| Goal | 允许用户永久删除自己的项目（含关联消息与版本历史） |
| Business Value | 提升项目管理体验，避免列表堆积无用项目 |
| Total Estimate | ~1.5h |
| Phase | Phase 6 of 6 |

## 功能描述

用户可在主页项目列表或左侧边栏对任意项目发起删除操作。删除前弹出二次确认框防止误操作，确认后级联清除该项目的所有消息与版本历史，UI 即时移除对应卡片或列表项。若用户在项目详情页内删除当前项目，自动跳转回首页。

## 数据层

### 级联删除确认

Prisma Schema 中 `Message` 和 `Version` 的 `projectId` 外键必须配置 `onDelete: Cascade`，确保删除 Project 时自动清除所有关联记录：

```prisma
model Message {
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Version {
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

若缺失则补全并执行迁移：
```bash
prisma migrate dev --name add-cascade-delete-project
```

### API 路由

`DELETE /api/projects/[id]` 已存在，含所有权校验（`project.userId === session.user.id`），无需新建。

## 前端交互流程

```
1. 用户点击项目卡片菜单 / 侧边栏 hover 删除按钮
2. 弹出 AlertDialog 二次确认：
   "确认删除「{项目名}」？此操作不可撤销，所有对话和版本历史将永久删除。"
3. 用户点击「确认删除」
   → fetchAPI('DELETE', `/api/projects/${id}`)
   → 成功：从列表移除该项（乐观更新，无需整页刷新）
          若当前在该项目页面 → router.push('/')
   → 失败：toast 错误提示，列表状态回滚
4. 用户点击「取消」→ 关闭弹框，无任何操作
```

## UI 交互细节

### 主页项目卡片（`components/home/project-card.tsx`）
- 右上角添加 `DropdownMenu`（shadcn/ui），触发图标：`MoreHorizontal`
- 菜单项："删除项目"（红色文字 + `Trash2` 图标）
- 点击后弹出 `AlertDialog` 确认框

### 左侧边栏项目行（`components/sidebar/project-item.tsx`）
- hover 时在行尾显示 `Trash2` 图标按钮（灰色，hover 变红）
- 非 hover 状态下图标隐藏，不占用布局空间
- 点击后弹出同款 `AlertDialog` 确认框

### AlertDialog 文案

```
标题：删除项目
正文：确认删除「{项目名}」？此操作不可撤销，所有对话记录和版本历史将永久删除。
取消按钮：取消
确认按钮：删除（variant="destructive"）
```

## 状态管理

- `ProjectList`（主页）：维护本地 `projects` state，删除成功后 filter 移除
- `ConversationSidebar`（侧边栏）：维护本地 `projects` state，删除成功后 filter 移除；若 `params.id === deletedId` 则 `router.push('/')`
- 两处共用同一套 `AlertDialog` 确认逻辑，可提取为 `DeleteProjectDialog` 组件复用

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `prisma/schema.prisma` | 验证/补全 `onDelete: Cascade` |
| `components/home/project-card.tsx` | 添加 DropdownMenu + 触发删除 |
| `components/home/project-list.tsx` | 传入 `onDelete` 回调，更新 state |
| `components/sidebar/project-item.tsx` | hover 删除按钮 |
| `components/sidebar/conversation-sidebar.tsx` | 删除回调 + 路由跳转 |
| `components/ui/delete-project-dialog.tsx` | 新建：复用的确认弹框组件 |

## 验收标准

- [ ] 主页项目卡片右上角有操作菜单，含"删除项目"选项
- [ ] 侧边栏项目行 hover 时出现删除按钮，非 hover 时隐藏
- [ ] 点击删除弹出确认框，显示项目名称
- [ ] 取消确认框后，项目列表无任何变化
- [ ] 确认删除后，卡片 / 列表项即时消失，无整页刷新
- [ ] 数据库中对应 Project、Message、Version 记录均已清除
- [ ] 在项目详情页删除当前项目后，自动跳转回首页
- [ ] 删除他人项目时 API 返回 403（权限校验有效）
- [ ] 删除不存在的项目时 API 返回 404，前端静默处理
- [ ] 删除失败时显示 toast 错误提示，列表状态不变

## 依赖

- EPIC 0（项目骨架 + 认证）完成
- `DELETE /api/projects/[id]` 路由已存在（EPIC 0 产出）
