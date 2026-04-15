# BuilderAI

> Describe what you want. Get a running React app in seconds.

输入一句需求，三个 AI Agent 协作为你生成完整的多文件 Web 应用，并在浏览器内实时预览。

[![Demo](https://img.shields.io/badge/demo-live-blue)](https://builder-ai-v2.vercel.app)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 是什么

BuilderAI 是一个 AI 驱动的代码生成平台。你描述想要什么，系统自动完成需求分析、架构设计、代码生成，生成的应用直接在浏览器沙箱里运行，支持数据持久化、版本回滚、一键部署。

BuilderAI is an AI-powered code generation platform. Describe your idea in natural language, and the system automatically handles requirements, architecture, and code generation through a three-agent pipeline (PM → Architect → Engineer). The generated React app runs directly in a browser sandbox.

**线上体验：** [builder-ai-v2.vercel.app](https://builder-ai-v2.vercel.app)

---

## Features

- **多 Agent 协作** — PM → Architect → Engineer 顺序流转，实时可见每个 Agent 的思考过程 → [详情](docs/features/multi-agent-pipeline.md)
- **意图路由** — 自动识别 bug_fix / style_change / feature_add / new_project，修 bug 和调样式直接跳过前两个 Agent，响应速度提升 2-3 倍 → [详情](docs/features/intent-routing.md)
- **场景化 Prompt 注入** — 在意图之上识别应用场景（游戏/仪表盘/CRUD/多视图/动画/持久化），向 Architect 和 Engineer 注入场景专属规则，从源头防止 useEffect 无限循环、禁止包引入等 LLM 反模式 → [详情](docs/features/scene-prompt-injection.md)
- **分层并行生成** — Architect 输出文件依赖图，Engineer 按拓扑排序分层并行生成，内置三级容错 → [详情](docs/features/engineer-circuit.md)
- **代码后处理** — 生成后自动检测 import/export 不一致、缺失文件、禁止包引用，≤3 文件时定向修复 → [详情](docs/features/code-post-processing.md)
- **迭代上下文记忆** — 最近 5 轮历史 + 实时架构推导，PM 写增量 PRD，刷新后上下文不丢失 → [详情](docs/features/context-memory.md)
- **代码实时流式预览** — 生成期间文件标签页实时跟随写入进度，文件树同步显示状态指示器 → [详情](docs/features/live-streaming.md)
- **Sandpack 沙箱预览** — 多文件 React 应用在浏览器内编译运行，零服务器开销 → [详情](docs/features/sandpack-preview.md)
- **版本管理** — 每次生成自动快照，父版本追踪，恢复时自动同步迭代上下文，变更文件记录，时间线标注恢复来源 → [详情](docs/features/version-timeline.md)
- **导出与部署** — ZIP 下载完整项目，或一键部署到 Vercel → [详情](docs/features/export-deploy.md)
- **多模型支持** — DeepSeek V3 / Gemini 2.0 Flash / Groq Llama 3.3 70B，工作区内随时切换 → [详情](docs/features/multi-model.md)
- **Scaffold 校验** — 自动修复 Architect 输出中的幽灵依赖、循环依赖、路径错误 → [详情](docs/features/scaffold-validation.md)
- **灵活登录方式** — GitHub OAuth、Email Magic Link、Guest 匿名、Demo 只读模式 → [详情](docs/features/auth-login.md)

---

## Architecture Overview

```
用户输入 → classifyIntent() ──────────────────────────────── Agent Pipeline → Sandpack Preview
                │                                                    │
                └── classifyScene() → 场景规则注入 → Architect / Engineer
                    (game/dashboard/crud/multiview/animation/persistence)

          ┌──────────────────────────┬──────────────────────────┐
          │                          │                          │
     bug_fix / style_change     new_project               feature_add
     Engineer only              PM → Architect            PM → Architect
         ~20s                   → Engineer × N            → Engineer × N
                                    ~60s                  ~60s（含 V1 上下文）
```

Engineer 按文件依赖关系**分层串行、层内并行**生成；内置三级容错：局部解析保留 → 仅失败文件重试 → 熔断。

→ **[完整架构文档](docs/architecture.md)**

---

## Tech Stack

| 层 | 技术 |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| UI | shadcn/ui |
| Code Preview | Sandpack (CodeSandbox in-browser), Monaco Editor |
| AI Providers | DeepSeek V3 / Gemini 2.0 Flash / Groq Llama 3.3 70B |
| Auth | NextAuth.js v4 (GitHub OAuth, Email Magic Link, Guest, Demo) |
| Email | Resend (Email Magic Link) |
| Database | Supabase (PostgreSQL) via Prisma ORM |
| Deployment | Vercel |
| Testing | Jest + React Testing Library, Playwright (E2E) |

---

## Quick Start

**前置条件：** Node.js 18+、Supabase 项目、至少一个 AI API Key

```bash
git clone <repo-url>
cd builder-ai
npm install
cp .env.example .env.local   # 按配置指南填入环境变量
npx prisma db push           # 初始化数据库
npm run dev                  # → http://localhost:3000
```

→ **[完整环境配置指南](docs/setup-guide.md)**（含 Demo 模式配置）

---

## Testing

```bash
npm test              # Unit + Integration（Jest）
npm run test:e2e      # E2E（Playwright，自动启动 dev server）
```

| 层级 | 覆盖范围 |
|------|---------|
| Unit / Integration | lib 函数、React 组件、API Route handlers |
| E2E | 多 Agent 生成流程、版本时间线、持久化 |

---

## Deployment

1. Fork 仓库，在 Vercel 导入项目
2. 填入所有环境变量（参考 [环境配置指南](docs/setup-guide.md)）
3. 将 GitHub OAuth App callback URL 改为 `https://<your-app>.vercel.app/api/auth/callback/github`
4. 执行 `npx prisma db push` 同步生产数据库 schema
5. Deploy ✅

---

## Documentation

| 文档 | 说明 |
|------|------|
| [架构概览](docs/architecture.md) | 系统全局设计、模块表、工程决策 |
| [环境配置](docs/setup-guide.md) | 环境变量详解 + Demo 模式配置 |
| [API 参考](docs/api-reference.md) | 所有 API 路由、请求体、响应格式 |
| [Database Schema](docs/database-schema.md) | 表结构 + 设计原则 |
| [Feature 文档](docs/features/) | 13 篇 per-feature 技术文档 |
| [ADR 记录](docs/adr/) | Bug 记录与架构决策 |

---

## Contributing

欢迎贡献！请：

1. Fork 仓库
2. 创建 feature 分支：`git checkout -b feat/your-feature`
3. 提交更改并编写测试
4. 发起 Pull Request

Bug 记录遵循项目规范，请参考 `docs/adr/` 目录中的格式。

---

## License

MIT
