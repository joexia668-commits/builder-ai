# Production Deploy Design

> BuilderAI 生成的 app 从 Sandpack 预览到真实生产部署。

## 问题

生成的 React app 目前只能在 Sandpack 沙盒里运行。用户无法把它部署到真实 URL，无法分享，无法作为独立产品使用。

## 目标

1. **一键托管**：用户点击 Deploy，平台自动部署到 Vercel，返回可访问的 URL
2. **导出项目**：用户下载完整 Next.js 项目 zip，自行部署到任何平台
3. **轻量 Backend**：生成的 app 支持 `pages/api/` API routes（按需）
4. **数据隔离**：托管版使用平台 Supabase + RLS；导出版用户自备 Supabase

## 架构总览

```
用户输入 prompt
    ↓
PM → Architect → Engineer × N（现有流水线，不变）
    ↓
Sandpack 实时预览（现有，不变）
    ↓
用户点击 Deploy 或 Export
         ↙                    ↘
   [Deploy]                [Export]
   平台机械转换              平台机械转换
   → Next.js 项目结构        → Next.js 项目结构
   → 调用 Vercel Deploy API  → zip 打包下载
   → 返回部署 URL
   → 保存 Deployment 记录
```

## 生成物技术栈

| 层 | 技术 |
|----|------|
| 框架 | Next.js 14（Pages Router） |
| 语言 | TypeScript（宽松 tsconfig，strict: false） |
| 样式 | Tailwind CSS（PostCSS 插件） |
| 组件库 | shadcn/ui + lucide-react |
| Backend | `pages/api/*.ts`（按需，PM 识别需求时生成） |
| 数据库 | @supabase/supabase-js |
| 部署目标 | Vercel（平台账户） |

**为什么 Next.js Pages Router 而非 App Router / Vite：**
- Vercel 原生支持 Next.js，零配置部署
- Pages Router 规则更简单，AI 生成出错率低
- `pages/api/` 是原生 API routes，无需额外配置
- AI 训练数据覆盖 Pages Router 更广

**为什么 shadcn/ui：**
- 预装组件库让 AI 生成的 UI 质量更高
- Button、Card、Dialog、Input 等组件开箱即用
- BuilderAI 平台自身使用 shadcn/ui，AI 对此栈最熟悉

## Section 1：生成格式（Sandpack → Next.js 转换）

### 两层架构

Sandpack 无法运行 Next.js（需要服务端运行时），因此 preview 和 deploy 采用不同格式：

| 阶段 | 格式 | 渲染方式 |
|------|------|----------|
| 生成预览 | Sandpack React 格式（现状不变） | 浏览器内 Sandpack |
| 部署 / 导出 | 平台机械转换 → Next.js 项目 | Vercel 构建运行 |

**AI 生成逻辑不变。** 平台在 Deploy / Export 时做机械文件映射：

| Sandpack 路径 | Next.js 路径 |
|--------------|-------------|
| `/App.tsx` | `pages/index.tsx` |
| `/components/*.tsx` | `components/*.tsx` |
| `/hooks/*.ts` | `hooks/*.ts` |
| `/lib/*.ts` | `lib/*.ts` |
| `/types/*.ts` | `types/*.ts` |

### 完整目录结构（生成物）

```
my-app/
│
├── pages/
│   ├── _app.tsx                 ★ 平台模板
│   ├── _document.tsx            ★ 平台模板
│   ├── index.tsx                ✦ AI 生成（由 /App.tsx 转换）
│   └── api/                     ✦ AI 生成（按需）
│       └── [route].ts
│
├── components/
│   ├── ui/                      ★ shadcn/ui 全套（平台预装）
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   └── ...
│   └── [AppComponents].tsx      ✦ AI 生成
│
├── hooks/                       ✦ AI 生成
│   └── use-[xxx].ts
│
├── lib/
│   ├── supabase.ts              ★ 平台注入（hosted: 真实 key；export: 占位符）
│   ├── utils.ts                 ★ 平台模板（shadcn cn() 工具函数）
│   └── [utils].ts               ✦ AI 生成
│
├── styles/
│   └── globals.css              ★ 平台模板（Tailwind + shadcn CSS 变量）
│
├── types/                       ✦ AI 生成（可选）
│   └── index.ts
│
├── next.config.js               ★ 平台模板
├── tailwind.config.js           ★ 平台模板
├── postcss.config.js            ★ 平台模板
├── tsconfig.json                ★ 平台模板（strict: false, skipLibCheck: true）
├── package.json                 ★ 平台模板（固定依赖集）
├── .env.local                   ★ hosted: 真实 key；export: 不含此文件
└── .env.example                 ★ 平台模板
```

