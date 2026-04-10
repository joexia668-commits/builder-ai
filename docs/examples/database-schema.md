# Database Schema

数据库使用 Supabase（PostgreSQL 15），通过 Prisma ORM 管理 schema。Schema 定义见 `prisma/schema.prisma`。

## 设计原则

- **版本不可变**：Version 表只 INSERT，不 UPDATE/DELETE。回滚 = 读取旧版本文件 → INSERT 新版本记录，完整保留历史时间线。
- **模型偏好双层覆盖**：User 持有全局偏好，Project 持有项目级偏好，项目级优先于全局。
- **Guest 持久化**：Guest 登录在 DB 中创建真实 User 记录，刷新后数据不丢失。

## 表结构

```
User
  ├── id              String    @id (cuid)
  ├── name            String?
  ├── email           String?   @unique
  ├── image           String?
  ├── isGuest         Boolean   @default(false)   ← Guest 匿名账户标记
  ├── preferredModel  String?                      ← 全局模型偏好
  ├── createdAt       DateTime
  ├── updatedAt       DateTime
  ├── Account[]                                    ← NextAuth OAuth
  ├── Session[]                                    ← NextAuth Session
  └── Project[]

Project
  ├── id              String    @id (cuid)
  ├── name            String
  ├── description     String?
  ├── preferredModel  String?                      ← 项目级模型覆盖（优先于 User.preferredModel）
  ├── userId          String    → User
  ├── createdAt       DateTime
  ├── updatedAt       DateTime
  ├── Version[]
  └── Message[]

Version                                            ← 不可变，只 INSERT
  ├── id              String    @id (cuid)
  ├── code            String?                      ← 单文件遗留字段（旧版本）
  ├── files           Json?                        ← 多文件 Record<string,string>（新版本写此字段）
  ├── versionNumber   Int                          ← 项目内自增，unique([projectId, versionNumber])
  ├── description     String?                      ← 生成时 prompt 的前 80 字符
  ├── agentMessages   Json?                        ← 保留字段
  ├── createdAt       DateTime
  └── projectId       String    → Project

Message
  ├── id              String    @id (cuid)
  ├── role            String                       ← "user" | "pm" | "architect" | "engineer"
  ├── content         String
  ├── metadata        Json?                        ← { agentName?, agentColor? }
  ├── createdAt       DateTime
  └── projectId       String    → Project

DynamicAppData                                     ← 生成应用的运行时数据
  ├── id              String    @id (uuid)
  ├── appId           String                       ← = projectId
  ├── key             String
  ├── data            Json                         ← JSONB，任意结构
  ├── createdAt       DateTime
  ├── updatedAt       DateTime
  └── @@unique([appId, key])
```

## 版本读取兼容性

`lib/version-files.ts` 的 `getVersionFiles(version)` 提供统一读取接口：

- 新版本（`files` 字段存在）→ 直接返回 `Record<string, string>`
- 老版本（只有 `code` 字段）→ 包装为 `{ "/App.js": code }`

UI 层无感知历史数据格式差异。

## 连接配置

```env
DATABASE_URL="postgresql://..."   # Transaction Mode，端口 6543，连接池，供应用使用
DIRECT_URL="postgresql://..."     # Direct Connection，端口 5432，供 prisma db push 使用
```

使用 `PrismaPg` Driver Adapter 替代内置连接器，适配 Supabase Transaction Mode 的连接池限制（max=3），避免 Serverless 场景下连接泄漏。
