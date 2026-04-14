# API 路由参考

所有 API 路由位于 `app/api/`。前端通过 `lib/api-client.ts` 的 `fetchAPI()` / `fetchSSE()` 统一调用，禁止在组件中直接使用 `fetch('/api/...')`。

## 路由总览

| Method | Path | Runtime | 说明 |
|--------|------|---------|------|
| `POST` | `/api/generate` | Edge | SSE 流式 AI 生成（maxDuration=300s） |
| `GET` `POST` | `/api/projects` | Node | 项目列表 / 创建项目 |
| `GET` `PATCH` `DELETE` | `/api/projects/[id]` | Node | 项目详情 / 更新（名称、preferredModel）/ 删除 |
| `GET` `POST` | `/api/messages` | Node | 消息列表（按项目）/ 保存消息 |
| `GET` `POST` | `/api/versions` | Node | 版本列表（按项目）/ 创建版本快照 |
| `POST` | `/api/versions/[id]/restore` | Node | 回滚到指定版本（INSERT 新版本记录，不覆盖历史） |
| `GET` `PATCH` | `/api/user/preferences` | Node | 用户全局模型偏好读写 |
| `POST` | `/api/deploy` | Node | 触发 Vercel 部署，返回 deploymentId |
| `GET` | `/api/deploy/[id]` | Node | 轮询部署状态 |
| `GET` | `/api/export` | Node | 导出项目为 Next.js ZIP 包 |
| `*` | `/api/auth/[...nextauth]` | Node | NextAuth GitHub OAuth 路由 |
| `POST` | `/api/auth/guest` | Node | Guest 匿名登录（创建或查找持久化 User 记录） |
| `GET` | `/api/cron/cleanup-guests` | Node | 清理 >5 天未活跃 Guest 账户 |

## 认证说明

- `/api/generate` 使用 `getToken`（next-auth/jwt）—— 兼容 Edge Runtime
- 其他所有路由使用 `getServerSession`（Node.js runtime）
- 错误响应格式统一为 `{ error: string, details?: unknown }`
- Demo 用户对 `/api/deploy` 和 `/api/export` 返回 403

## /api/generate

**POST /api/generate** — SSE 流式生成，Edge Runtime，maxDuration=300s

请求体：
```typescript
{
  projectId: string;
  prompt: string;
  agent: "pm" | "architect" | "engineer";
  context?: string;           // Agent 上下文（PM 的 PRD、Architect 的 Scaffold 等）
  modelId?: string;           // 可选，覆盖默认模型
  targetFiles?: Array<{       // Engineer 多文件时指定目标文件
    path: string;
    description: string;
    exports: string[];
    deps: string[];
    hints: string;
  }>;
  partialMultiFile?: boolean; // Engineer 补全请求（接受任意 FILE 块）
  triageMode?: boolean;       // 轻量 triage：识别受影响文件
}
```

SSE 事件流：
```
data: {"type":"thinking","content":"..."}
data: {"type":"chunk","content":"..."}
data: {"type":"file_start","path":"/components/Header.js"}
data: {"type":"file_chunk","path":"/components/Header.js","delta":"..."}
data: {"type":"file_end","path":"/components/Header.js"}
data: {"type":"code_complete","code":"..."}
data: {"type":"files_complete","files":{...}}
data: {"type":"partial_files_complete","files":{...},"failed":[...],"truncatedTail":"..."}
data: {"type":"error","error":"...","errorCode":"rate_limited|parse_failed|..."}
data: {"type":"done"}
```

## /api/deploy

**POST /api/deploy** — 触发 Vercel 部署

请求体：`{ projectId: string, versionId?: string }`

省略 `versionId` 时默认使用最新版本。

响应（202）：`{ deploymentId: string, status: "building", url: string }`

---

**GET /api/deploy/[id]** — 轮询部署状态

响应：`{ status: "ready" | "error" | "building", url?: string }`

## /api/export

**GET /api/export?projectId=...&versionId=...** — 下载 ZIP

省略 `versionId` 时默认使用最新版本。

响应：`Content-Type: application/zip`，文件名为项目名称（kebab-case）。

包含完整 Next.js 项目（AI 生成代码 + 模板文件合并）。Supabase 连接使用 env var 格式（非 hardcode credentials）。

版本无生成文件时返回 422。

## /api/versions/[id]/restore

**POST /api/versions/[id]/restore** — 回滚版本

回滚 = 读取目标版本 files → INSERT 新版本记录（递增 versionNumber），不修改历史数据。

响应：`{ version: { id, versionNumber, files, createdAt } }`

## /api/user/preferences

**GET /api/user/preferences** — 读取用户全局模型偏好

响应：`{ preferredModel: string | null }`

**PATCH /api/user/preferences** — 更新用户全局模型偏好

请求体：`{ preferredModel: string }`

响应：`{ preferredModel: string }`

## /api/auth/guest

**POST /api/auth/guest** — Guest 匿名登录

系统用固定格式邮箱（`guest-<uuid>@builder-ai.local`）在 DB 中创建或查找持久化 User 记录，刷新后数据不丢失。

响应：NextAuth session token（通过 `signIn` 流程完成）

## /api/cron/cleanup-guests

**GET /api/cron/cleanup-guests** — 清理不活跃 Guest 账户

删除 `isGuest=true` 且超过 5 天未活跃的 User 记录（级联删除关联 Project / Message / Version）。

建议通过 Vercel Cron Jobs 每日触发。
