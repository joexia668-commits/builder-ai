# Guest 用户定时清理 — 设计文档

**日期:** 2026-04-11  
**状态:** 已批准

## 背景

每个访客登录会在 `User` 表里创建一条 `isGuest: true` 的持久化记录。没有清理机制会导致长期积累僵尸记录。

## 目标

自动删除 5 天内无活动的 guest 用户及其所有关联数据。

## 范围外

- 不清理 GitHub OAuth 用户
- 不做软删除或归档
- 不发通知（guest 无 email）

---

## 方案：Vercel Cron Job

### 触发机制

新增 `vercel.json`，每天 UTC 02:00 触发：

```json
{
  "crons": [
    { "path": "/api/cron/cleanup-guests", "schedule": "0 2 * * *" }
  ]
}
```

鉴权：`Authorization: Bearer <CRON_SECRET>`，Vercel 调度器自动注入 header。

### 新增文件

| 文件 | 说明 |
|------|------|
| `vercel.json` | Cron schedule 配置 |
| `app/api/cron/cleanup-guests/route.ts` | Cleanup API route |
| `lib/guest-cleanup.ts` | 清理逻辑（纯函数，便于测试） |
| `__tests__/guest-cleanup.test.ts` | 单元测试 |

### 清理逻辑

"活动"定义：`User.updatedAt` 与该用户最新 `Project.updatedAt` 中的较大值。两者均超过 5 天视为不活跃。

```
cutoff = now - 5 days

staleGuests = User.findMany({
  where: {
    isGuest: true,
    updatedAt: { lt: cutoff },
    projects: {
      none: { updatedAt: { gte: cutoff } }
    }
  }
})

User.deleteMany({ id: { in: staleGuestIds } })
```

级联删除依赖 Prisma schema 的 `onDelete: Cascade`：删 `User` 自动删除 `Project → Message / Version / Deployment`。

### 安全

- `CRON_SECRET` 存为环境变量，route 校验 `Authorization: Bearer` header
- 不匹配返回 `401`
- `CRON_SECRET` 未配置时 route 永远返回 `401`（安全 fallback，不 crash）

### 错误处理

| 情况 | 行为 |
|------|------|
| DB 查询失败 | 返回 `500 { error: "..." }`，Vercel 记录日志 |
| 删除 0 条 | 返回 `200 { deleted: 0 }`，正常 |
| 鉴权失败 | 返回 `401` |

### 响应格式

```json
{ "deleted": 12 }
```

---

## 环境变量

```
CRON_SECRET=<random-secret>   # 新增，Vercel 环境变量中配置
```

## 本地测试

```bash
# .env.local 中设置 CRON_SECRET=dev-secret
curl -X GET http://localhost:3000/api/cron/cleanup-guests \
  -H "Authorization: Bearer dev-secret"
```
