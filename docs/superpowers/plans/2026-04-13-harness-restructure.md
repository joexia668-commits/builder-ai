# Harness Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate rule duplication across `common/` and `typescript/` directories, simplify project rules, and compress CLAUDE.md.

**Architecture:** Merge valuable content from `~/.claude/rules/common/` into `~/.claude/rules/typescript/` (new files + appends), remove duplicates from project `.claude/rules/code-conventions.md`, and trim CLAUDE.md by removing redundant sections and shrinking the key files table.

**Tech Stack:** Markdown files, no code changes.

---

### Task 1: Create `typescript/git-workflow.md`

**Files:**
- Create: `~/.claude/rules/typescript/git-workflow.md`

- [ ] **Step 1: Create the file**

```markdown
---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Git Workflow

## Commit Message Format
```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch
```

- [ ] **Step 2: Verify the file is valid**

Run: `cat ~/.claude/rules/typescript/git-workflow.md`
Expected: File contents displayed with frontmatter and two sections.

- [ ] **Step 3: Commit**

```bash
cd ~/.claude && git add rules/typescript/git-workflow.md && git commit -m "feat: add git-workflow to typescript rules (from common/)"
```

If `~/.claude` is not a git repo, skip the commit step.

---

### Task 2: Create `typescript/agents.md`

**Files:**
- Create: `~/.claude/rules/typescript/agents.md`

- [ ] **Step 1: Create the file**

```markdown
---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| architect | System design | Architectural decisions |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing code |
| security-reviewer | Security analysis | Before commits |
| build-error-resolver | Fix build errors | When build fails |
| e2e-runner | E2E testing | Critical user flows |
| refactor-cleaner | Dead code cleanup | Code maintenance |
| doc-updater | Documentation | Updating docs |
| rust-reviewer | Rust code review | Rust projects |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use **tdd-guide** agent
4. Architectural decision - Use **architect** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
```

- [ ] **Step 2: Verify the file is valid**

Run: `cat ~/.claude/rules/typescript/agents.md`
Expected: File contents displayed with frontmatter, agent table, and three sections.

---

### Task 3: Create `typescript/code-review.md`

**Files:**
- Create: `~/.claude/rules/typescript/code-review.md`

- [ ] **Step 1: Create the file**

Content from `common/code-review.md` with `paths:` frontmatter added. Strip the "Review Checklist" (duplicates coding-style.md), "Common Issues to Catch > Code Quality" (duplicates coding-style.md), and "Integration with Other Rules" (references will be to `common/` which is being deleted). Keep: When to Review, Security Review Triggers, Severity Levels, Agent Usage (narrowed to TS-relevant agents), Review Workflow, Approval Criteria, Security and Performance issues to catch.

```markdown
---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Code Review Standards

## When to Review

**MANDATORY review triggers:**

- After writing or modifying code
- Before any commit to shared branches
- When security-sensitive code is changed (auth, payments, user data)
- When architectural changes are made
- Before merging pull requests

**Pre-Review Requirements:**

Before requesting review, ensure:

- All automated checks (CI/CD) are passing
- Merge conflicts are resolved
- Branch is up to date with target branch

## Security Review Triggers

**STOP and use security-reviewer agent when:**

- Authentication or authorization code
- User input handling
- Database queries
- File system operations
- External API calls
- Cryptographic operations
- Payment or financial code

## Review Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Security vulnerability or data loss risk | **BLOCK** - Must fix before merge |
| HIGH | Bug or significant quality issue | **WARN** - Should fix before merge |
| MEDIUM | Maintainability concern | **INFO** - Consider fixing |
| LOW | Style or minor suggestion | **NOTE** - Optional |

## Agent Usage

| Agent | Purpose |
|-------|---------|
| **code-reviewer** | General code quality, patterns, best practices |
| **security-reviewer** | Security vulnerabilities, OWASP Top 10 |
| **typescript-reviewer** | TypeScript/JavaScript specific issues |

## Review Workflow

```
1. Run git diff to understand changes
2. Check security checklist first
3. Review code quality
4. Run relevant tests
5. Verify coverage >= 80%
6. Use appropriate agent for detailed review
```

## Common Issues to Catch

### Security

- Hardcoded credentials (API keys, passwords, tokens)
- SQL injection (string concatenation in queries)
- XSS vulnerabilities (unescaped user input)
- Path traversal (unsanitized file paths)
- CSRF protection missing
- Authentication bypasses

### Performance

- N+1 queries - use JOINs or batching
- Missing pagination - add LIMIT to queries
- Unbounded queries - add constraints
- Missing caching - cache expensive operations

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Warning**: Only HIGH issues (merge with caution)
- **Block**: CRITICAL issues found
```

- [ ] **Step 2: Verify the file is valid**

Run: `cat ~/.claude/rules/typescript/code-review.md`
Expected: File with frontmatter, no duplicate code quality checklist, no references to `common/`.

---

### Task 4: Create `typescript/development-workflow.md`

**Files:**
- Create: `~/.claude/rules/typescript/development-workflow.md`

- [ ] **Step 1: Create the file**

```markdown
---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Development Workflow

