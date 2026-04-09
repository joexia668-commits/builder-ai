# Multi-File Generation Design

> Scaffold-first + parallel generation architecture for BuilderAI.

## Problem

The current system generates a single `App.js` file per project. This limits output to ~300 lines (8192 maxOutputTokens), cannot represent real project structures (15+ files), and has no reliable continuation mechanism when LLM output is truncated.

## Solution Overview

Replace single-file generation with a **scaffold-first, topologically-sorted parallel generation** pipeline:

```
PM → PRD (unchanged)
  ↓
Architect → Structured JSON scaffold (file manifest + interfaces + deps)
  ↓
Client: topological sort on deps → execution layers
  ↓
Engineer × N (parallel per layer, serial across layers)
  ↓
Assemble files → Sandpack multi-file render
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target scale | 15+ files | Real project structure |
| Generation strategy | Scaffold-first + parallel | Avoids truncation, fast, consistent |
| Storage | New `Version.files` JSON field | Clean separation, backward compatible |
| Editor | File tab bar + Monaco | Better editing UX, reuses existing investment |
| Batching strategy | Client-side topological sort | Deterministic, dependency-safe, leverages Architect's dep graph |

## Section 1: Architect Scaffold Output Format

Architect agent output changes from Markdown prose to **structured JSON** with `jsonMode: true`.

### Schema

```json
{
  "files": [
    {
      "path": "/App.js",
      "description": "Root component, composes all pages and layout",
      "exports": ["App"],
      "deps": ["/components/Layout.js", "/components/TodoList.js"],
      "hints": "Use useState to manage current page route"
    }
  ],
  "sharedTypes": "type Todo = { id: string; title: string; done: boolean }",
  "designNotes": "Minimalist style, Tailwind slate palette"
}
```

### Field Descriptions

| Field | Purpose |
|-------|---------|
| `path` | Sandpack file path (starts with `/`) |
| `deps` | Other project files this file imports (used for topological sort) |
| `exports` + `hints` | Interface contract passed to Engineer, ensures cross-file consistency |
| `sharedTypes` | Type definitions injected into every Engineer request |
| `designNotes` | Overall design direction for visual consistency |

### Architect Prompt

```
You are a senior system architect. You will receive the PM's PRD and design a multi-file React project structure.

Output: strict single JSON object.

JSON schema:
{
  "files": [
    {
      "path": "string (Sandpack path starting with /)",
      "description": "string (one-line responsibility)",
      "exports": ["string (exported function/component names)"],
      "deps": ["string (other project file paths this file depends on)"],
      "hints": "string (implementation guidance for Engineer)"
    }
  ],
  "sharedTypes": "string (shared type definitions code)",
  "designNotes": "string (overall design style notes)"
}

Constraints:
- React functional components + Hooks
- Tailwind CSS only (pre-configured in Sandpack)
- lucide-react for icons (only allowed external lib)
- Supabase via /supabaseClient.js if persistence needed
- No other npm packages allowed
- 8-20 files, each file single responsibility, under 150 lines
```

`jsonMode: true` enabled (same as PM agent).

## Section 2: Topological Sort + Parallel Generation

### Execution Flow

```
scaffold.files
    ↓
topologicalSort(files) → layers: string[][]
    ↓
Layer 0 (no deps, parallel):    ["/utils/format.js", "/hooks/useTodos.js"]
Layer 1 (depends on L0, parallel): ["/components/TodoItem.js", "/components/Header.js"]
Layer 2 (depends on L1, parallel): ["/components/TodoList.js", "/components/Layout.js"]
Layer 3 (depends on L2):           ["/App.js"]
    ↓
for each layer (serial):
  await Promise.all(
    layer.map(file => callEngineerForFile(file))
  )
  merge results into completedFiles
    ↓
