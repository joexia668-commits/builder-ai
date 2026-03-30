# BuilderAI — PRD Overview (Revised 2026-03-29)

## Product Vision
AI Agent 驱动的代码生成平台，用户输入需求后，多个 AI Agent（PM / Architect / Engineer）协作生成可运行的 React 应用，通过 Sandpack 沙箱实时预览，并具备 Supabase 云端数据持久化能力（"伪全栈"体验）。

## Core Highlights
1. **多 Agent 协作可视化** — PM → Architect → Engineer 团队协作对话流
2. **Sandpack 沙箱实时预览** — Engineer 生成 React 代码，Sandpack 即时渲染为可交互应用
3. **BaaS 伪全栈** — 沙箱内预注入 Supabase 客户端，生成的应用直接具备云端 CRUD 能力
4. **版本时间线** — 自动版本快照 + 不可变回滚，体现工程思维

## Tech Stack
| Layer | Choice |
|-------|--------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS + shadcn/ui |
| AI API | Google Gemini Flash (primary) + DeepSeek-V3 (fallback) |
| Database | Supabase PostgreSQL + Prisma ORM |
| Auth | NextAuth (GitHub OAuth + Guest 匿名登录) |
| Preview | Sandpack (React 沙箱) + Supabase 客户端注入 |
| Deploy | Vercel (monolith, fetchAPI abstraction for future split) |

## EPIC Index

| Phase | EPIC | File | Estimate | Dependencies |
|-------|------|------|----------|-------------|
| 0 | 项目脚手架 + 认证 + 数据库 | [epic-0-scaffold.md](./epic-0-scaffold.md) | ~1h | None |
| 1 | 多 Agent 协作可视化对话系统 | [epic-1-multi-agent.md](./epic-1-multi-agent.md) | ~2h | EPIC 0 |
| 2 | Sandpack 沙箱 + 伪全栈预览 | [epic-2-preview.md](./epic-2-preview.md) | ~2h | EPIC 1 |
| 3 | 版本时间线 + 回滚 | [epic-3-timeline.md](./epic-3-timeline.md) | ~1.5h | EPIC 2 |
| 4 | 打磨 + 部署 + 文档 | [epic-4-polish.md](./epic-4-polish.md) | ~1h | EPIC 0-3 |

**Total Estimate**: ~7.5h

## Key Architectural Decisions
- **Guest Login（零摩擦登录）**: 评委无需 GitHub 账号，一键 Guest 进入，降低体验门槛
- **Hybrid Stable 渲染策略**: 生成期间左侧 Chat 实时显示代码流，右侧 Preview 展示 Skeleton；`code_complete` 时一次性更新 Sandpack，保证渲染 100% 稳定
- **Supabase 客户端注入**: Sandpack 沙箱预置 `/supabaseClient.js`，AI 生成的应用直接 `import` 即可读写云端数据
- **Multi-file 接口 + Single-file 默认**: 底层 Sandpack files 对象支持多文件，但 Prompt 默认引导 AI 生成单个 App.js，平衡复杂度与扩展性
- **Provider 抽象**: `lib/ai-provider.ts` 支持 Gemini/DeepSeek 快速切换，不改业务代码
- **fetchAPI 抽象层**: 所有前端 API 调用统一走 `fetchAPI()`，预留前后端分离
- **拆分请求策略**: 每个 Agent 独立一次 SSE 请求，避免 Vercel 60s 超时
- **不可变版本**: 回滚通过创建新版本实现，不删除历史版本

## Implementation Status (as of 2026-03-29)

### Already Built
- [x] Next.js 14 + Tailwind + shadcn/ui 骨架
- [x] Prisma + Supabase PostgreSQL 连接
- [x] GitHub OAuth (NextAuth) 认证
- [x] 三栏布局 (Sidebar + Chat + Preview)
- [x] Multi-Agent SSE 流式对话 (PM → Architect → Engineer)
- [x] Sandpack 基础集成 (preview-frame.tsx)
- [x] Monaco 代码编辑器
- [x] 版本时间线 + 不可变回滚
- [x] Project CRUD + Message 持久化
- [x] fetchAPI / fetchSSE 抽象层

### Gaps to Fill (this session)
- [ ] Guest Login (匿名一键登录)
- [ ] Supabase 客户端注入到 Sandpack
- [ ] LLM 输出清洗/容错加固
- [ ] Preview 区生成期间 Skeleton 状态
- [ ] DeepSeek fallback provider
- [ ] Sandpack Error Boundary
- [ ] 常用依赖预装 (lucide-react, etc.)
- [ ] Vercel 部署 + SSE 超时验证