## Feature Implementation Workflow

0. **Research & Reuse** _(mandatory before any new implementation)_
   - **GitHub code search first:** Run `gh search repos` and `gh search code` to find existing implementations, templates, and patterns before writing anything new.
   - **Library docs second:** Use Context7 or primary vendor docs to confirm API behavior, package usage, and version-specific details before implementing.
   - **Exa only when the first two are insufficient:** Use Exa for broader web research or discovery after GitHub search and primary docs.
   - **Check package registries:** Search npm before writing utility code. Prefer battle-tested libraries over hand-rolled solutions.
   - **Search for adaptable implementations:** Look for open-source projects that solve 80%+ of the problem and can be forked, ported, or wrapped.
   - Prefer adopting or porting a proven approach over writing net-new code when it meets the requirement.

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Commit & Push**
   - Follow conventional commits format
   - See [git-workflow.md](./git-workflow.md) for commit message format and PR process

5. **Pre-Review Checks**
   - Verify all automated checks (CI/CD) are passing
   - Resolve any merge conflicts
   - Ensure branch is up to date with target branch
```

- [ ] **Step 2: Verify the file is valid**

Run: `cat ~/.claude/rules/typescript/development-workflow.md`
Expected: File with frontmatter and 6 workflow phases.

---

### Task 5: Append TDD + coverage to `typescript/testing.md`

**Files:**
- Modify: `~/.claude/rules/typescript/testing.md` (append after line 19)

- [ ] **Step 1: Append to the file**

Add the following after the existing content (after the `- **e2e-runner**` line):

```markdown

## Minimum Test Coverage: 80%

Test Types (ALL required):
1. **Unit Tests** - Individual functions, utilities, components
2. **Integration Tests** - API endpoints, database operations
3. **E2E Tests** - Critical user flows via Playwright

## Test-Driven Development

MANDATORY workflow:
1. Write test first (RED)
2. Run test - it should FAIL
3. Write minimal implementation (GREEN)
4. Run test - it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)
```

- [ ] **Step 2: Verify the file**

Run: `cat ~/.claude/rules/typescript/testing.md`
Expected: Original content (Playwright, e2e-runner) preserved at top, new TDD + coverage sections appended.

---

### Task 6: Append security checklist + triggers to `typescript/security.md`

**Files:**
- Modify: `~/.claude/rules/typescript/security.md` (append after line 29)

- [ ] **Step 1: Append to the file**

Add the following after the existing content (after the `- Use **security-reviewer** skill` line):

```markdown

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Security Review Triggers

**STOP and use security-reviewer agent when:**

- Authentication or authorization code
- User input handling
- Database queries
- File system operations
- External API calls
- Cryptographic operations
- Payment or financial code

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues
```

- [ ] **Step 2: Verify the file**

Run: `cat ~/.claude/rules/typescript/security.md`
Expected: Original content (Secret Management example, agent support) preserved at top, new checklist + triggers + protocol appended.

---

### Task 7: Delete `common/` directory

**Files:**
- Delete: `~/.claude/rules/common/` (entire directory, 10 files)

- [ ] **Step 1: Verify typescript/ has all needed content before deleting**

Run: `ls ~/.claude/rules/typescript/`
Expected: 9 files:
- `agents.md` (new)
- `code-review.md` (new)
- `coding-style.md` (existing)
- `development-workflow.md` (new)
- `git-workflow.md` (new)
- `hooks.md` (existing)
- `patterns.md` (existing)
- `security.md` (existing, appended)
- `testing.md` (existing, appended)

- [ ] **Step 2: Delete common/**

```bash
rm -rf ~/.claude/rules/common/
```

- [ ] **Step 3: Verify deletion**

Run: `ls ~/.claude/rules/`
Expected: Only `typescript/` directory remains.

---

### Task 8: Simplify project `code-conventions.md`

**Files:**
- Modify: `/Users/ruby/Projects/personal/builder-ai/.claude/rules/code-conventions.md`

- [ ] **Step 1: Replace the General section**

Replace lines 3-9 (the `## General` section) with:

```markdown
## General

- `import type { ... }` for type-only imports
```

This removes 4 lines that duplicate `typescript/coding-style.md`:
- "TypeScript strict mode enabled"
- "Immutable data patterns — always create new objects, never mutate"
- "No `any` type — use `unknown` and narrow"
- "Async/await only — no raw Promises or callbacks"

- [ ] **Step 2: Replace the Error Handling section**

Replace lines 67-72 (the `## Error Handling` section) with:

```markdown
## Error Handling

- API routes: return `{ error: string, details?: unknown }`
- AI API failures: show retry button, don't crash the page
```

