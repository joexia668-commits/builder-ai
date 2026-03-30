# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # Start dev server (http://localhost:3000)
npm run dev:clean        # 改动 lib/ 配置文件后重启（清 webpack 缓存，防止 .next/ stale cache）
npm run build            # Production build
npm run lint             # ESLint via next lint

# Database
npx prisma db push       # Sync schema to DB (no migration files)
npx prisma studio        # GUI to inspect DB

# Tests — Jest (unit + integration)
npm test                                          # All Jest tests
npm test -- --testPathPatterns="<filename>"       # Single file
npm test -- --testNamePattern="<test name>"       # Single test by name
npm run test:coverage                             # With coverage report

# Tests — Playwright (E2E)
npm run test:e2e          # All E2E (auto-starts dev server)
npm run test:e2e:headed   # Visible browser
npm run test:e2e:ui       # Playwright UI mode
npx playwright test e2e/<spec>.spec.ts            # Single E2E file
```

**Jest project split**: `.test.ts` files run in `node` env; `.test.tsx` files run in `jsdom` env. Keep API/lib tests as `.ts`, component tests as `.tsx`.

**E2E**: Playwright auto-starts `npm run dev` if port 3000 is not already listening. `workers: 1` — tests run serially. Timeout is 300s per test (AI generation can take 90s+).

## Architecture

### Request flow for AI generation

Every user prompt triggers **three sequential SSE requests** — one per Agent:

```
useAgentStream (hook)
  └── POST /api/generate  { agent: "pm", prompt, projectId, modelId? }
        └── resolveModelId(modelId, project.preferredModel, user.preferredModel)
              └── createProvider(resolvedModelId)  →  GeminiProvider | DeepSeekProvider | GroqProvider
                    └── streamCompletion()  →  SSE chunks  →  client
  └── POST /api/generate  { agent: "architect", context: pmOutput, ... }
  └── POST /api/generate  { agent: "engineer",  context: pmOutput+archOutput, ... }
        └── extractReactCode(fullOutput)  →  code_complete event
              └── Sandpack renders preview
              └── POST /api/versions  (immutable snapshot)
```

Each agent call in `useAgentStream` is fully sequential with `await`. The AbortController ref is replaced at the start of each generation; calling `abort()` cancels all in-flight SSE reads immediately.

### Model selection priority chain

`resolveModelId(requestModelId?, projectModelId?, userModelId?)` in `lib/ai-providers.ts`:

```
request-level → project.preferredModel → user.preferredModel → AI_PROVIDER env → DEFAULT_MODEL_ID
```

`DEFAULT_MODEL_ID = "gemini-2.0-flash"`. All four models are defined in `lib/model-registry.ts`. A model is "available" only if its `envKey` is set in `process.env`.

### API conventions

- All frontend calls go through `fetchAPI()` or `fetchSSE()` in `lib/api-client.ts` — never raw `fetch('/api/...')` in components.
- Error responses: `{ error: string, details?: unknown }`.
- `/api/generate` uses `getToken` (next-auth/jwt) for Edge Runtime compatibility; all other routes use `getServerSession`.
- `/api/generate` is the only Edge Runtime route (`export const runtime = "edge"`).

### State management

No global store. State lives in hooks:
- `useAgentStream` — orchestrates the three-agent SSE sequence, holds `AgentState[]`, `isGenerating`, `currentCode`, abort logic
- `useVersions` — version list, selected version for timeline preview, restore action
- `useProject` — single project data fetch + optimistic preferredModel update

### SSE event protocol

`/api/generate` emits newline-delimited JSON on a `ReadableStream`:
```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}
data: {"type":"code_complete","code":"..."}   // engineer only
data: {"type":"done"}
data: {"type":"error","error":"..."}
```

`fetchSSE` in `api-client.ts` parses this and dispatches to typed handlers.

### Version system

Versions are **immutable INSERT-only**. Restore = read old version's code → POST `/api/versions` with that code as the new current. The timeline shows `versionNumber` ascending. `useVersions` tracks `previewVersionId` (null = live, non-null = history view which disables ChatInput).

### Testing patterns

**API route tests** (`__tests__/*.test.ts`): import the route handler directly, mock `next-auth`, `next/server`'s `NextResponse`, and `@/lib/prisma`. See `__tests__/messages-api-route.test.ts` for the canonical pattern.

**Component tests** (`__tests__/*.test.tsx`): use `@testing-library/react`. Mock heavy dependencies (`ModelSelector`, AI providers, Prisma) at the top of the file with `jest.mock`.

**E2E tests** (`e2e/*.spec.ts`): use helpers from `e2e/helpers.ts` — `loginAsGuest`, `createProjectAndNavigate`, `cleanupTestProjects`. All test projects are named `[E2E] ...` so `cleanupTestProjects` can delete them in `afterAll`.

### Key files to read first

| File | Why |
|------|-----|
| `lib/types.ts` | All shared types: `AgentRole`, `SSEEvent`, `ProjectMessage`, `CodeRenderer` |
| `lib/ai-providers.ts` | `AIProvider` interface, three provider classes, `resolveModelId`, `createProvider` |
| `lib/model-registry.ts` | `MODEL_REGISTRY`, `getModelById`, `getAvailableModels`, `isValidModelId` |
| `hooks/use-agent-stream.ts` | Core orchestration — generation lock, abort, sequential SSE, state updates |
| `app/api/generate/route.ts` | The only Edge route — auth, model validation, provider selection, SSE stream |
| `components/workspace/workspace.tsx` | Wires hooks to the three-column layout |
