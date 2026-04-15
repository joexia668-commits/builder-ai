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
  │   Multi-file V1 (two-phase triage):
  │     triageAffectedFiles(prompt, currentFiles)  → POST /api/generate { triageMode: true }
  │           └── JSON array of affected paths  →  intersect with currentFiles keys
  │           └── ≤3 paths: buildDirectMultiFileEngineerContext(prompt, subset)
  │           └── 0 or >3 paths: fallback to buildDirectMultiFileEngineerContext(prompt, allFiles)
  │     → POST /api/generate { agent: "engineer", partialMultiFile: true }
  │           └── files_complete  →  merge with V1  →  onFilesGenerated(mergedFiles)
  │
  └─ FULL PIPELINE  (new_project | feature_add)
      └── POST /api/generate  { agent: "pm", prompt, context?: buildPmHistoryContext(rounds) }
            └── JSON PmOutput  →  extractPmOutput()  →  onPmOutputGenerated(parsedPm)
      └── POST /api/generate  { agent: "architect", context: resolveArchContext(rounds, pmOutput, existingFiles) }
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
      └── merge { ...currentFiles, ...allCompletedFiles }  →  post-processing sees full file set (old + new)
                           →  findMissingLocalImportsWithNames()  →  ≤3 缺失文件时发起补全请求 / 超出则跳过
                           →  findMissingLocalImports()  →  stub 注入 / missing_imports 错误
                           →  checkImportExportConsistency()  →  ≤3 文件时发起修复请求（named/default 不匹配）
                           →  checkDisallowedImports()  →  ≤3 文件时发起修复请求（禁止包引用）
                           →  apply scaffold.removeFiles (delete old paths)
                           →  buildSandpackConfig(files, projectId)  →  Sandpack (normalizeExports bidirectional)
                           →  POST /api/versions  { code, files, changedFiles, iterationSnapshot }  (immutable snapshot with context)
```

### Export & Deploy flow

```
PreviewPanel
  ├─ "Deploy" 按钮
  │     POST /api/deploy { projectId, versionId? }
  │       → getVersionFiles(version)
  │       → assembleProject(files, mode:'hosted')  →  Next.js 模板合并
  │       → createVercelDeployment(assembled)       →  Vercel API v13
  │       → save Deployment record
  │       → 202 { deploymentId, status:'building', url }
  │     GET /api/deploy/[id]  (轮询)
  │       → pollDeploymentStatus(deployId) → 'ready'|'error'|'building'
  │
  └─ "Export" 按钮
        GET /api/export?projectId=...&versionId=...
          → getVersionFiles(version)
          → assembleProject(files, mode:'export')   →  env var 版 Supabase config
          → createProjectZip(assembled, projectName)
          → Response: application/zip
```

`resolveModelId(modelId, project.preferredModel, user.preferredModel)` → `createProvider()` → `GeminiProvider | DeepSeekProvider | GroqProvider`

The AbortController ref is replaced at the start of each generation; calling `abort()` cancels all in-flight SSE reads immediately.

### Intent classification & context memory

| Intent | Trigger | Pipeline |
|--------|---------|----------|
| `new_project` | no existing code, or "重新做/start over" keywords | Full PM → Architect → Engineer |
| `feature_add` | default when code exists | Full pipeline + V1 code injected into Engineer, PM sees multi-round history, Architect sees last arch decisions |
| `bug_fix` | "修复/bug/报错/没有反应…" keywords | Direct to Engineer only |
| `style_change` | "颜色/样式/dark mode/UI…" keywords | Direct to Engineer only |

Context injected per path:
- **PM** (`feature_add`): `buildPmHistoryContext(rounds)` — formats up to 5 past rounds (userPrompt, intent summary, pmSummary) so PM writes a delta PRD
- **Architect** (full pipeline): `resolveArchContext(rounds, pmOutput, existingFiles)` — calls `deriveArchFromFiles(existingFiles)` to build a real-time architecture summary (file list, exports, imports, state strategy, persistence) from current code, prepends to PM output so Architect modifies incrementally. No longer depends on saved `archDecisions`.
- **Engineer** (`feature_add`): `existingFiles: currentFiles` appended to `getMultiFileEngineerPrompt` as `// === EXISTING FILE: /path ===` blocks
- **Engineer** (direct, single-file V1): `buildDirectEngineerContext` with `<source file="…">` XML tags
- **Engineer** (direct, multi-file V1): `buildDirectMultiFileEngineerContext` with `targetFiles` = V1 paths → `extractMultiFileCode` on server

