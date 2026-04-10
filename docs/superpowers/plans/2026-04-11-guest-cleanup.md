# Guest 用户定时清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天自动删除 5 天内无活动的 guest 用户及其全部关联数据。

**Architecture:** 新增 Vercel Cron Job，每天 UTC 02:00 调用 `/api/cron/cleanup-guests`。清理逻辑提取到 `lib/guest-cleanup.ts` 纯函数，route 仅负责鉴权和调用。级联删除依赖 Prisma `onDelete: Cascade`。

**Tech Stack:** Next.js 14 App Router, Prisma 5, Vercel Cron Jobs, Jest

---

## File Map

| 文件 | 操作 | 说明 |
|------|------|------|
| `vercel.json` | Create | Cron schedule 配置 |
| `lib/guest-cleanup.ts` | Create | 纯函数：查询 + 删除过期 guest |
| `app/api/cron/cleanup-guests/route.ts` | Create | GET handler：鉴权 + 调用 cleanup |
| `__tests__/guest-cleanup.test.ts` | Create | lib/guest-cleanup.ts 单元测试 |
| `.env.example` | Modify | 新增 CRON_SECRET 说明 |

---

## Task 1: 清理逻辑单元测试（RED）

**Files:**
- Create: `__tests__/guest-cleanup.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// __tests__/guest-cleanup.test.ts
import { deleteStaleGuestUsers } from "@/lib/guest-cleanup";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("deleteStaleGuestUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-11T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deletes guests with no activity in the past 5 days", async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: "guest_stale1" },
      { id: "guest_stale2" },
    ]);
    (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await deleteStaleGuestUsers();

    const cutoff = new Date("2026-04-06T10:00:00Z");

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isGuest: true,
        updatedAt: { lt: cutoff },
        projects: {
          none: { updatedAt: { gte: cutoff } },
        },
      },
      select: { id: true },
    });

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["guest_stale1", "guest_stale2"] } },
    });

    expect(result).toBe(2);
  });

  it("returns 0 and skips deleteMany when no stale guests found", async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    const result = await deleteStaleGuestUsers();

    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(result).toBe(0);
  });

  it("propagates errors from prisma", async () => {
    (prisma.user.findMany as jest.Mock).mockRejectedValue(
      new Error("DB connection failed")
    );

    await expect(deleteStaleGuestUsers()).rejects.toThrow("DB connection failed");
  });
});
```

- [ ] **Step 2: 运行测试确认 RED**

```bash
npm test -- --testPathPatterns="guest-cleanup"
```

期望输出：`Cannot find module '@/lib/guest-cleanup'`

---

## Task 2: 实现清理逻辑（GREEN）

**Files:**
- Create: `lib/guest-cleanup.ts`

- [ ] **Step 1: 创建 lib/guest-cleanup.ts**

```typescript
import { prisma } from "@/lib/prisma";

const STALE_DAYS = 5;

/**
 * Deletes guest users with no activity in the past STALE_DAYS days.
 * "Activity" is defined as User.updatedAt or any Project.updatedAt within the window.
 * Cascade delete removes all associated Projects, Messages, Versions, Deployments.
 * @returns number of deleted users
 */
export async function deleteStaleGuestUsers(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);

  const staleGuests = await prisma.user.findMany({
    where: {
      isGuest: true,
      updatedAt: { lt: cutoff },
      projects: {
        none: { updatedAt: { gte: cutoff } },
      },
    },
    select: { id: true },
  });

  if (staleGuests.length === 0) return 0;

  const ids = staleGuests.map((u) => u.id);
  const { count } = await prisma.user.deleteMany({
    where: { id: { in: ids } },
  });

  return count;
}
```

- [ ] **Step 2: 运行测试确认 GREEN**

```bash
npm test -- --testPathPatterns="guest-cleanup"
```

期望输出：`3 passed`

- [ ] **Step 3: Commit**

```bash
git add lib/guest-cleanup.ts __tests__/guest-cleanup.test.ts
git commit -m "feat: add deleteStaleGuestUsers with tests"
```

---

## Task 3: Cron API Route

**Files:**
- Create: `app/api/cron/cleanup-guests/route.ts`

- [ ] **Step 1: 创建 route 文件**

```typescript
import { NextResponse } from "next/server";
import { deleteStaleGuestUsers } from "@/lib/guest-cleanup";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteStaleGuestUsers();
    console.log(`[cron/cleanup-guests] deleted ${deleted} stale guest users`);
    return NextResponse.json({ deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cron/cleanup-guests] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 本地验证（需先启动 dev server）**

在 `.env.local` 中确认有：
```
CRON_SECRET=dev-secret
```

```bash
curl -s http://localhost:3000/api/cron/cleanup-guests \
  -H "Authorization: Bearer dev-secret" | jq .
```

期望输出：`{ "deleted": 0 }` 或 `{ "deleted": N }`

- [ ] **Step 3: 验证鉴权拒绝**

```bash
curl -s http://localhost:3000/api/cron/cleanup-guests | jq .
```

期望输出：`{ "error": "Unauthorized" }` 状态码 `401`

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/cleanup-guests/route.ts
git commit -m "feat: add /api/cron/cleanup-guests route with bearer auth"
```

---

## Task 4: Vercel Cron 配置

**Files:**
- Create: `vercel.json`
- Modify: `.env.example`

- [ ] **Step 1: 创建 vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup-guests",
      "schedule": "0 2 * * *"
    }
  ]
}
```

- [ ] **Step 2: 更新 .env.example**

在 `.env.example` 末尾新增：

```
# Cron job secret — set in Vercel Environment Variables
# Used to authenticate /api/cron/cleanup-guests
CRON_SECRET=
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json .env.example
git commit -m "feat: configure Vercel cron job for guest cleanup"
```

---

## Task 5: 全量测试 & 最终验证

- [ ] **Step 1: 运行全部 Jest 测试**

```bash
npm test
```

期望：所有测试通过，无新增失败

- [ ] **Step 2: 检查覆盖率**

```bash
npm run test:coverage 2>/dev/null | grep -E "guest-cleanup|All files"
```

期望：`lib/guest-cleanup.ts` 覆盖率 ≥ 80%

- [ ] **Step 3: 运行 lint**

```bash
npm run lint
```

期望：无 lint 错误
