# Design: Proactive Export Normalization for AI-Generated Files

**Date:** 2026-04-11  
**Status:** Approved  
**Scope:** `lib/sandpack-config.ts`, `__tests__/sandpack-config.test.ts`

## Problem

Every multi-file AI-generated project shows:

```
Element type is invalid: expected a string (for built-in components)
or a class/function (for composite components) but got: undefined.
Check the render method of `<ComponentName>`.
```

This happens because the AI inconsistently follows the "both named and default export" prompt rule. When one file exports a component as `export default function X` (default only) and another file imports it as `import { X } from '/X.jsx'` (named import), React receives `undefined` at runtime.

The previous fix (`patchExportMismatches`, added in commit `b9f88bb`) attempted to solve this by analyzing import statements across files and patching the exporter side. It is **reactive and regex-brittle**: any import pattern the regex doesn't cover (combined imports, slight whitespace variation, etc.) silently skips the patch. The error persists on every multi-file generation.

## Solution

Replace `patchExportMismatches` with `normalizeExports` — a **proactive, import-analysis-free** normalization pass.

### Core Insight

Instead of inferring what a file *needs to export* by parsing consumers' import statements, inspect each file's *existing exports* directly and ensure both styles are always present. This eliminates the regex dependency on import patterns entirely.

### Algorithm

For each file in `userFiles`:

1. **Detect default export name**
   - `export default function X` / `export default class X` → name = `X`
   - `export default X;` (identifier re-export) → name = `X`
   - `export default () => ...` / `export default { ... }` → name = `null` (anonymous — skip)

2. **Collect named exports**
   - `export function X` / `export const X` / `export class X` → `X`
   - `export { X }` / `export { X as Y }` → `Y` (the public name)

3. **Bidirectional normalization**
   - Has default with name `X`, but `X` not in named set → append `export { default as X };`
   - Has named exports but no default → append `export default FirstNamed;`
   - Already has both → no change

### What This Covers

| AI output pattern | Consumer import | Result after normalization |
|---|---|---|
| `export default function X` | `import { X } from ...` | Appends `export { default as X }` ✓ |
| `export function X` | `import X from ...` | Appends `export default X` ✓ |
| `export function X; export default X` | either style | No change needed ✓ |
| `export default () => ...` | any | No name → no append, stub injection handles it ✓ |

### Layered Defence (unchanged)

This fix is layer 2 of a 3-layer defence:

1. **Prompt rule** (`getMultiFileEngineerPrompt`): Engineer is instructed to always emit both export styles. Reduces LLM non-compliance but not eliminated.
2. **`normalizeExports`** (this fix): Proactively adds missing export styles to all generated files before Sandpack bundles them.
3. **Stub injection** (`findMissingLocalImportsWithNames`): For files the AI never generated at all, creates named-export stubs so nothing resolves to `undefined`.

## Files Changed

| File | Change |
|---|---|
| `lib/sandpack-config.ts` | Replace `patchExportMismatches` function with `normalizeExports`; update call site |
| `__tests__/sandpack-config.test.ts` | Add 6 unit tests covering the normalization cases |

## Test Cases

| # | Input | Expected |
|---|---|---|
| 1 | `export default function X() {}` only | Appends `export { default as X }` |
| 2 | `export function X() {}` only | Appends `export default X` |
| 3 | Both `export function X` and `export default X` present | No change |
| 4 | `export default X;` (identifier re-export) | Appends `export { default as X }` |
| 5 | Multiple named exports, no default | Appends `export default FirstNamed` (first in source order) |
| 6 | Anonymous default `export default () => null` | No append (no name to infer) |

## Out of Scope

- `generate-prompts.ts` — prompt rule stays as first-line defence, no changes
- `extract-code.ts` — stub injection is a separate concern, no changes
- Relative imports (`./X.jsx`) — the engineer prompt constrains the AI to absolute paths; normalizing exports makes the import style irrelevant