`★` = 平台固定模板　　`✦` = AI 生成

### Backend API Routes（按需）

PM agent 输出 `PmOutput.persistence` 字段。当需要服务端逻辑时（如操作 Supabase service role key、第三方 API 代理），在 Deploy 前额外触发一次 Engineer 生成 `pages/api/` 文件。

纯前端 app（绝大多数）跳过此步骤。

## Section 2：Vercel Deploy API 集成

### 部署流程

```
用户点击 Deploy
    ↓
POST /api/deploy { projectId, versionId }
    ↓
project-assembler: 合并平台模板 + Version.files（机械转换）
    ↓
vercel-deploy: POST https://api.vercel.com/v13/deployments
    ↓
轮询 deployment 状态（SSE 推送进度给前端）
    ↓
status: ready → 返回 URL，写入 Deployment 表
status: error → 返回错误信息
```

### Vercel 项目映射

- 每个 BuilderAI project → 一个 Vercel project（首次部署时创建，`vercelProjectId` 写入 DB）
- 每次部署 → 该 project 下的新 deployment
- 通过 Vercel alias 让同一个 URL 始终指向最新部署（`{userId-slug}-{project-slug}.vercel.app`，确保全平台唯一）

### Token 策略

使用平台级 `VERCEL_TOKEN`（env var），所有用户的部署在平台 Vercel 账户下。用户无需自己的 Vercel 账号（MVP 阶段）。

### 数据模型

```prisma
model Deployment {
  id              String   @id @default(cuid())
  projectId       String
  versionId       String
  vercelProjectId String
  vercelDeployId  String
  url             String
  status          String   // building | ready | error
  createdAt       DateTime @default(now())
  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  version         Version  @relation(fields: [versionId], references: [id])
}
```

### UI 变化

Preview 面板工具栏新增按钮：

```
[预览]  [代码]  |  [Deploy ↗]  [Export ↓]
```

Deploy 状态流：
1. 点击 → 按钮变 "构建中..." + spinner
2. 成功 → 按钮变 "已部署 ↗"，工具栏显示可点击 URL
3. 失败 → toast 错误提示，按钮恢复可重试

URL 持久化：下次打开项目仍显示上次部署 URL。

## Section 3：Export（zip 下载）

### 流程

```
用户点击 Export ↓
    ↓
GET /api/export?projectId=xxx&versionId=xxx
    ↓
project-assembler: 合并平台模板 + Version.files（机械转换）
lib/supabase.ts 替换为占位符版本
    ↓
zip-exporter: 打包所有文件
    ↓
浏览器触发下载 my-app.zip
```

### 导出后用户操作

```bash
unzip my-app.zip && cd my-app
npm install
cp .env.example .env.local   # 填入自己的 Supabase URL 和 anon key
npm run dev                   # 本地运行
# 或
npx vercel deploy             # 部署到自己的 Vercel
```

## Section 4：数据隔离

| 场景 | Supabase | 数据归属 |
|------|----------|---------|
| 平台托管（Deploy） | 平台 Supabase + RLS，按 `appId` 隔离 | 平台数据库 |
| 用户导出（Export） | 用户自己的 Supabase | 用户完全掌控 |

托管版 RLS：MVP 阶段沿用现有 `DynamicAppData` 表 + `appId` 字段隔离方案，不新增 per-app Supabase project。

## 新增平台文件

```
lib/project-assembler.ts    # 合并模板 + AI 文件，输出 Next.js 结构
lib/vercel-deploy.ts        # Vercel Deploy API 封装
lib/zip-exporter.ts         # zip 打包
app/api/deploy/route.ts     # Deploy 端点
app/api/export/route.ts     # Export 端点
templates/nextjs/           # 平台模板文件目录
```

## 实施阶段

| 阶段 | 内容 | 价值 |
|------|------|------|
| **P1** | Export zip | 零 Vercel 依赖，立即验证格式正确性 |
| **P2** | Deploy 到 Vercel | 一键托管，主功能上线 |
| **P3** | Backend API routes 生成 | 支持有服务端逻辑的 app |
| **P4** | 历史部署查看 + 版本回滚 | 完整部署管理体验 |

## 不在范围内（MVP）

- 自定义域名
- 每个 app 独立 Supabase project
- 非 React 框架（Vue、Svelte 等）
- 团队协作 / 多人编辑
- 付费 / 用量计费