Done → files_complete → Sandpack renders
```

### Engineer Request Context (per batch)

Each Engineer request receives:

1. User's original prompt (brief)
2. PM PRD (structured)
3. `scaffold.sharedTypes` (shared type definitions)
4. Target files: `path` + `description` + `hints` + `exports`
5. **Actual code** of completed dependency files (from prior layers)
6. Interface signatures of incomplete deps (should not occur due to topo sort)

Later-layer files see real code from earlier layers, not just interface hints. This maximizes cross-file consistency.

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Scaffold has 0 files | Error: "Architect output is empty, please retry" |
| Scaffold has 1 file | Single-layer generation, functionally equivalent to current single-file flow |
| Single file generation fails | Retry that file up to 2 times, don't block sibling files |
| Single file truncated | Very unlikely (single file ≤ 150 lines, 8K tokens sufficient). Falls back to existing retry + conciseness instruction |
| Circular dependency detected | Abort with user-facing error: "Architect output has circular deps, please retry" |
| Scaffold JSON parse fails | Retry Architect once, then error to user |

### Topological Sort Implementation

New file: `lib/topo-sort.ts` (~30 lines). Input: `Array<{ path: string; deps: string[] }>`. Output: `string[][]` (array of layers). Throws on cycle detection.

## Section 3: Data Layer + Backward Compatibility

### Schema Change

```prisma
model Version {
  id            String   @id @default(cuid())
  projectId     String
  versionNumber Int
  code          String        // Retained for backward compatibility
  files         Json?         // NEW: multi-file mapping {"path": "code", ...}
  description   String?
  agentMessages Json?
  createdAt     DateTime @default(now())
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, versionNumber])
}
```

### Unified Read Function

```typescript
// lib/version-files.ts
function getVersionFiles(
  version: { code: string; files?: Record<string, string> | null }
): Record<string, string> {
  if (version.files) return version.files as Record<string, string>;
  return { "/App.js": version.code };
}
```

All consumers read through this function:
- `workspace.tsx` — `currentFiles` state
- `preview-frame.tsx` — passes to `buildSandpackConfig`
- `code-editor.tsx` / `MultiFileEditor` — file content
- `version-timeline.tsx` — version restore

### Write Logic

`POST /api/versions` accepts:

```typescript
{
  projectId: string;
  files: Record<string, string>;
  description?: string;
}
```

Route handler writes both:
- `files` — the full multi-file mapping
- `code` — extracted from `files["/App.js"]` as backward-compatible fallback

## Section 4: Frontend Component Changes

### PreviewPanel + PreviewFrame

Props change from `code: string` to `files: Record<string, string>`:

```
PreviewPanel
  props: { files, projectId, isGenerating, onFilesChange, versions, ... }
  tab=preview → PreviewFrame({ files, projectId })
                  → buildSandpackConfig(files, projectId)
                  → Sandpack natively renders multi-file
  tab=code   → MultiFileEditor({ files, onFilesChange })
```

### MultiFileEditor (new component)

Wraps existing `CodeEditor` with a file tab bar:

```
┌────────────────────────────────────────────────┐
│ App.js │ Header.js │ useTodos.js │ ...         │  ← File tabs
├────────────────────────────────────────────────┤
│                                                │
│         Monaco Editor                          │
│         (reuses existing debounce/flush logic)  │
│                                                │
└────────────────────────────────────────────────┘
```

- Tabs generated from `Object.keys(files)`, sorted by path, `/App.js` pinned first
- Tab switch triggers debounce flush (reuses existing `pendingRef` logic)
- `onFilesChange` emits entire `Record<string, string>` (immutable update)
- Existing `CodeEditor` preserved as internal component

### Workspace State

```typescript
// Before
const [currentCode, setCurrentCode] = useState<string>(...)

// After
const [currentFiles, setCurrentFiles] = useState<Record<string, string>>(...)
```

`displayCode` → `displayFiles`, same logic, type changes.

### ChatArea Changes

Largest change. Engineer stage changes from single SSE call to **multi-layer parallel SSE**:

- New engineer sub-progress tracking
- `onCodeGenerated(code, version)` → `onFilesGenerated(files, version)`
- Topological sort logic imported from `lib/topo-sort.ts`

### buildSandpackConfig

```typescript
// Before
function buildSandpackConfig(code: string, projectId: string): SandpackConfig

// After
function buildSandpackConfig(files: Record<string, string>, projectId: string): SandpackConfig
```

Internally maps each `files` entry to `{ code: "..." }` format, merges with hidden `/supabaseClient.js`.

## Section 5: Prompt + Generate Route Changes

### Engineer Prompt (multi-file mode)

```
You are a full-stack engineer. Generate the specified files based on the following context.

