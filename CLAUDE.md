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
            └── resolveComplexity(pm): modules.length > 3 OR features.length > 5 OR pm.complexity == "complex"
                     │
          ┌──────────┴──────────────────────────────────────────────────────────────────────┐
          │ SIMPLE PATH                                                                      │ COMPLEX PATH
          │                                                                                  │
      └── POST /api/generate  { agent: "architect" }                                    └── POST /api/generate  { agent: "decomposer" }
            └── ScaffoldData → validateScaffold() → topologicalSort() → layers[][]               └── DecomposerOutput { modules[], generateOrder[][] }
      └── for each layer (sequential):                                                            └── validateDecomposerOutput(): breakModuleCycles + topologicalSortModules
            runLayerWithFallback(...)                                                              └── createExecutionPlan(validated) + createInterfaceRegistry(validated)
              ├─ Attempt 1: all files in layer (parallel per file)                                 (失败时 fallback → simple path)
              ├─ Attempt 2: only failed files                                                └── POST /api/generate  { agent: "architect", skeletonMode: true }
              └─ Per-file fallback (circuit-breaker at 3 consecutive failures)                     └── skeleton files (shared types + root layout only)
      └── POST-PROCESSING (shared by both paths)                                                   └── mountAndStart(skeletonFiles) → WebContainer preview
                           →  findMissingLocalImportsWithNames()  →  ≤3 缺失文件时发起补全请求  └── ModuleOrchestrator.run() — while(plan.pending) pick→execute→observe→decide:
                           →  findMissingLocalImports()  →  stub 注入 / missing_imports 错误        ① planNext() — 依赖前置检查
                           →  checkImportExportConsistency()  →  ≤3 文件时发起修复请求               ② Architect(context + registry.toContextSummary + consumers)
                           →  checkDisallowedImports(allModuleSceneTypes)  →  ≤3 文件时发起修复请求              → validateScaffold(scaffold, knownExternalPaths)
                                                                                                     → Engineer × files (runLayerWithFallback)
                                                                                                  ③ registry.verifyContract() — declared vs actual exports
                                                                                                  ④ complete | patch(≤2) | degrade | fail→re-plan
                                                                                                     retry | stub | skipCascade
                           →  apply scaffold.removeFiles (delete old paths)
                           →  prepareFiles(files, projectId)  →  WebContainer (deduplicateImports + stubs + supabase)
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
| `new_project` | no existing code, or "重新做/start over" keywords | Full PM → complexity check → simple or complex path |
| `feature_add` | default when code exists | Full pipeline + V1 code injected into Engineer |
| `bug_fix` | "修复/bug/报错/没有反应…" keywords | Direct to Engineer only |
| `style_change` | "颜色/样式/dark mode/UI…" keywords | Direct to Engineer only |

Complexity check (after PM): `resolveComplexity(pm)` → `"complex"` if `pm.modules.length > 3` OR `pm.features.length > 5` OR `pm.complexity === "complex"`.

