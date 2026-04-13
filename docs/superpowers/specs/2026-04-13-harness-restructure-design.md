# Harness Restructure Design

## Background

Based on OpenAI's harness engineering principles, the current `.claude` configuration has significant rule duplication and lacks automated feedback loops. This design addresses:

- **C: Global vs project rules confusion** — `common/` and `typescript/` directories contain overlapping content; project rules repeat global rules
- **D: Missing feedback loops** — deferred to future iteration (hooks not added now)

## Scope

### In Scope

1. Merge valuable `common/` content into `typescript/`, then delete `common/`
2. Simplify project `code-conventions.md` by removing overlap with `typescript/`
3. Compress `CLAUDE.md` (~188 → ~120 lines)

### Out of Scope

- CLAUDE.md split into table-of-contents style (deferred)
- New PostToolUse hooks for ESLint/tsc/tests (deferred)
- Changes to `tech-stack.md` or `project-structure.md`

## Design

### 1. Global Rules: `~/.claude/rules/`

#### 1.1 New files in `typescript/`

**`typescript/git-workflow.md`** — from `common/git-workflow.md`:
- Commit message format (conventional commits: feat, fix, refactor, docs, test, chore, perf, ci)
- PR workflow steps (analyze history, git diff, test plan, push with -u)
- Add `paths:` frontmatter for `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`

**`typescript/agents.md`** — from `common/agents.md`:
- Agent table (planner, architect, tdd-guide, code-reviewer, security-reviewer, build-error-resolver, e2e-runner, refactor-cleaner, doc-updater, rust-reviewer)
- Parallel execution principle
- Immediate agent usage triggers
- Add `paths:` frontmatter

**`typescript/code-review.md`** — from `common/code-review.md`:
- Review severity levels (CRITICAL/HIGH/MEDIUM/LOW) with actions
- Security review triggers (auth, user input, DB queries, file ops, external APIs, crypto, payments)
- Review workflow (git diff → security checklist → quality → tests → coverage)
- Approval criteria
- Add `paths:` frontmatter

**`typescript/development-workflow.md`** — from `common/development-workflow.md`:
- Research & Reuse workflow (GitHub search → library docs → Exa → package registries → adaptable implementations)
- Feature implementation phases overview (Plan → TDD → Review → Commit)
- Add `paths:` frontmatter

#### 1.2 Append to existing files

**`typescript/testing.md`** — append:
- TDD workflow: RED (write failing test) → GREEN (minimal implementation) → IMPROVE (refactor)
- 80% minimum coverage requirement
- Test types required: unit, integration, E2E

**`typescript/security.md`** — append:
- Mandatory security checks before commit (8-item checklist)
- Security review triggers (when to use security-reviewer agent)
- Security response protocol (stop → review → fix → rotate secrets → check codebase)

#### 1.3 Delete `common/` directory

All 10 files removed:
- `agents.md` → merged into `typescript/agents.md`
- `code-review.md` → merged into `typescript/code-review.md`
- `coding-style.md` → already covered by `typescript/coding-style.md`
- `development-workflow.md` → merged into `typescript/development-workflow.md`
- `git-workflow.md` → merged into `typescript/git-workflow.md`
- `hooks.md` → meta-docs, not needed
- `patterns.md` → already covered by `typescript/patterns.md`
- `performance.md` → Haiku/Sonnet/Opus irrelevant; extended thinking is default
- `security.md` → merged into `typescript/security.md`
- `testing.md` → merged into `typescript/testing.md`

### 2. Project Rules: `.claude/rules/code-conventions.md`

Remove sections that duplicate `typescript/coding-style.md`:
- "TypeScript strict mode enabled" line
- "Immutable data patterns" line
- "No `any` type — use `unknown` and narrow" line
- "Async/await only" line
- Error handling section (general principles — keep the project-specific API error shape `{ error, details? }`)

Keep project-specific content:
- `import type { ... }` for type-only imports
- Naming conventions table
- fetchAPI/fetchSSE abstraction (CRITICAL)
- React component patterns (functional only, `'use client'`, props interface)
- State management conventions
- CodeRenderer interface
- CSS conventions (Tailwind, shadcn/ui, `cn()`)
- Comments policy

### 3. CLAUDE.md Compression

#### 3.1 Key files table: 26 → 9 entries

Keep (non-obvious responsibilities):
- `lib/types.ts`
- `lib/intent-classifier.ts`
- `lib/agent-context.ts`
- `lib/ai-providers.ts`
- `lib/extract-code.ts`
- `lib/generate-prompts.ts`
- `lib/validate-scaffold.ts`
- `lib/engineer-circuit.ts`
- `components/workspace/chat-area.tsx`

Remove (name = function):
- `lib/model-registry.ts`
- `lib/extract-json.ts`
- `lib/topo-sort.ts`
- `lib/version-files.ts`
- `lib/sandpack-config.ts`
- `lib/error-codes.ts`
- `lib/auth.ts`
- `lib/resend.ts`
- `lib/demo-bootstrap.ts`
- `components/workspace/workspace.tsx`
- `components/layout/demo-banner.tsx`
- `components/layout/demo-login-button.tsx`
- `components/layout/email-login-form.tsx`
- `app/api/generate/route.ts`

#### 3.2 Remove duplicate sections

- **"Intent classification & context memory"** section (lines 90-107): The intent table is useful but the header text repeats the flowchart. Keep the intent table and context injection bullets, remove the duplicate `classifyIntent` description that's already in the flowchart.
- **"Model selection priority chain"** section (lines 109-117): Already shown in flowchart line 86. Remove entire section.

#### 3.3 Remove code-derivable sections

- **"State management"** (lines 127-132): Claude reads components to learn state shape
- **"Version system"** (lines 149-151): Simple logic, readable from `version-files.ts`

## Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Global rule files | 15 (10 common + 5 typescript) | 9 (typescript only) |
| Cross-file duplications | ~12 instances | 0 |
| CLAUDE.md lines | ~188 | ~120 |
| Context tokens saved | — | ~30% reduction in rules + CLAUDE.md |

## Risks

- **Agent table in global rules**: Lists `rust-reviewer` which only applies to Rust projects. Acceptable — it's in the agent registry regardless.
- **Removing `common/`**: Any future non-TS project would need its own rule set. Acceptable — user currently only does TS projects.
