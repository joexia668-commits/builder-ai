# Complex App Generation Design

> Unlock BuilderAI to generate relatively complex medium-sized applications: CRUD dashboards, data visualization panels, multi-page SaaS tools, and games (including Super Mario-style platformers).

## Problem

Seven constraints collectively create a hard ceiling on application complexity:

| Constraint | Current Limit | Impact |
|-----------|---------------|--------|
| Per-file lines | 150 (320 single-file) | Components too small for game loops, complex state |
| Allowed packages | 3 (react, react-dom, lucide-react) | No routing, charts, animations, state mgmt, game libs |
| Dependency compression | >5 deps -> signatures only | Engineer blind to implementations on complex files |
| Layer retries | 2 layer x 2 file + 3 circuit break | Complex dependency graphs hit breaker |
| Post-processing patch limit | Fixed 3 files | Larger gaps silently stubbed |
| Entry point | /App.js only | No code splitting |
| Import fix limit | Fixed 3 files | Large inconsistencies unfixed |

These constraints were sensible for small React UI apps. To support CRUD dashboards, data visualization, multi-page apps, and games, they must be selectively relaxed without regressing simple project quality.

## Design

### 1. Architect Scaffold Extension

Extend `ScaffoldData` to carry per-file line budgets and project-level dependency declarations.

**Type changes (`lib/types.ts`):**

```typescript
interface ScaffoldFile {
  path: string;
  purpose: string;
  deps: string[];
  maxLines?: number;                      // NEW: default 150, Architect can set 300-500
  complexity?: "normal" | "high";         // NEW: semantic label
}

interface ScaffoldData {
  files: ScaffoldFile[];
  dependencies?: Record<string, string>;  // NEW: e.g. { "recharts": "^2.0.0" }
  removeFiles?: string[];
}
```

**Rules:**
- `maxLines` defaults to 150 when omitted
- `complexity: "high"` is informational (for future use); `maxLines` is authoritative
- `dependencies` uses package.json format — Architect declares what the project needs
- Architect prompt provides a blacklist of forbidden packages (see Section 2)

### 2. Third-Party Packages: Blacklist + Dynamic Injection

**Current state:** Whitelist of 3 packages. Everything else is flagged as disallowed.

**New approach:** Blacklist of known-incompatible packages. Everything else is allowed.

**Blacklist (`lib/extract-code.ts`):**

```typescript
const BLOCKED_PACKAGES = new Set([
  // Node native modules
  "fs", "path", "child_process", "crypto", "os", "net", "http", "https",
  // Requires native compilation
  "sharp", "canvas", "puppeteer", "playwright", "better-sqlite3",
  // Oversized (>5MB)
  "three", "tensorflow", "@tensorflow/tfjs",
  // Server-only frameworks
  "express", "fastify", "koa", "next", "prisma",
]);
```

**Sandpack dynamic injection (`lib/sandpack-config.ts`):**

`buildSandpackConfig()` receives `scaffold.dependencies` and merges into `customSetup.dependencies`:

```typescript
customSetup: {
  dependencies: {
    "@supabase/supabase-js": "^2.39.0",
    "lucide-react": "^0.300.0",
    ...scaffoldDependencies,
  },
},
```

