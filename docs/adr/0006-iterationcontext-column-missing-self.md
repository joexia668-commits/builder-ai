# ADR 0006 — 生产库缺少 iterationContext 列导致 P2022

**日期**: 2026-04-13  
**背景**: Claude 自发现（-self）；部署到 Vercel 后首页报 500，Vercel 日志中出现 Prisma P2022 错误

---

## 问题描述

Vercel 生产环境所有页面请求报 500，日志：

```
PrismaClientKnownRequestError:
Invalid `prisma.project.findMany()` invocation:
The column `Project.iterationContext` does not exist in the current database.
code: 'P2022'
```

---

## 根因

`prisma/schema.prisma` 中新增了 `iterationContext Json?` 字段，本地执行过 `npx prisma db push` 同步到了本地库，但生产 Supabase 数据库未同步，导致 Prisma Client 查询时找不到该列。

---

## 为什么本地没暴露

`.env.local` 优先级高于 `.env`（Next.js 约定），本地直接运行 `npx prisma db push` 会命中 `.env.local` 中的本地数据库（`localhost:5432`），而不是 `.env` 中的 Supabase 生产库，因此本地同步成功但生产库未更新。

---

## 修复

显式指定生产库 URL 执行 `db push`：

```bash
DATABASE_URL="<.env 中的 Supabase 连接串>" npx prisma db push
```

无需重新部署，加列后请求立即恢复正常。

---

## 预防措施

- 新增 schema 字段后，除本地 `db push` 外，必须单独对生产库执行一次带显式 `DATABASE_URL` 的 `db push`
- 可在部署 checklist 中加一项：schema 有变更时，先同步生产库，再推代码
