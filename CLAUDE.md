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

## Bug Recording Rule

所有 bug 必须记录到 `docs/adr/` 目录，格式为 `NNNN-<kebab-slug>[-self].md`：

| 发现方 | 文件名后缀 | 示例 |
|--------|-----------|------|
| 用户输入发现 | 无后缀 | `0005-messagerole-system-type-missing.md` |
| Claude 实现过程中自发现 | `-self` | `0006-some-bug-self.md` |

记录内容（中文）：问题描述、根因、修复 diff、预防措施。序号连续递增，参考现有文件最大编号。

## Architecture

### Request flow for AI generation

Every user prompt first runs intent classification, then takes one of two paths:

```
ChatArea
  │
  ├─ Phase 0: classifyIntent(prompt, hasExistingCode)
  │     → "new_project" | "bug_fix" | "style_change" | "feature_add"
  │
  ├─ DIRECT PATH  (bug_fix | style_change — skips PM + Architect)
  │   Single-file V1:
  │     buildDirectEngineerContext()  → POST /api/generate { agent: "engineer" }
  │           └── code_complete  →  onFilesGenerated({ "/App.js": code })
  │   Multi-file V1:
  │     buildDirectMultiFileEngineerContext()  → POST /api/generate { agent: "engineer", targetFiles: v1Paths }
  │           └── files_complete  →  merge with V1  →  onFilesGenerated(mergedFiles)
  │
  └─ FULL PIPELINE  (new_project | feature_add)
      └── POST /api/generate  { agent: "pm", prompt, context?: buildPmHistoryContext(rounds) }
            └── JSON PmOutput  →  extractPmOutput()  →  onPmOutputGenerated(parsedPm)
      └── POST /api/generate  { agent: "architect", context: resolveArchContext(rounds, pmOutput) }
            └── <thinking>推理</thinking><output>JSON ScaffoldData</output>  →  extractScaffoldFromTwoPhase()  →  validateScaffold()  →  topologicalSort()  →  layers[][]
      └── for each layer (sequential):
            runLayerWithFallback(layerFiles, requestFn, signal, onAttempt)
              ├─ Attempt 1: all files in layer → POST /api/generate (parallel per file)
              │     ├── files_complete          → all ok
              │     ├── partial_files_complete  → accumulate ok, retry only failed subset
              │     └── error (parse_failed)    → treat all files as failed this attempt
              ├─ Attempt 2: only prior failed files (prompt carries retryHint)
              └─ Per-file fallback (up to 2 attempts each, circuit-breaker at 3 consecutive failures)
            onAttempt callback → updates engineerProgress.retryInfo → UI retry banner
      └── allFiles merged  →  findMissingLocalImportsWithNames()  →  ≤3 缺失文件时发起补全请求 / 超出则跳过
                           →  findMissingLocalImports()  →  stub 注入 / missing_imports 错误
                           →  buildSandpackConfig(files, projectId)  →  Sandpack
                           →  POST /api/versions  { code, files }  (immutable snapshot)
```

`resolveModelId(modelId, project.preferredModel, user.preferredModel)` → `createProvider()` → `GeminiProvider | DeepSeekProvider | GroqProvider`

The AbortController ref is replaced at the start of each generation; calling `abort()` cancels all in-flight SSE reads immediately.

### Intent classification & context memory

`classifyIntent(prompt, hasExistingCode)` in `lib/intent-classifier.ts` — keyword-based router:

| Intent | Trigger | Pipeline |
|--------|---------|----------|
| `new_project` | no existing code, or "重新做/start over" keywords | Full PM → Architect → Engineer |
| `feature_add` | default when code exists | Full pipeline + V1 code injected into Engineer, PM sees multi-round history, Architect sees last arch decisions |
| `bug_fix` | "修复/bug/报错/没有反应…" keywords | Direct to Engineer only |
| `style_change` | "颜色/样式/dark mode/UI…" keywords | Direct to Engineer only |

