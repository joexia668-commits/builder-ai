# EPIC 4: 打磨 + 部署 + 文档

| Field | Value |
|-------|-------|
| Goal | 完成产品打磨、DeepSeek fallback、部署上线、提交文档 |
| Business Value | 可交付的完整产品，直接影响评审得分 |
| Total Estimate | ~1h |
| Phase | Phase 4 of 4 |

## 功能描述

处理边界情况、配置 AI Provider fallback、优化体验、部署到 Vercel、编写提交文档。

## AI Provider 切换（简化方案）

### 决策
不构建 `lib/ai-provider.ts` 抽象层。Gemini SDK（`@google/generative-ai`）与 DeepSeek（OpenAI-compatible）接口差异较大，在 EPIC 4 的 1h 预算内实现无缝切换风险过高。

### 实际方案：env-var 控制单一 provider
```env
# 使用 Gemini（默认）
GOOGLE_GENERATIVE_AI_API_KEY=AIza...

# 若需切换 DeepSeek，手动修改 generate/route.ts 中的 SDK 调用
# DEEPSEEK_API_KEY=sk-...
```

- `generate/route.ts` 始终使用 Gemini Flash，保持当前代码不变
- 若 Demo 当天 Gemini 不稳定，备选方案是提前替换 SDK 调用，而非运行时 fallback
- README 中记录"Provider 可换"作为架构说明，而非实现为运行时特性

## 打磨清单

### 空状态
- [ ] 无项目时：引导创建第一个项目的友好提示
- [ ] 项目无对话时：输入框 placeholder 引导用户输入需求
- [ ] 预览区无内容时：展示 BuilderAI logo + "等待生成" 提示

### 加载状态
- [ ] 页面加载：骨架屏（Skeleton）
- [ ] Agent 生成中：typing animation + 进度提示
- [ ] 版本加载中：spinner

### 错误处理
- [ ] AI API 调用失败：友好提示 + 重试按钮（页面级全流程重试）
- [ ] **停止生成（Human-in-the-loop 简化版）**：
  - 生成中显示"停止生成"按钮，使用 `AbortController` 中止当前 SSE 请求
  - 中止后重置所有 Agent 状态为 `idle`，恢复输入框
  - **不实现"从当前 Agent 重试"**：该功能需追踪消息与 pipeline 轮次关联，复杂度与 AbortController 相当，超出时间预算
  - 口头说明：生产版本可在每个已完成的 Agent 消息气泡上增加"编辑并重新生成"按钮
- [ ] 网络断开：toast 通知
- [ ] 认证过期：自动重定向登录页

### 响应式
- [ ] Desktop（>1024px）：三栏布局
- [ ] Tablet（768-1024px）：Agent Panel 折叠为图标
- [ ] Mobile（<768px）：单栏，Tab 切换 Chat/Preview

### 首页：项目列表
- [ ] 卡片网格展示项目
- [ ] 显示：项目名、描述、最近修改时间、版本数
- [ ] 新建项目按钮（模态框输入名称）
- [ ] 点击卡片进入工作区

## 部署清单

### Vercel
- [ ] GitHub 仓库创建（public）
- [ ] Vercel 项目连接 GitHub 仓库
- [ ] 环境变量配置：
  - `DATABASE_URL` — Supabase connection pooling URL
  - `DIRECT_URL` — Supabase direct connection URL
  - `GITHUB_ID` — GitHub OAuth App Client ID
  - `GITHUB_SECRET` — GitHub OAuth App Client Secret
  - `NEXTAUTH_SECRET` — 随机字符串
  - `NEXTAUTH_URL` — Vercel 域名
  - `GOOGLE_GENERATIVE_AI_API_KEY` — Gemini API Key
  - `DEEPSEEK_API_KEY` — DeepSeek API Key（fallback）
  - `NEXT_PUBLIC_SUPABASE_URL` — Supabase 项目 URL
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase Anon Key

### Supabase
- [ ] 生产数据库确认 schema 已同步（`npx prisma db push`）
- [ ] Connection pooling 开启（Vercel serverless 需要）
- [ ] `dynamic_app_data` 表 RLS 策略：允许 anon key 读写（Demo 方案）
  - 注意：Supabase 标准 RLS（`auth.uid()`）依赖 Supabase Auth，本项目使用 NextAuth，两者不互通，`auth.uid()` 恒为 null
  - 生产级方案需在 Next.js API 路由中用 service role key 代理写入，而非前端直连
  - Demo 阶段维持 anon key 开放，评审时口头说明 RLS 设计思路即可

### GitHub OAuth
- [ ] 生产环境 callback URL 更新为 Vercel 域名
- [ ] `https://<app-name>.vercel.app/api/auth/callback/github`

### 验证
- [ ] 线上访问正常
- [ ] GitHub OAuth 登录正常
- [ ] Guest 匿名登录正常
- [ ] 完整流程走通：登录 → 创建项目 → 输入需求 → Agent 协作 → 预览 → 版本回滚
- [ ] SSE 流不超时（每个 Agent < 30s）
- [ ] 生成的应用能读写 Supabase `dynamic_app_data`

## 文档 (README.md)

### 结构
```markdown
# BuilderAI

AI Agent 驱动的代码生成平台

## Demo
[在线体验链接]

## Features
- 多 Agent 协作可视化（PM → Architect → Engineer）
- Sandpack 沙箱实时预览（React 应用）
- BaaS 伪全栈（Supabase 数据直连）
- 版本时间线 + 一键回滚
- GitHub OAuth + Guest 匿名登录

## Tech Stack
...

## Architecture
[架构图 + 数据流图]

## 关键工程决策
1. **为什么选 Sandpack 而非 WebContainer**：消除 COOP/COEP 跨域部署风险，确保 Vercel 上 100% 可演示
2. **Hybrid Stable 渲染策略**：放弃流式沙箱更新，一次性 `code_complete` 后渲染，保证 Demo 稳定性 > 视觉花哨
3. **BaaS 伪全栈**：Supabase Anon Key 直连 + `dynamic_app_data` 表，用零后端成本实现真实数据持久化演示
4. **不可变版本设计**：只 INSERT 不 DELETE，用极低工程代价实现完整的时间线回滚，零数据丢失
5. **Provider 可替换**：生成层与 AI SDK 解耦，可通过修改单一 `route.ts` 切换 Gemini / DeepSeek

## Local Development
...
```

## 验收标准

- [ ] 线上链接可访问（https）
- [ ] GitHub OAuth + Guest 登录均正常
- [ ] 完整流程可走通
- [ ] AI Provider 稳定可用（Gemini Flash 单一 provider）
- [ ] README.md 完整清晰
- [ ] 代码仓库 public，结构清晰
- [ ] 无 hardcoded secrets

## 依赖

- EPIC 0-3 全部完成