This removes the generic principles ("try/catch with user-friendly toast", "never silently swallow") that are in `typescript/coding-style.md`, keeping only the project-specific API error shape and AI failure behavior.

- [ ] **Step 3: Verify the file**

Run: `cat /Users/ruby/Projects/personal/builder-ai/.claude/rules/code-conventions.md`
Expected: General section has 1 bullet, Error Handling has 2 bullets. All other sections unchanged.

- [ ] **Step 4: Commit**

```bash
cd /Users/ruby/Projects/personal/builder-ai
git add .claude/rules/code-conventions.md
git commit -m "refactor: remove global-duplicated rules from project code-conventions"
```

---

### Task 9: Compress CLAUDE.md — remove duplicate and derivable sections

**Files:**
- Modify: `/Users/ruby/Projects/personal/builder-ai/CLAUDE.md`

- [ ] **Step 1: Remove "Model selection priority chain" section**

Delete lines 109-117 (the `### Model selection priority chain` heading through the `A model is "available"...` line). This info is already in the flowchart at line 86.

- [ ] **Step 2: Remove "State management" section**

Delete lines 126-132 (the `### State management` heading through the `Workspace` bullet). Claude can read component files to learn state shape.

- [ ] **Step 3: Remove "Version system" section**

Delete lines 149-151 (the `### Version system` heading through the `useVersions tracks...` sentence). Simple logic readable from `version-files.ts`.

- [ ] **Step 4: Simplify "Intent classification & context memory" section**

Remove the duplicate `classifyIntent` description at line 92 (`classifyIntent(prompt, hasExistingCode) in lib/intent-classifier.ts — keyword-based router:`). Keep the intent table and the "Context injected per path" bullets — they add info not in the flowchart.

Replace the section heading and first line (lines 90-92) with just:

```markdown
### Intent classification & context memory
```

Followed directly by the intent table (no introductory text — the flowchart already explains this).

- [ ] **Step 5: Verify line count reduction**

Run: `wc -l /Users/ruby/Projects/personal/builder-ai/CLAUDE.md`
Expected: ~155-165 lines (down from 188).

---

### Task 10: Compress CLAUDE.md — shrink key files table

**Files:**
- Modify: `/Users/ruby/Projects/personal/builder-ai/CLAUDE.md`

- [ ] **Step 1: Replace the key files table**

Replace the full table (from `| File | Why |` through the last `email-login-form.tsx` row) with:

```markdown
| File | Why |
|------|-----|
| `lib/types.ts` | All shared types: `AgentRole`, `Intent`, `SSEEvent`, `ScaffoldData`, `EngineerProgress`, `PmOutput`, `ArchOutput`, `RequestMeta`, `AttemptInfo` |
| `lib/intent-classifier.ts` | `classifyIntent(prompt, hasExistingCode)` — keyword router that selects pipeline path |
| `lib/agent-context.ts` | Context builders: `buildEngineerContext`, `buildDirectEngineerContext`, `buildDirectMultiFileEngineerContext`, `buildPmIterationContext` |
| `lib/ai-providers.ts` | `AIProvider` interface, three provider classes, `resolveModelId`, `createProvider` |
| `lib/generate-prompts.ts` | System prompts + `snipCompletedFiles()` + `getMultiFileEngineerPrompt()` (includes retry hint) + `buildMissingFileEngineerPrompt()` |
| `lib/extract-code.ts` | Multi-layer code extraction + `extractMultiFileCodePartial()` (partial salvage) + `findMissingLocalImports()` + `findMissingLocalImportsWithNames()` |
| `lib/validate-scaffold.ts` | `validateScaffold(raw)` — 4-rule deterministic repair: self-ref → phantom dep → hints path → cycle breaking |
| `lib/engineer-circuit.ts` | `runLayerWithFallback` — 2 layer attempts → 2 per-file attempts → circuit breaker (3 consecutive failures) |
| `components/workspace/chat-area.tsx` | Core orchestration — intent classification, direct path, PM → Architect → layered Engineer, abort, progress |
```

- [ ] **Step 2: Verify final line count**

Run: `wc -l /Users/ruby/Projects/personal/builder-ai/CLAUDE.md`
Expected: ~120-130 lines.

- [ ] **Step 3: Commit**

```bash
cd /Users/ruby/Projects/personal/builder-ai
git add CLAUDE.md
git commit -m "refactor: compress CLAUDE.md — remove duplicates, trim key files table"
```

---

## Verification

After all tasks complete:

- [ ] `ls ~/.claude/rules/` shows only `typescript/` (no `common/`)
- [ ] `ls ~/.claude/rules/typescript/` shows 9 files
- [ ] `wc -l /Users/ruby/Projects/personal/builder-ai/CLAUDE.md` shows ~120-130 lines
- [ ] `cat /Users/ruby/Projects/personal/builder-ai/.claude/rules/code-conventions.md` has no "Immutable", "strict mode", "no any", or "Async/await" lines