Files to generate:
${filesToGenerate.map(f => `- ${f.path}: ${f.description} (exports: ${f.exports.join(", ")})`)}

Shared type definitions:
${scaffold.sharedTypes}

Implementation guidance:
${filesToGenerate.map(f => `${f.path}: ${f.hints}`)}

Completed dependency files (available for import):
${completedDepsCode}

Output format — use this separator for each file, no other content:
// === FILE: /components/Header.js ===
(complete code for Header.js)
// === FILE: /hooks/useTodos.js ===
(complete code for useTodos.js)
```

Each batch generates 2-4 files. Separator format `// === FILE: /path ===` chosen over JSON because LLMs handle raw code output better than JSON-escaped code strings.

### Generate Route Request Body

```typescript
// Extended (backward compatible)
{
  agent: "engineer",
  prompt: string,
  context: string,
  projectId: string,
  modelId?: string,
  // New optional fields for multi-file mode:
  scaffold?: ScaffoldData,
  targetFiles?: FileEntry[],
  completedFiles?: Record<string, string>
}
```

Route handler behavior:
- `agent === "architect"` → `jsonMode: true`
- `agent === "engineer"` + `targetFiles` present → multi-file prompt template + `extractMultiFileCode`
- `agent === "engineer"` + no `targetFiles` → legacy single-file logic (backward compatible)

### extractMultiFileCode

New function in `lib/extract-code.ts`:

```typescript
function extractMultiFileCode(
  raw: string,
  expectedFiles: string[]
): Record<string, string> | null
```

Splits by `// === FILE: /path ===`, runs `isCodeComplete()` on each segment. Returns full mapping if all files pass, `null` if any is incomplete.

## Section 6: Generation Progress UX

### AgentStatusBar

Engineer card shows sub-progress during multi-file generation:

```
PM ✓  →  Architect ✓  →  Engineer ⟳ Layer 2/4 (Header.js, Sidebar.js)
```

New progress state:

```typescript
interface EngineerProgress {
  totalLayers: number;
  currentLayer: number;
  currentFiles: string[];
  completedFiles: string[];
}
```

Engineer card displays:
- Progress text: "Layer 2/4"
- Currently generating file names
- Progress bar: `completedFiles.length / totalFiles`

### Chat Messages

Engineer completion produces **one summary message** (not per-batch):

```
Completed 12 files:
  /App.js, /components/Layout.js, /components/Header.js, ...
```

### Error Display

Per-file failure shows warning in AgentStatusBar without blocking:

```
Engineer ⚠️ Layer 2/4 — Header.js failed, retrying...
```

Files that fail after 2 retries are excluded from final output. Summary message notes which files failed.

## Files Changed Summary

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `files Json?` to Version |
| `lib/types.ts` | Add `ScaffoldData`, `FileEntry`, `EngineerProgress` types |
| `lib/version-files.ts` | **New** — `getVersionFiles()` helper |
| `lib/topo-sort.ts` | **New** — topological sort (~30 lines) |
| `lib/extract-code.ts` | Add `extractMultiFileCode()` |
| `lib/generate-prompts.ts` | Rewrite Architect prompt (JSON), add multi-file Engineer prompt |
| `lib/agent-context.ts` | Add `buildMultiFileEngineerContext()` |
| `lib/sandpack-config.ts` | `buildSandpackConfig` accepts `Record<string, string>` |
| `app/api/generate/route.ts` | Support `targetFiles`/`completedFiles` params, architect jsonMode |
| `app/api/versions/route.ts` | Accept `files` field, write both `code` + `files` |
| `components/workspace/workspace.tsx` | `currentCode` → `currentFiles` |
| `components/workspace/chat-area.tsx` | Multi-layer parallel Engineer orchestration |
| `components/preview/preview-panel.tsx` | Props: `code` → `files` |
| `components/preview/preview-frame.tsx` | Props: `code` → `files` |
| `components/preview/code-editor.tsx` | Keep as internal, wrapped by MultiFileEditor |
| `components/preview/multi-file-editor.tsx` | **New** — file tabs + Monaco |
| `components/agent/agent-status-bar.tsx` | Engineer sub-progress display |