Context injected per path:
- **PM** (`feature_add`): `buildPmHistoryContext(rounds)` — formats up to 5 past rounds (userPrompt, intent summary, pmSummary, archDecisions) so PM writes a delta PRD
- **Architect** (full pipeline): `resolveArchContext(rounds, pmOutput)` — finds last round with non-null `archDecisions`, prepends arch summary (file count, component tree, state strategy, key decisions) to PM output so Architect modifies incrementally
- **Engineer** (`feature_add`): `existingFiles: currentFiles` appended to `getMultiFileEngineerPrompt` as `// === EXISTING FILE: /path ===` blocks
- **Engineer** (direct, single-file V1): `buildDirectEngineerContext` with `<source file="…">` XML tags
- **Engineer** (direct, multi-file V1): `buildDirectMultiFileEngineerContext` with `targetFiles` = V1 paths → `extractMultiFileCode` on server

`iterationContext` is loaded from `Project.iterationContext` (Json? column, FIFO max 5 rounds) at page load and held in `Workspace` state. After each generation (both direct and full pipeline), a new `IterationRound` is appended and fire-and-forget PATCHed to `/api/projects/[id]`. `extractArchDecisions(scaffold)` deterministically extracts `ArchDecisions` from `ScaffoldData` without an extra LLM call.

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

No global store. State lives in hooks and components:
- `ChatArea` — orchestrates the full multi-phase generation (PM → Architect → layered Engineer), holds `AgentState[]`, `isGenerating`, `engineerProgress`, abort logic; replaced `useAgentStream` hook
- `useVersions` — version list, selected version for timeline preview, restore action
- `useProject` — single project data fetch + optimistic preferredModel update
- `Workspace` — holds `currentFiles: Record<string, string>` and `iterationContext: IterationContext | null` (loaded from project DB row, passed to ChatArea)

### SSE event protocol

`/api/generate` emits newline-delimited JSON on a `ReadableStream`:
```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}
data: {"type":"code_complete","code":"..."}                                      // engineer single-file fallback
data: {"type":"files_complete","files":{...}}                                    // engineer multi-file, all ok
data: {"type":"partial_files_complete","files":{...},"failed":[...],"truncatedTail":"..."}  // partial salvage
data: {"type":"error","error":"...","errorCode":"parse_failed","failedFiles":[...],"truncatedTail":"..."}
data: {"type":"done"}
```

`readEngineerSSE` in `chat-area.tsx` handles all three success/partial/error variants and returns `{ files, failedInResponse, truncatedTail }` to `runLayerWithFallback`.

### Version system

Versions are **immutable INSERT-only**. New versions store `files: Record<string,string>` in the `files` Json column; legacy versions only have `code`. `getVersionFiles(version)` in `lib/version-files.ts` provides a unified reader: returns `files` if present, otherwise wraps `code` as `{ "/App.js": code }`. Restore = `getVersionFiles(oldVersion)` → POST `/api/versions` with those files. `useVersions` tracks `previewVersionId` (null = live, non-null = history view which disables ChatInput).

### Testing patterns

**API route tests** (`__tests__/*.test.ts`): import the route handler directly, mock `next-auth`, `next/server`'s `NextResponse`, and `@/lib/prisma`. See `__tests__/messages-api-route.test.ts` for the canonical pattern.

**Component tests** (`__tests__/*.test.tsx`): use `@testing-library/react`. Mock heavy dependencies (`ModelSelector`, AI providers, Prisma) at the top of the file with `jest.mock`.

**E2E tests** (`e2e/*.spec.ts`): use helpers from `e2e/helpers.ts` — `loginAsGuest`, `createProjectAndNavigate`, `cleanupTestProjects`. All test projects are named `[E2E] ...` so `cleanupTestProjects` can delete them in `afterAll`.

### Key files to read first

