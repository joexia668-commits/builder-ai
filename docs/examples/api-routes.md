# API Routes

所有 API 路由位于 `app/api/`。前端通过 `lib/api-client.ts` 的 `fetchAPI()` / `fetchSSE()` 统一调用，禁止在组件中直接使用 `fetch('/api/...')`。

## 路由总览

| Method | Path | 说明 |
|--------|------|------|
| `GET` `POST` | `/api/projects` | 项目列表 / 创建项目 |
| `GET` `PATCH` `DELETE` | `/api/projects/[id]` | 项目详情 / 更新（名称、preferredModel）/ 删除 |
| `POST` | `/api/generate` | SSE 流式 AI 生成（Edge Runtime，maxDuration=300s） |
| `GET` `POST` | `/api/messages` | 消息列表（按项目）/ 保存消息 |
| `GET` `POST` | `/api/versions` | 版本列表（按项目）/ 创建版本快照 |
| `POST` | `/api/versions/[id]/restore` | 回滚到指定版本（INSERT 新版本记录，不覆盖历史） |
| `GET` `PATCH` | `/api/user/preferences` | 用户全局模型偏好读写 |
| `*` | `/api/auth/[...nextauth]` | NextAuth GitHub OAuth 路由 |
| `POST` | `/api/auth/guest` | Guest 匿名登录（创建持久化 User 记录） |
| `GET` | `/api/export` | 导出项目为 Next.js ZIP 包（模板 + AI 生成文件合并） |
| `POST` | `/api/deploy` | 触发 Vercel 部署（返回 deploymentId） |
| `GET` | `/api/deploy/[id]` | 轮询部署状态 |

## 认证说明

- `/api/generate` 使用 `getToken`（next-auth/jwt）—— 兼容 Edge Runtime
- 其他所有路由使用 `getServerSession`（Node.js runtime）
- 错误响应格式统一为 `{ error: string, details?: unknown }`

## /api/generate 请求体

```typescript
{
  projectId: string;
  prompt: string;
  agent: "pm" | "architect" | "engineer";
  context?: string;        // 上下文（PM 的 PRD、Architect 的 Scaffold 等）
  modelId?: string;        // 可选，覆盖默认模型
  targetFiles?: Array<{    // Engineer 多文件时指定目标文件列表
    path: string;
    description: string;
    exports: string[];
    deps: string[];
    hints: string;
  }>;
}
```