`iterationContext` is loaded from `Project.iterationContext` (Json? column, FIFO max 5 rounds) at page load and held in `Workspace` state. After each generation (both direct and full pipeline), a new `IterationRound` is appended **before** version creation so that `iterationSnapshot` includes the current round, then fire-and-forget PATCHed to `/api/projects/[id]`. Architecture context is derived at runtime from existing files via `deriveArchFromFiles()`, not stored in `iterationContext`.

Version restore (`POST /api/versions/[id]/restore`) writes `parentVersionId` pointing to the source version, copies `iterationSnapshot` from the source, and syncs `Project.iterationContext` back to the source's snapshot. If the source version has no snapshot (old data), the context is left unchanged (degraded).

### API conventions

- All frontend calls go through `fetchAPI()` or `fetchSSE()` in `lib/api-client.ts` — never raw `fetch('/api/...')` in components.
- Error responses: `{ error: string, details?: unknown }`.
- `/api/generate` uses `getToken` (next-auth/jwt) for Edge Runtime compatibility; all other routes use `getServerSession`.
- `/api/generate` is the only Edge Runtime route (`export const runtime = "edge"`).

### SSE event protocol

`/api/generate` emits newline-delimited JSON on a `ReadableStream`:
```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}
data: {"type":"code_complete","code":"..."}                                      // engineer single-file fallback
data: {"type":"files_complete","files":{...}}                                    // engineer multi-file, all ok
data: {"type":"partial_files_complete","files":{...},"failed":[...],"truncatedTail":"..."}  // partial salvage
data: {"type":"file_start","path":"/components/Header.js"}                        // stream tap: 检测到新文件
data: {"type":"file_chunk","path":"/components/Header.js","delta":"..."}           // stream tap: 代码片段
data: {"type":"file_end","path":"/components/Header.js"}                          // stream tap: 文件边界结束
data: {"type":"error","error":"...","errorCode":"parse_failed","failedFiles":[...],"truncatedTail":"..."}
data: {"type":"done"}
```

`readEngineerSSE` in `chat-area.tsx` handles `files_complete`、`partial_files_complete`、`code_complete`（成功路径）、`file_start/file_chunk/file_end`（stream tap 实时 UI）和 `error` 变体，返回 `{ files, failedInResponse, truncatedTail }` 给 `runLayerWithFallback`。

### Testing patterns

**API route tests** (`__tests__/*.test.ts`): import the route handler directly, mock `next-auth`, `next/server`'s `NextResponse`, and `@/lib/prisma`. See `__tests__/messages-api-route.test.ts` for the canonical pattern.

**Component tests** (`__tests__/*.test.tsx`): use `@testing-library/react`. Mock heavy dependencies (`ModelSelector`, AI providers, Prisma) at the top of the file with `jest.mock`.

**E2E tests** (`e2e/*.spec.ts`): use helpers from `e2e/helpers.ts` — `loginAsGuest`, `createProjectAndNavigate`, `cleanupTestProjects`. All test projects are named `[E2E] ...` so `cleanupTestProjects` can delete them in `afterAll`.

### Key files to read first