**`checkDisallowedImports()` logic reversal (`lib/extract-code.ts`):**
- Current: not in whitelist -> violation
- New: in blacklist -> violation; not in blacklist -> pass
- Additionally warn (but don't block) if an import is not in `scaffold.dependencies` and not a built-in (react/react-dom)

**Data flow:** Architect declares `dependencies` in scaffold -> `validateScaffold()` strips blacklisted entries -> `chat-area.tsx` stores `scaffold.dependencies` alongside scaffold state -> after all Engineer layers complete, `buildSandpackConfig(files, projectId, scaffoldDependencies)` receives and injects into Sandpack -> `checkDisallowedImports()` uses blacklist (not whitelist) to validate Engineer output. For direct path (no scaffold), `scaffoldDependencies` is `undefined` and `buildSandpackConfig` uses only the default dependencies.

### 3. Dynamic Per-File Line Limits

**Current state:** Hardcoded "150 lines per file" in Architect prompt, "compact style" in Engineer prompt.

**New approach:** Architect sets per-file `maxLines`, Engineer prompt reads it dynamically.

**Architect prompt changes:**
```
File splitting rules:
- UI components, utilities: maxLines 150
- Core business logic (game loops, state management, data processing): maxLines 300-500
- Declare maxLines for each file in scaffold output
- Total project line budget: no more than 3000 lines
```

**Engineer prompt changes (`lib/generate-prompts.ts`):**

`getMultiFileEngineerPrompt()` injects the file's `maxLines` dynamically:

```typescript
const lineLimit = currentFile.maxLines || 150;
// In prompt: "本文件代码行数控制在 ${lineLimit} 行以内"
```

**Single-file / direct path:** Unchanged at 320 lines. Direct path handles bug_fix/style_change, which don't involve complex project generation.

**Engineer prompt also changes:**
- Remove "不写注释" (no comments) constraint — files at 300+ lines benefit from key comments
- Remove "只能用 react/lucide-react/fetch" hardcoded constraint
- Replace with "use dependencies declared by Architect"

### 4. Dependency Compression Threshold

**Current state:** `COMPOSER_DEP_THRESHOLD = 5` — files with >5 dependencies receive only export signatures for all deps.

**Change:** Raise to 10.

```typescript
const COMPOSER_DEP_THRESHOLD = 10;
```

**Rationale:** Even in 20-file projects, few files have >10 direct dependencies. Files that do (typically top-level App.js) are orchestrators that only need signatures. Core logic files (game loop depending on physics engine) typically have 3-5 deps, well within threshold.

### 5. Dynamic Post-Processing Patch Limit

**Current state:** `MAX_PATCH_FILES = 3` (fixed).

**Change:** Dynamic based on total file count.

```typescript
const MAX_PATCH_FILES = Math.min(8, Math.max(3, Math.ceil(totalFiles * 0.3)));
```

| Total files | Patch limit |
|------------|-------------|
| 5 | 3 |
| 10 | 3 |
| 15 | 5 |
| 20 | 6 |
| 25+ | 8 (capped) |

**Applied to all three post-processing passes:**
1. Missing file completion (`findMissingLocalImportsWithNames`)
2. Import/export mismatch fixing (`checkImportExportConsistency`)
3. Disallowed package removal (`checkDisallowedImports`)

`totalFiles` is derived from `Object.keys(mergedFiles).length`.

### 6. Validation Layer Updates

**`lib/validate-scaffold.ts` — new rules (appended to existing 5):**

- Rule 6: `maxLines` must be in `[50, 500]`. Values outside this range are clamped.
- Rule 7: `dependencies` entries are checked against `BLOCKED_PACKAGES`. Matching entries are removed with a warning logged.

**Existing 5 rules unchanged:** self-ref, phantom dep, hints path, cycle breaking, removeFiles conflict.

## Files Changed

| File | Change |
|------|--------|
| `lib/types.ts` | Add `maxLines`, `complexity` to `ScaffoldFile`; add `dependencies` to `ScaffoldData` |
| `lib/generate-prompts.ts` | Update Architect/Engineer prompts: dynamic line limits, remove whitelist constraints, add blacklist guidance |
| `lib/extract-code.ts` | Replace `ALLOWED_EXTERNAL_PACKAGES` with `BLOCKED_PACKAGES`; reverse `checkDisallowedImports()` logic |
| `lib/sandpack-config.ts` | Accept `scaffoldDependencies` param; merge into `customSetup.dependencies` |
| `lib/validate-scaffold.ts` | Add rules 6-7: clamp `maxLines`, strip blacklisted `dependencies` |
| `components/workspace/chat-area.tsx` | Compute dynamic `MAX_PATCH_FILES`; pass `scaffold.dependencies` through to `buildSandpackConfig` |
| `app/api/generate/handler.ts` | Pass `maxLines` from scaffold to Engineer prompt builder |

## Backward Compatibility

- **Simple projects unchanged:** When Architect omits `maxLines` and `dependencies`, all defaults apply (150 lines, no extra packages). Behavior identical to current system.
- **No SSE protocol changes.**
- **No API interface changes.**
- **No database schema changes.**
- **Sandpack template remains `react`.**
- **Direct path (bug_fix/style_change) line limit unchanged at 320.**

## Risks

| Risk | Mitigation |
|------|-----------|
| AI fills large maxLines budget with padding/boilerplate | Architect prompt instructs to use high maxLines only for files that genuinely need it; Engineer prompt says "write substantial logic, not filler" |
| Sandpack can't install an Architect-chosen package | Sandpack shows runtime error; user sees error in preview. Existing runtime error detection + auto-fix (ADR 0021) handles this |
| Blacklist misses a broken package | Blacklist is append-only and easy to maintain. Runtime failures surface immediately in Sandpack preview |
| Token cost increases with larger files | Total project budget capped at 3000 lines. Dependency compression threshold (10) still limits context size |

## Out of Scope

- Multiple Sandpack templates (react/vanilla/vue) — React template covers all target use cases
- AI model changes or fine-tuning
- New SSE event types
- Database schema changes
- Export/deploy pipeline changes (assembleProject already handles arbitrary files)
