# BuilderAI — Project Structure

```
builder-ai/
├── app/
│   ├── layout.tsx                      # Root layout (providers, fonts, metadata)
│   ├── page.tsx                        # Home: project list (authed) or landing (unauthed)
│   ├── globals.css                     # Tailwind base imports
│   │
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts # NextAuth handler
│   │   ├── generate/route.ts           # SSE: AI generation (per-agent)
│   │   ├── projects/
│   │   │   ├── route.ts                # GET (list) / POST (create)
│   │   │   └── [id]/route.ts           # GET (detail) / PATCH (update) / DELETE
│   │   ├── messages/route.ts           # GET (by project) / POST (save)
│   │   ├── versions/
│   │   │   ├── route.ts                # GET (by project) / POST (create)
│   │   │   └── [id]/
│   │   │       └── restore/route.ts    # POST (restore version)
│   │   ├── user/
│   │   │   └── preferences/route.ts    # GET/PATCH: 用户全局模型偏好
│   │   ├── deploy/
│   │   │   ├── route.ts                # POST: 触发 Vercel 部署（返回 deploymentId）
│   │   │   └── [id]/route.ts           # GET: 轮询部署状态
│   │   ├── export/
│   │   │   └── route.ts                # GET: 导出项目为 ZIP 包
│   │   └── cron/
│   │       └── cleanup-guests/route.ts # Cron: 清理过期 Guest 账户（>5 天未活跃）
│   │
│   └── project/
│       └── [id]/
│           └── page.tsx                # Workspace: Agent panel + Chat + Preview
│
├── components/
│   ├── ui/                             # shadcn/ui components (auto-generated)
│   │
│   ├── layout/
│   │   ├── header.tsx                  # Top nav: logo, user avatar, sign out
│   │   ├── auth-guard.tsx              # Redirect to login if not authed
│   │   ├── demo-banner.tsx             # Demo mode indicator (amber bg, read-only notice)
│   │   ├── demo-login-button.tsx       # Quick-login for demo viewer account
│   │   └── email-login-form.tsx        # Email Magic Link form (unified sign-in/sign-up)
│   │
│   ├── home/
│   │   ├── project-card.tsx            # Project list card
│   │   └── create-project-dialog.tsx   # New project modal
│   │
│   ├── workspace/
│   │   ├── workspace.tsx               # Main 3-column layout
│   │   ├── chat-input.tsx              # Bottom input bar
│   │   └── chat-area.tsx               # Message list with auto-scroll
│   │
│   ├── sidebar/
│   │   ├── conversation-sidebar.tsx    # Left sidebar: project list + new project button
│   │   └── project-item.tsx            # Individual project row (name, preview, time)
│   │
│   ├── agent/
│   │   ├── agent-status-bar.tsx        # Top horizontal agent status cards (inline in chat)
│   │   ├── agent-card.tsx              # Individual agent status card (horizontal)
│   │   ├── agent-message.tsx           # Chat bubble with avatar + role
│   │   └── thinking-indicator.tsx      # Typing dots animation
│   │
│   ├── preview/
│   │   ├── preview-panel.tsx           # Right panel: toolbar + tabs（Preview/Code/Activity）
│   │   ├── preview-frame.tsx           # Sandpack iframe 渲染
│   │   ├── file-tree-code-viewer.tsx   # 文件树 + 代码查看（含流式状态指示）
│   │   ├── code-editor.tsx             # Monaco Editor（可编辑，触发预览刷新）
│   │   ├── multi-file-editor.tsx       # 多文件标签管理
│   │   ├── file-block.tsx              # 单文件展示块
│   │   ├── activity-panel.tsx          # 生成活动实时日志面板
│   │   ├── device-selector.tsx         # Desktop/Tablet/Mobile 切换
│   │   ├── error-boundary.tsx          # 预览错误边界
│   │   └── walking-cat.tsx             # 加载动画（装饰性）
│   │
│   └── timeline/
│       ├── version-timeline.tsx        # Horizontal timeline at bottom
│       ├── version-node.tsx            # Individual version dot
│       └── version-detail-popover.tsx  # Click-to-show version info
│
├── hooks/
│   ├── use-generation-session.ts   # useSyncExternalStore 订阅生成会话状态
│   ├── use-auto-scroll-to-bottom.ts # 消息列表自动滚动
│   └── use-mounted.ts              # Hydration 安全检查（防 SSR 闪烁）
│
├── lib/
│   ├── api-client.ts                   # fetchAPI() / fetchSSE() — CRITICAL abstraction
│   ├── ai-provider.ts                  # Gemini/Groq abstraction + streaming
│   ├── agents.ts                       # Agent definitions (roles, prompts, colors)
│   ├── code-renderer.ts               # CodeRenderer interface + HtmlRenderer
│   ├── auth.ts                         # NextAuth configuration (GitHub, Email, Demo)
│   ├── resend.ts                       # Resend email service singleton
│   ├── demo-bootstrap.ts               # Auto-create demo viewer account on startup
│   ├── prisma.ts                       # Prisma client singleton
│   ├── types.ts                        # Shared TypeScript types
│   ├── model-registry.ts          # 模型定义注册表 + 可用性检测（基于 env var）
│   ├── generation-session.ts      # 生成状态内存 pub-sub 存储（驱动实时 UI）
│   ├── engineer-stream-tap.ts     # SSE 流 FILE 标记解析 → file_start/chunk/end 事件
│   ├── coalesce-chunks.ts         # 合并同文件连续 file_chunk 事件
│   ├── project-assembler.ts       # Sandpack 文件 + Next.js 模板合并（export/deploy）
│   ├── vercel-deploy.ts           # Vercel 部署 API 集成
│   ├── zip-exporter.ts            # ZIP 打包导出
│   ├── file-tree.ts               # 平铺路径 → 层级文件树
│   ├── guest-cleanup.ts           # Guest 账户定期清理（>5 天）
│   ├── extract-json.ts            # LLM 输出 JSON 安全提取
│   └── extract-arch-decisions.ts  # 从 ScaffoldData 提取架构决策摘要
│
├── prisma/
│   └── schema.prisma                   # Database schema
│
├── public/
│   └── favicon.ico
│
├── .env.local                          # Local env vars (git-ignored)
├── .env.example                        # Template for env vars
├── .gitignore
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Directory Rules

| Directory | Rule |
|-----------|------|
| `app/api/` | API routes only. No UI logic. Each route file < 100 lines. |
| `components/` | Organized by feature domain, not by component type. |
| `components/ui/` | shadcn/ui only. Never manually edit these files. |
| `hooks/` | Custom React hooks. One hook per file. Must start with `use`. |
| `lib/` | Pure utility functions and configurations. No React imports. |
| `prisma/` | Schema only. No seed files needed for demo. |

## File Size Limits

| Type | Max Lines | If exceeded |
|------|-----------|-------------|
| Component | 200 | Extract sub-components |
| API route | 100 | Extract logic to `lib/` |
| Hook | 150 | Split into smaller hooks |
| Lib utility | 200 | Split by concern |