| File | Why |
|------|-----|
| `lib/types.ts` | All shared types: `AgentRole`, `Intent`, `SSEEvent`, `ScaffoldData`, `EngineerProgress`, `PmOutput`, `ArchOutput`, `RequestMeta`, `AttemptInfo`, `ChangedFiles` |
| `lib/intent-classifier.ts` | `classifyIntent(prompt, hasExistingCode)` — keyword router that selects pipeline path |
| `lib/agent-context.ts` | Context builders: `buildEngineerContext`, `buildDirectEngineerContext`, `buildDirectMultiFileEngineerContext`, `buildTriageContext`, `buildPmIterationContext`, `deriveArchFromFiles` |
| `lib/ai-providers.ts` | `AIProvider` interface, three provider classes, `resolveModelId`, `createProvider` |
| `lib/generate-prompts.ts` | System prompts + `snipCompletedFiles()` + `getMultiFileEngineerPrompt()` (includes retry hint) + `buildMissingFileEngineerPrompt()` + `buildMismatchedFilesEngineerPrompt()` + `buildDisallowedImportsEngineerPrompt()` |
| `lib/extract-code.ts` | Multi-layer code extraction + `extractMultiFileCodePartial()` (partial salvage) + `findMissingLocalImports()` + `findMissingLocalImportsWithNames()` + `checkImportExportConsistency()` + `checkDisallowedImports()` |
| `lib/validate-scaffold.ts` | `validateScaffold(raw)` — 7-rule deterministic repair: self-ref → phantom dep → hints path → cycle breaking → removeFiles conflict → maxLines clamp → blocked deps removal |
| `lib/sandpack-config.ts` | `buildSandpackConfig()` + `normalizeExports()` (bidirectional export normalization for Sandpack Babel compat) |
| `lib/engineer-circuit.ts` | `runLayerWithFallback` — 2 layer attempts → 2 per-file attempts → circuit breaker (3 consecutive failures) |
| `components/workspace/chat-area.tsx` | Core orchestration — intent classification, direct path, PM → Architect → layered Engineer, abort, progress |
| `lib/model-registry.ts` | `MODEL_REGISTRY` 数组、`getAvailableModels()`、`DEFAULT_MODEL_ID` — 集中式模型定义与可用性检测 |
| `lib/generation-session.ts` | 内存 pub-sub 存储驱动实时 UI；`getSession`、`updateSession`、`subscribe` |
| `lib/engineer-stream-tap.ts` | `createEngineerStreamTap()` — 解析 `// === FILE:` 标记，emit `file_start/file_chunk/file_end` 事件 |
| `lib/coalesce-chunks.ts` | `coalesceChunks()` — 合并同路径连续 `file_chunk` 事件，降低 SSE 频率 |
| `lib/project-assembler.ts` | `assembleProject()` — Sandpack 文件与 Next.js 模板合并，用于 export/deploy |
| `lib/vercel-deploy.ts` | `createVercelDeployment()`、`pollDeploymentStatus()` — Vercel API v13 集成 |
| `lib/zip-exporter.ts` | `createProjectZip()` — 将生成文件打包为可下载 ZIP |
| `lib/file-tree.ts` | `buildFileTree()` — 平铺路径 → 层级文件树（供文件资源管理器 UI 使用）|
| `lib/guest-cleanup.ts` | `deleteStaleGuestUsers()` — 定时清理 >5 天未活跃 Guest 账户 |
| `lib/version-files.ts` | `getVersionFiles()` (legacy/multi-file 统一读取) + `computeChangedFiles()` (版本间文件差异计算) |
| `lib/extract-json.ts` | 从 LLM 输出安全提取 JSON，含 fence 剥离与错误恢复 |
| `lib/scene-classifier.ts` | `classifySceneFromPrompt()` + `classifySceneFromPm()` — 6 种场景识别（game/dashboard/crud/multiview/animation/persistence） |
| `lib/scene-rules.ts` | `getSceneRules()` — 场景专属 Architect/Engineer prompt 规则注入 |
| `lib/lucide-icon-names.ts` | Lucide 图标名称列表，用于自动修正 LLM 生成的错误图标名 |
| `lib/error-codes.ts` | 生成错误码常量定义 |
| `app/api/generate/handler.ts` | `createHandler()` — SSE 生成编排器；Agent 路由、stream tap、代码提取、重试逻辑 |

### Known limitations & open issues

| Issue | ADR | Status |
|-------|-----|--------|
| `normalizeExports`: Sandpack Babel 不支持 `export { Name }` after `export default function Name` — 需要拆分声明 | 0015 | ✅ 已修复（拆分为普通声明 + 分离 export） |
| 后处理阶段（missing imports / consistency check）需要看完整文件集（old + new），否则误判旧文件为缺失 | 0016 | ✅ 已修复（merge 提前到后处理之前） |
| `generationError.raw` 具体错误详情需要在 UI 展示，方便线上排查 | 0017 | ✅ 已修复 |
| `bug_fix` 直接路径缺少架构感知，Engineer 可能过度修复导致功能丢失 | 0018 | ✅ 已修复（方向 A：架构摘要注入） |
| Supabase `DynamicAppData` RLS 需要 `x-app-id` header | 0007 | ✅ 已修复（`buildSupabaseClientCode` 注入 header） |
| `iterationSnapshot` 缺少当前轮次，恢复后上下文少一轮 | 0020 | ✅ 已修复（appendRound 提前到版本创建之前） |
| 复杂游戏类项目 — 动态行数上限 + 第三方包黑名单机制已解锁，但 AI 代码质量在 300+ 行文件时可能下降 | — | ✅ 基本解决（动态 maxLines + 包黑名单 + 动态补全上限） |
