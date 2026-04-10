# Iterative Context Memory System

**Date:** 2026-04-10
**Status:** Approved

## Problem

The current PM → Architect → Engineer pipeline is fully stateless. Every user prompt triggers a complete regeneration from scratch. Engineers receive no knowledge of previously generated code (V1), so:

- Bug reports ("按钮点击没反应") cause a full rewrite instead of a targeted fix
- Feature requests ("加个搜索") discard all existing V1 logic
- The PM assumes every request is a new project, generating requirements that ignore existing features

**Reference articles:**
- 文章06：记忆系统 — Agent 的长期记忆（memory as snapshot, inject only what agents can't derive themselves）
- 文章10：协调器模式 — 多智能体编排（intent-based routing, coordinator comprehends before delegating）

---

## Design Goals

1. Engineer can see V1 code when iterating — targeted modifications, not full rewrites
2. PM understands existing features when iterating — generates delta PRD, not rebuild PRD
3. Bug fixes and style changes skip PM + Architect entirely — 3x faster
4. Feature summaries cached after each generation — PM reads structured summary, not raw code

---

## Architecture

### Four Phases (enhanced pipeline)

```
User submits prompt
       ↓
Phase 0: Intent Classification  (new — lightweight, non-streaming JSON)
  · Classifies: new_project | bug_fix | feature_add | style_change
  · Skipped on first generation (no currentFiles)
       ↓
Phase 1: Context Assembly  (new)
  · Has feature summary? → prepared for PM
  · Has currentFiles? → prepared for Engineer
       ↓
Phase 2: Routed execution
  · bug_fix / style_change  → Engineer only (skip PM + Architect)
  · new_project             → PM → Architect → Engineer (no V1 context)
  · feature_add             → PM → Architect → Engineer (with V1 context)
       ↓
Phase 3: Engineer generation  (enhanced)
  · Receives complete currentFiles when iterating
  · Prompt instructs: "modify existing code, preserve working features"
       ↓
Phase 4: Background feature extraction  (new — async, non-blocking)
  · After generation completes, extract structured feature summary
  · Saved into version.metadata.featureSummary
```

---

## Component Design

### Phase 0: Intent Classifier

**Where:** `lib/intent-classifier.ts` (new file)

**Input:** `{ prompt: string, hasExistingCode: boolean }`

**Output:** `"new_project" | "bug_fix" | "feature_add" | "style_change"`

**Implementation:** Single non-streaming `/api/generate` call with a lightweight system prompt. Returns JSON `{ intent: string }`. Falls back to `feature_add` on parse failure.

**Routing rules:**

| Intent | Condition | Pipeline |
|--------|-----------|----------|
| `new_project` | No existing code, or user explicitly starts over | PM → Arch → Engineer |
| `bug_fix` | Keywords: 错误/bug/不工作/修复/报错/点击无效 etc. | Engineer only |
| `style_change` | Keywords: 颜色/字体/样式/布局/UI/美化 etc. | Engineer only |
| `feature_add` | Default for iterations with existing code | PM → Arch → Engineer |

### Phase 1: Context Assembly

**Where:** `lib/agent-context.ts` (extended)

**PM context when iterating:**
```
用户需求：${prompt}

当前应用已有功能（请在此基础上分析增量需求，不要重新设计已有功能）：
${featureSummary}   ← structured JSON summary, not raw code
```

**Engineer context when iterating:**
```
${pmArchContext}

当前版本代码（请在此基础上修改，保留已有功能逻辑）：
// === EXISTING FILE: /path ===
${code}
...
```

**For bug_fix / style_change (no PM/Arch):**
```
用户反馈：${prompt}

当前版本代码（请定向修复，最小化改动范围）：
// === EXISTING FILE: /path ===
${code}
```

### Phase 2: Routing

**Where:** `components/workspace/chat-area.tsx`

Logic added to `handleSubmit`:
- If `Object.keys(currentFiles).length === 0` → `new_project`, skip intent classification
- Else → call intent classifier, branch on result

Short-circuit path for `bug_fix` / `style_change`:
- Skip PM and Architect agent loops entirely
- Build engineer context from `currentFiles` + user prompt directly
- Call Engineer with this context

### Phase 3: Engineer Prompt (enhanced)

**Where:** `lib/generate-prompts.ts`

Engineer system prompt gains a conditional section:

```
// When iterating (existingFiles present):
当前版本代码已注入上下文。请：
1. 优先定向修改相关文件，不要重写不需要改动的部分
2. 保留已有功能逻辑
3. 修改范围最小化
```

### Phase 4: Background Feature Extraction

**Where:** `lib/feature-extractor.ts` (new file)

**Trigger:** After `onFilesGenerated` resolves in `chat-area.tsx`, fire-and-forget async call.

**Implementation:**
- Calls `/api/versions/:id` PATCH to update `metadata.featureSummary`
- Uses a lightweight prompt to extract structured summary from generated files:

```json
{
  "features": ["string"],
  "components": ["string"],
  "persistence": "none | localStorage | supabase"
}
```

**Token budget:** Small model, non-streaming, ≤500 tokens output.

---

## Data Model Changes

### Version metadata (existing `metadata Json` column — no schema migration needed)

```typescript
interface VersionMetadata {
  featureSummary?: {
    features: string[];
    components: string[];
    persistence: "none" | "localStorage" | "supabase";
  };
}
```

### Props changes

```typescript
// workspace.tsx → ChatArea
interface ChatAreaProps {
  // existing...
  currentFiles: Record<string, string>;        // new
  latestVersionMetadata?: VersionMetadata;     // new — for featureSummary
}
```

---

## Routing Decision Tree

```
Has currentFiles?
├── No  → new_project → full pipeline, no V1 context
└── Yes → Run intent classifier
          ├── bug_fix     → Engineer only + full V1 code
          ├── style_change→ Engineer only + full V1 code
          ├── new_project → full pipeline, no V1 context (user wants fresh start)
          └── feature_add → full pipeline + feature summary to PM + full code to Engineer
```

---

## Token Budget Considerations

| Context Injection | Recipient | Token estimate |
|-------------------|-----------|---------------|
| Feature summary JSON | PM | ~200 tokens |
| Full currentFiles | Engineer | ~3,000–8,000 tokens (Gemini Flash 1M ctx: fine) |
| Full currentFiles | Engineer (Groq fallback) | Same — Groq 128k ctx: fine for typical apps |

No token truncation needed for typical generated apps (≤20 files × 150 lines).

---

## File Change Summary

| File | Change type | Description |
|------|-------------|-------------|
| `lib/intent-classifier.ts` | New | Intent classification logic |
| `lib/feature-extractor.ts` | New | Background feature summary extraction |
| `lib/agent-context.ts` | Extend | Add `existingFiles` and `featureSummary` params |
| `lib/generate-prompts.ts` | Extend | Engineer system prompt iteration instructions |
| `components/workspace/chat-area.tsx` | Extend | Phase 0 intent routing + context assembly |
| `components/workspace/workspace.tsx` | Extend | Pass `currentFiles` + `latestVersionMetadata` to ChatArea |
| `app/api/versions/[id]/route.ts` | New route | PATCH endpoint for metadata update |

---

## What Is Not Changing

- Version storage is INSERT-only (immutable snapshots) — unchanged
- The multi-file layered generation (topological sort) — unchanged
- The SSE streaming protocol — unchanged
- PM → Architect context passing for `feature_add` — unchanged
- Authentication, model selection, abort logic — unchanged
