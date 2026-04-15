# Database Schema

数据库使用 Supabase（PostgreSQL 15），通过 Prisma ORM 管理 schema。Schema 定义见 `prisma/schema.prisma`。

## 设计原则

- **版本不可变**：Version 表只 INSERT，不 UPDATE/DELETE。回滚 = 读取旧版本文件 → INSERT 新版本记录，完整保留历史时间线。
- **模型偏好双层覆盖**：User 持有全局偏好，Project 持有项目级偏好，项目级优先于全局。
- **Guest 持久化**：Guest 登录在 DB 中创建真实 User 记录，刷新后数据不丢失。
- **部署追踪**：Deployment 记录关联 Version，可追溯每次部署使用的版本。
- **版本血缘追踪**：Version 通过 `parentVersionId` 自引用关系记录版本来源，restore 时写入；`changedFiles` 记录版本间文件变更；`iterationSnapshot` 保存创建时的迭代上下文副本，确保 restore 后上下文一致。

## 表结构

```
User
  ├── id              String    @id (cuid)
  ├── name            String?
  ├── email           String?   @unique
  ├── emailVerified   DateTime?
  ├── image           String?
  ├── isGuest         Boolean   @default(false)   ← Guest 匿名账户标记
  ├── isDemoViewer    Boolean   @default(false)   ← Demo 只读账户标记
  ├── preferredModel  String?                     ← 全局模型偏好
  ├── createdAt       DateTime
  ├── updatedAt       DateTime
  ├── Account[]                                   ← NextAuth OAuth
  ├── Session[]                                   ← NextAuth Session
  └── Project[]

Project
  ├── id               String    @id (cuid)
  ├── name             String
  ├── description      String?
  ├── userId           String    → User
  ├── preferredModel   String?                    ← 项目级模型覆盖（优先于 User.preferredModel）
  ├── iterationContext Json?                      ← FIFO-5 迭代历史（{ rounds[] }），持久化最近 5 轮生成摘要
  ├── createdAt        DateTime
  ├── updatedAt        DateTime
  ├── Version[]
  ├── Message[]
  └── Deployment[]

Version                                           ← 不可变，只 INSERT
  ├── id                String    @id (cuid)
  ├── projectId         String    → Project
  ├── versionNumber     Int                       ← 项目内自增，@@unique([projectId, versionNumber])
  ├── code              String                    ← 单文件遗留字段（旧版本；新版本写 files，此字段为空字符串）
  ├── files             Json?                     ← 多文件 Record<string,string>（新版本写此字段）
  ├── description       String?                   ← 生成时 prompt 的前 80 字符
  ├── agentMessages     Json?                     ← 保留字段
  ├── createdAt         DateTime
  ├── parentVersionId   String?                   ← 版本血缘：指向来源版本（restore 时写入）
  ├── parentVersion     Version?  @relation        ← 自引用关系（VersionLineage）
  ├── childVersions     Version[] @relation        ← 反向引用：由此版本 restore 出的子版本
  ├── changedFiles      Json?                     ← 版本间变更文件列表（computeChangedFiles 计算）
  └── iterationSnapshot Json?                     ← 创建时的迭代上下文快照（FIFO-5 rounds 副本）

Message
  ├── id        String    @id (cuid)
  ├── projectId String    → Project
  ├── role      String                            ← "user" | "pm" | "architect" | "engineer"
  ├── content   String
  ├── metadata  Json?                             ← { agentName?, agentColor? }
  └── createdAt DateTime

DynamicAppData                                    ← 生成应用的运行时数据（由 Sandpack 内代码写入）
  ├── id        String    @id (uuid)
  ├── appId     String                            ← = projectId
  ├── key       String
  ├── data      Json                              ← JSONB，任意结构
  ├── createdAt DateTime
  ├── updatedAt DateTime
  ├── @@unique([appId, key])
  └── @@index([appId])

VerificationToken                                 ← NextAuth Email Magic Link 验证令牌
  ├── identifier  String
  ├── token       String    @unique
  ├── expires     DateTime
  └── @@unique([identifier, token])

Deployment                                        ← Vercel 部署记录
  ├── id              String    @id (cuid)
  ├── projectId       String    → Project
  ├── versionId       String                      ← 关联部署所用的 Version id
  ├── vercelProjectId String                      ← Vercel 项目 ID
  ├── vercelDeployId  String                      ← Vercel 部署 ID
  ├── url             String                      ← 部署 URL
  ├── status          String                      ← "building" | "ready" | "error"
  └── createdAt       DateTime
```

## 版本读取兼容性

`lib/version-files.ts` 的 `getVersionFiles(version)` 提供统一读取接口：

- 新版本（`files` 字段存在）→ 直接返回 `Record<string, string>`
- 旧版本（只有 `code` 字段）→ 包装为 `{ "/App.js": code }`

UI 层无感知历史数据格式差异。

## iterationContext 字段说明

`Project.iterationContext` 存储 FIFO 最近 5 轮生成的上下文摘要，结构为：

```typescript
{
  rounds: Array<{
    userPrompt: string;      // 用户原始输入
    intent: string;          // 分类意图
    pmSummary?: string;      // PM 生成的需求摘要
    archDecisions?: string;  // 从 ScaffoldData 提取的架构决策
  }>
}
```

每次生成完成后异步 PATCH 到 `/api/projects/[id]`，页面刷新后上下文不丢失。架构上下文在运行时通过 `deriveArchFromFiles()` 从现有文件动态重建，不依赖此字段存储。

## 连接配置

```env
DATABASE_URL="postgresql://...:6543/postgres"   # Supavisor pooler，transaction mode
                                                # 必须用 6543，Vercel Lambda 冻结-解冻时
                                                # session mode (5432) 会产生 stale socket
DIRECT_URL="postgresql://...:5432/postgres"     # 直连，仅用于 prisma db push / migrate
```

Prisma `schema.prisma` 中配置双 URL：

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

运行时走 `DATABASE_URL`（pooler），schema 变更走 `DIRECT_URL`（direct connection）。Prisma client 通过 `$extends` 对瞬态连接错误（`Connection terminated`、`ECONNRESET`）做指数退避重试（100→200→400ms），Supavisor 冷启动抖动对用户无感知。
