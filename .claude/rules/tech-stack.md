# BuilderAI — Tech Stack

## Pinned Versions

| Package | Version | Purpose |
|---------|---------|---------|
| next | 14.x | App Router, API Routes, SSR |
| react | 18.x | UI framework |
| typescript | 5.x | Type safety (strict mode) |
| tailwindcss | 3.x | Utility-first CSS |
| @shadcn/ui | latest | UI component library |
| prisma | 5.x | ORM + schema management |
| @prisma/client | 5.x | Database client |
| next-auth | 4.x | Authentication (GitHub OAuth, Email Magic Link, Demo Mode) |
| resend | latest | Email Magic Link provider via Resend API |
| nodemailer | latest | Email client library (peer dependency for Resend) |
| @google/generative-ai | latest | Gemini Flash API |
| groq-sdk | latest | Groq API (fallback) |
| @monaco-editor/react | 4.x | Code editor (VS Code engine) |
| @codesandbox/sandpack-react | latest | In-browser React sandbox for preview |
| @supabase/supabase-js | latest | Supabase client (injected into generated apps) |
| jszip | latest | ZIP archive generation (project export) |

## AI API Configuration

### Default: DeepSeek V3
- Model: `deepseek-chat`
- Env var: `DEEPSEEK_API_KEY`
- Default model: `DEFAULT_MODEL_ID = "deepseek-chat"`
- Streaming: supported via OpenAI-compatible API
- Free tier: generous rate limits

### Option: Google Gemini Flash
- Model: `gemini-2.0-flash`
- Env var: `GOOGLE_GENERATIVE_AI_API_KEY`
- Free tier: 15 RPM, sufficient for demo
- Streaming: supported via `generateContentStream()`

### Option: Groq
- Model: `llama-3.3-70b-versatile`
- Env var: `GROQ_API_KEY`
- Free tier: 30 RPM
- Streaming: supported

### Selection logic
```typescript
// lib/model-registry.ts — 模型定义 + 可用性检测（按 env var）
// lib/ai-providers.ts  — AIProvider 接口 + 三 Provider 工厂
// resolveModelId 优先级：request → project → user → env.AI_PROVIDER → DEFAULT_MODEL_ID ("deepseek-chat")
```

## Database

- **Provider**: Supabase (PostgreSQL 15)
- **ORM**: Prisma 5.x
- **Connection**: Connection pooling via Supabase (port 6543) for serverless
- **Direct**: Direct connection (port 5432) for migrations

## Deployment

- **Platform**: Vercel (Hobby plan)
- **Runtime**: Node.js (not Edge, for Prisma compatibility)
- **Timeout**: 60s per serverless function
- **Strategy**: 拆分请求 — 每个 Agent 独立一次 SSE 请求 (< 30s each)

## Key Constraints

- No `@next/font` — use system font stack or CDN for simplicity
- No `next/image` remote patterns needed — avatars are emoji
- Prisma binary targets: `["native", "rhel-openssl-3.0.x"]` (for Vercel)
- All API calls from frontend go through `fetchAPI()` / `fetchSSE()` abstraction
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe to expose (client-side)
- Sandpack-generated apps only write to `dynamic_app_data` table with their own `projectId` as `appId`