Context injected per path:
- **PM** (`feature_add`): `buildPmHistoryContext(rounds)` — formats up to 5 past rounds (userPrompt, intent summary, pmSummary) so PM writes a delta PRD
- **Decomposer** (complex path): `buildDecomposerContext(pm, existingFiles, scenes, gameSubtype?)` — PM output + scaffold rules + global scene hint + gameSubtype hint for ≤5 module decomposition. Each module in output includes `sceneType` and `engineeringHints` fields
- **Skeleton Architect** (complex path): `buildSkeletonArchitectContext(pm, decomposerOutput, existingFiles, scenes, gameSubtype?)` — designs shared types + root layout only, uses global scene classification
- **Module Architect** (complex path): `buildModuleArchitectContext(pm, moduleDef, skeletonFiles, completedModuleFiles, scenes, registrySummary?, planPosition?, consumers?, failedModules?, gameSubtype?)` — designs one module at a time; uses **per-module `sceneType`** (falls back to global scenes if absent); injects `engineeringHints` for LLM-generated coding guidance
- **Architect** (simple path): `resolveArchContext(rounds, pmOutput, existingFiles)` — calls `deriveArchFromFiles(existingFiles)` to build a real-time architecture summary
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
data: {"type":"pipeline_state","state":"DECOMPOSING","message":"正在拆解模块..."}   // complex path: state transitions
data: {"type":"skeleton_ready","files":{...}}                                      // complex path: skeleton files ready
data: {"type":"module_start","moduleName":"auth","index":0,"total":4}              // complex path: module fill started
data: {"type":"module_complete","moduleName":"auth","files":{...}}                 // complex path: module files ready
data: {"type":"module_failed","moduleName":"auth","reason":"..."}                  // complex path: module skipped
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
| `lib/types.ts` | All shared types: `AgentRole`, `Intent`, `SSEEvent`, `ScaffoldData`, `EngineerProgress`, `PmOutput`, `ArchOutput`, `RequestMeta`, `AttemptInfo`, `ChangedFiles`, `PipelineState`, `Complexity`, `DecomposerOutput`, `ModuleDefinition`, `ExportEntry`, `ModuleContract`, `ContractVerifyResult`, `ExecutionPlan`, `PlanRevision` |
| `lib/intent-classifier.ts` | `classifyIntent(prompt, hasExistingCode)` — keyword router that selects pipeline path |
| `lib/pipeline-controller.ts` | `createPipelineController()` — state machine: IDLE → CLASSIFYING → DECOMPOSING → SKELETON → MODULE_FILLING → POST_PROCESSING → COMPLETE |
| `lib/decomposer.ts` | `parseDecomposerOutput()`, `validateDecomposerOutput()` (clamps ≤5 modules, removes phantom deps, **breaks module cycles, recomputes topo order**, validates `sceneType` enum, defaults `engineeringHints`), `buildDecomposerContext()` |
| `lib/container-runtime.ts` | WebContainer singleton: `getContainer()`, `mountAndStart()`, `mountIncremental()`, `teardownContainer()`, `filesToWebContainerTree()` |
| `lib/agent-context.ts` | Context builders: `buildEngineerContext`, `buildDirectEngineerContext`, `buildDirectMultiFileEngineerContext`, `buildTriageContext`, `buildPmIterationContext`, `deriveArchFromFiles`, `buildDecomposerContext`, `buildSkeletonArchitectContext`, `buildModuleArchitectContext` |
| `lib/ai-providers.ts` | `AIProvider` interface, three provider classes, `resolveModelId`, `createProvider` |
| `lib/generate-prompts.ts` | System prompts + `snipCompletedFiles()` + `getMultiFileEngineerPrompt()` (includes retry hint) + `buildMissingFileEngineerPrompt()` + `buildMismatchedFilesEngineerPrompt()` + `buildDisallowedImportsEngineerPrompt()` + `getDecomposerSystemPrompt()` |
| `lib/extract-code.ts` | Multi-layer code extraction + `extractMultiFileCodePartial()` (partial salvage) + `findMissingLocalImports()` + `findMissingLocalImportsWithNames()` + `checkImportExportConsistency()` + `checkDisallowedImports(sceneTypes?)` |
| `lib/validate-scaffold.ts` | `validateScaffold(raw, knownExternalPaths?)` — 7-rule deterministic repair: self-ref → phantom dep → hints path → cycle breaking → removeFiles conflict → maxLines clamp → blocked deps removal. **`knownExternalPaths` preserves cross-module file refs during module-by-module generation** |
| `lib/engineer-circuit.ts` | `runLayerWithFallback` — 2 layer attempts → 2 per-file attempts → circuit breaker (3 consecutive failures) |
| `components/workspace/chat-area.tsx` | Core orchestration — intent classification, direct path, PM → complexity check → simple or complex pipeline, abort, progress |
| `components/preview/preview-frame.tsx` | WebContainer preview — `prepareFiles()`, `mountAndStart()`, `mountIncremental()`, crossOriginIsolated pre-flight, status states |
| `lib/model-registry.ts` | `MODEL_REGISTRY` 数组、`getAvailableModels()`、`DEFAULT_MODEL_ID` — 集中式模型定义与可用性检测 |
| `lib/generation-session.ts` | 内存 pub-sub 存储驱动实时 UI；`getSession`、`updateSession`、`subscribe` |
| `lib/engineer-stream-tap.ts` | `createEngineerStreamTap()` — 解析 `// === FILE:` 标记，emit `file_start/file_chunk/file_end` 事件 |
| `lib/coalesce-chunks.ts` | `coalesceChunks()` — 合并同路径连续 `file_chunk` 事件，降低 SSE 频率 |
| `lib/project-assembler.ts` | `assembleProject()` — 生成文件与 Next.js 模板合并，用于 export/deploy |
| `lib/vercel-deploy.ts` | `createVercelDeployment()`、`pollDeploymentStatus()` — Vercel API v13 集成 |
| `lib/zip-exporter.ts` | `createProjectZip()` — 将生成文件打包为可下载 ZIP |
| `lib/file-tree.ts` | `buildFileTree()` — 平铺路径 → 层级文件树（供文件资源管理器 UI 使用）|
| `lib/guest-cleanup.ts` | `deleteStaleGuestUsers()` — 定时清理 >5 天未活跃 Guest 账户 |
| `lib/version-files.ts` | `getVersionFiles()` (legacy/multi-file 统一读取) + `computeChangedFiles()` (版本间文件差异计算) |
| `lib/extract-json.ts` | 从 LLM 输出安全提取 JSON，含 fence 剥离与错误恢复 |
| `lib/scene-classifier.ts` | `classifySceneFromPrompt()` + `classifySceneFromPm()` — 8 种场景识别（game/game-engine/game-canvas/dashboard/crud/multiview/animation/persistence）。直接路径和简单路径使用全局分类；复杂路径由 Decomposer 按模块标注 `sceneType` |
| `lib/scene-rules.ts` | `getEngineerSceneRules()` + `getArchitectSceneHint()` — 场景专属 Architect/Engineer prompt 规则注入。复杂路径下按模块的 `sceneType` 注入（非全局），`general` 模块不注入硬编码规则，仅依赖 `engineeringHints` |
| `lib/lucide-icon-names.ts` | Lucide 图标名称列表，用于自动修正 LLM 生成的错误图标名 |
| `lib/error-codes.ts` | 生成错误码常量定义 |
| `lib/module-topo-sort.ts` | `breakModuleCycles()` + `topologicalSortModules()` — 模块级循环检测（DFS + 反向流启发式断环）和拓扑排序（Kahn's algorithm），用于 `validateDecomposerOutput` |
| `lib/extract-exports.ts` | `extractStructuredExports()` — 增强正则提取结构化导出信息（ExportEntry[]），替代单行正则匹配 |
| `lib/interface-registry.ts` | `createInterfaceRegistry()` — 模块间接口合约中央注册表；跟踪 declared vs actual exports，`verifyContract()` 验证，`toContextSummary()` 注入 Architect context |
| `lib/execution-plan.ts` | `createExecutionPlan()`, `planNext()`, `planComplete()`, `planSkipCascade()` — 可变执行计划，支持动态修订（retry/stub/skipCascade） |
| `lib/module-orchestrator.ts` | `createModuleOrchestrator()` — while 循环编排器：pick→execute→observe→decide，替代 chat-area.tsx 中的 for 循环。失败处理：retry（临时错误）、stub（轻度依赖）、skipCascade（重度依赖） |
| `app/api/generate/handler.ts` | `createHandler()` — SSE 生成编排器；Agent 路由、stream tap、代码提取、重试逻辑 |

### Known limitations & open issues

详见 `docs/adr/` 目录（ADR 0001–0029）。遇到相关问题时按需读取对应 ADR 文件。

当前未解决的限制：
- 平台游戏/物理模拟类项目（如超级马里奥）— 需要精确物理逻辑、碰撞检测、视口滚动，Phaser.js 可用但生成单次通过率低，纯 Canvas/SVG 实现可玩游戏超出单次 LLM 生成能力（需多轮迭代修复方案）
- WebContainer 首次启动约 15–20s — npm install 包含网络请求，无法缓存到用户本地
- 复杂项目生成总时长 3–8 分钟 — 多模块顺序串行，PM + Decomposer + Skeleton + 每模块 Architect/Engineer × N