| File | Why |
|------|-----|
| `lib/types.ts` | All shared types: `AgentRole`, `Intent`, `SSEEvent`, `ScaffoldData`, `ScaffoldValidationResult`, `EngineerProgress` (incl. `retryInfo`), `PmOutput`, `ArchOutput`, `PartialExtractResult`, `RequestMeta`, `RequestResult`, `AttemptInfo`, `IterationContext`, `IterationRound`, `ArchDecisions` |
| `lib/intent-classifier.ts` | `classifyIntent(prompt, hasExistingCode)` — keyword router that selects pipeline path |
| `lib/agent-context.ts` | Context builders: `buildEngineerContext`, `buildEngineerContextFromStructured`, `buildDirectEngineerContext`, `buildDirectMultiFileEngineerContext`, `buildPmHistoryContext`, `buildArchIterationContext` |
| `lib/extract-arch-decisions.ts` | `extractArchDecisions(scaffold)` — deterministic extraction of `ArchDecisions` from `ScaffoldData` (no LLM call) |
| `lib/ai-providers.ts` | `AIProvider` interface, three provider classes, `resolveModelId`, `createProvider` |
| `lib/model-registry.ts` | `MODEL_REGISTRY`, `getModelById`, `getAvailableModels`, `isValidModelId` |
| `lib/extract-json.ts` | `extractPmOutput`, `extractScaffold`, `extractScaffoldFromTwoPhase` — JSON parsing; two-phase extracts from `<output>` block with fallback |
| `lib/generate-prompts.ts` | System prompts + `snipCompletedFiles()` (Snip compression) + `getMultiFileEngineerPrompt()` (includes `【本地文件导入限制】` rule + optional `retryHint` for adaptive retry) + `buildMissingFileEngineerPrompt()` (patch generation prompt) |
| `lib/extract-code.ts` | Multi-layer code extraction + `extractMultiFileCodePartial()` (partial salvage) + `deduplicateDefaultExport()` (removes duplicate `export default X;` lines) + `findMissingLocalImports()` + `findMissingLocalImportsWithNames()` (returns `Map<path, Set<exportName>>` for patch generation) |
| `lib/validate-scaffold.ts` | `validateScaffold(raw)` — 4-rule deterministic repair before `topologicalSort`: self-ref removal → phantom dep removal → hints path cleaning → cycle breaking (reverse-flow heuristic). Returns `ScaffoldValidationResult { scaffold, warnings }` |
| `lib/engineer-circuit.ts` | `runLayerWithFallback(layerFiles, requestFn, signal?, onAttempt?)` — 2 layer attempts → 2 per-file attempts → circuit breaker (3 consecutive failures); `requestFn` receives `RequestMeta { attempt, priorFailed }` |
| `lib/topo-sort.ts` | `topologicalSort` — groups scaffold files into dependency layers for parallel generation |
| `lib/version-files.ts` | `getVersionFiles` — backward-compatible reader for `code` / `files` version fields |
| `lib/sandpack-config.ts` | `buildSandpackConfig(input: string \| Record<string,string>, projectId)` — calls `findMissingLocalImports` and injects Proxy stubs for missing paths |
| `lib/error-codes.ts` | `ErrorCode` union + `ERROR_DISPLAY` map — user-facing error titles and descriptions (includes `missing_imports`) |
| `lib/auth.ts` | NextAuth configuration — GitHub OAuth, Email Magic Link (Resend), Demo Mode credentials provider |
| `lib/resend.ts` | Resend email service singleton for Email Magic Link provider |
| `lib/demo-bootstrap.ts` | Auto-create demo viewer account on startup if `DEMO_VIEWER_ID` env var is set |
| `components/workspace/chat-area.tsx` | Core orchestration — intent classification, direct path, PM → Architect → layered Engineer, abort, progress state, missing-import error |
| `app/api/generate/route.ts` | The only Edge route — auth, model validation, provider selection, SSE stream |
| `components/workspace/workspace.tsx` | Holds `currentFiles` + `lastPmOutput` state; wires to ChatArea and preview |
| `components/layout/demo-banner.tsx` | Demo mode indicator banner (amber background, read-only notice) |
| `components/layout/demo-login-button.tsx` | Quick-login button for demo viewer account (login page) |
| `components/layout/email-login-form.tsx` | Email Magic Link form (sign-in / sign-up unified flow) |
