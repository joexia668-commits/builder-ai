# EPIC 3: 版本时间线 + 回滚

| Field | Value |
|-------|-------|
| Goal | 每次 AI 生成自动保存版本快照，支持浏览和回滚 |
| Business Value | 体现工程思维，版本管理是专业工具的标配 |
| Total Estimate | ~1.5h |
| Phase | Phase 3 of 4 |

## 功能描述

每次 Engineer Agent 完成代码生成后，自动创建版本快照。用户可以在时间线中浏览历史版本、预览代码、回滚到任意版本。

## API 设计

```
GET /api/versions?projectId=xxx
  Response: {
    versions: [
      {
        id: "v_xxx",
        versionNumber: 1,
        description: "初始化：待办事项应用",
        code: "<!DOCTYPE html>...",
        createdAt: "2026-03-28T14:32:00Z"
      },
      ...
    ]
  }

POST /api/versions/:id/restore
  Response: {
    id: "v_new",           // 新创建的版本 ID
    versionNumber: 5,      // 新版本号
    code: "...",           // 恢复的代码
    description: "从 v2 恢复"
  }
  行为：基于目标版本创建新版本（不可变原则）
```

## 版本创建时机

- Engineer Agent `code_complete` 事件后自动触发
- `versionNumber` 自增（基于 projectId 的 MAX(versionNumber) + 1）
- `description` 从 PM Agent 的需求分析中提取（取第一行或标题）
- `agentMessages` 保存本轮全部 Agent 对话的 ID 引用

## 回滚策略 — 不可变原则

**永远不删除版本，回滚通过创建新版本实现**：

```
时间线: v1 → v2 → v3 → v4 (当前)

用户点击"恢复 v2":
时间线: v1 → v2 → v3 → v4 → v5 (当前, 内容 = v2)

用户继续迭代:
时间线: v1 → v2 → v3 → v4 → v5 → v6 (当前, 基于 v5 迭代)
```

好处：
- 操作可追溯，不丢失任何历史
- 实现极简（INSERT 一条新记录）
- 符合 immutable data 原则

## UI 设计

### 时间线组件（底部水平滚动）

```
┌───────────────────────────────────────────────────┐
│  v1 ●────v2 ●────v3 ●────v4 ●────v5 ● (当前)     │
│  初始化   加深色   改布局   加动画   从v2恢复      │
│  14:32   14:45   15:03   15:20   15:35            │
└───────────────────────────────────────────────────┘
```

- 水平时间线，节点用圆点表示
- 当前版本：实心大圆 + 主题色
- 历史版本：空心小圆
- 恢复产生的版本：带回滚图标

### 版本详情弹窗（点击节点触发）

```
┌─────────────────────────┐
│ v2 — 添加深色模式         │
│ 2026-03-28 14:45        │
│                         │
│ [预览代码]  [恢复此版本]  │
└─────────────────────────┘
```

- **预览代码**: 右侧 iframe 临时切换到该版本代码（不改变当前工作版本）
- **恢复此版本**: 创建新版本（v_new），代码区和预览区都切换到新版本

### 交互细节
- hover 版本节点显示 tooltip（版本号 + 描述 + 时间）
- 当前预览的版本在时间线上用蓝色高亮
- 正在预览历史版本时，顶部显示提示条："正在预览 v2 — [恢复此版本] [返回当前版本]"

### 预览模式 UI 约束
- 预览历史版本时，**ChatInput 必须 disabled**，防止用户在非当前版本上下文中发起对话
- Chat 消息列表继续显示全部历史（包含回滚点之后的消息），但顶部 banner 提供明确的上下文说明
- "返回当前版本"清除 `previewingVersion` state，恢复 ChatInput，时间线高亮回到最新版本

## 前端状态设计

```typescript
// workspace.tsx 中的关键 state
const [currentCode, setCurrentCode] = useState(latestVersionCode);  // 实际工作区版本
const [previewingVersion, setPreviewingVersion] = useState<ProjectVersion | null>(null);

// Sandpack 渲染逻辑：预览模式优先
const displayCode = previewingVersion?.code ?? currentCode;

// 预览模式 banner
const isPreviewingHistory = previewingVersion !== null;
```

状态转换：
- 点击历史版本节点 → `setPreviewingVersion(version)`，Sandpack 切换，ChatInput disabled
- 点击"恢复此版本" → POST `/api/versions/:id/restore`，新版本追加到时间线，`setCurrentCode(newCode)`，`setPreviewingVersion(null)`
- 点击"返回当前版本" → `setPreviewingVersion(null)`，Sandpack 恢复 `currentCode`

## 验收标准

- [ ] 每次 AI 生成后时间线自动新增节点
- [ ] 时间线显示版本号、时间、描述
- [ ] 点击历史版本能预览对应代码（右侧 iframe 切换）
- [ ] "恢复此版本"创建新版本（不可变原则）
- [ ] 当前版本高亮标记
- [ ] 版本数据持久化，刷新页面不丢失
- [ ] 预览历史版本时有明确的视觉提示（顶部 banner）
- [ ] 时间线支持水平滚动（版本多时不溢出，不影响父容器高度）
- [ ] **预览历史版本时 ChatInput disabled，防止上下文错乱**
- [ ] **`previewingVersion` 与 `currentCode` 状态严格隔离，"返回当前版本"正确清除预览态**

## 依赖

- EPIC 2（代码生成 + 预览）完成
