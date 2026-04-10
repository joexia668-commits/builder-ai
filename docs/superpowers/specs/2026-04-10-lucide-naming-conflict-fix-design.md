# Design: Fix Lucide-React Naming Conflict in Generated Code

**Date:** 2026-04-10  
**Branch:** fix/calculator-naming-conflict  
**Status:** Approved

## Problem

When the Architect agent plans a component file whose export name matches a lucide-react icon name (e.g. `Calculator`, `History`, `Settings`), the Engineer agent generates `/App.js` that imports both:

```js
import { Calculator } from 'lucide-react';          // icon
import Calculator from '/components/Calculator.js'; // component
```

This causes a Babel parse error at runtime:

```
Identifier 'Calculator' has already been declared.
```

## Root Cause

The Architect prompt has no constraint preventing component export names from colliding with lucide-react icon names. The Engineer prompt has no rule requiring aliasing when such a collision occurs.

## Solution: A + B Dual-Prompt Guard

### A — Architect Prompt: Naming Convention

Add to the architect system prompt's file planning rules:

> 组件导出名必须加功能性后缀（如 `Panel`、`View`、`List`、`Form`），避免与 lucide-react 图标重名。例如：`CalculatorPanel` 而非 `Calculator`，`HistoryList` 而非 `History`，`SettingsPanel` 而非 `Settings`。

**Effect:** Prevents the collision at design time. The architect names the export `CalculatorPanel`, so the engineer imports `CalculatorPanel` from the file — no conflict with the `Calculator` icon.

### B — Engineer Multi-file Prompt: Alias Rule

Add to `getMultiFileEngineerPrompt` in `lib/generate-prompts.ts`:

> 若需要同时从 lucide-react 和本地文件导入同名符号，必须对图标做别名：`import { Calculator as CalculatorIcon } from 'lucide-react'`，然后在 JSX 中使用别名。

**Effect:** Catches any case that slips past A. If a conflict is detected at code-generation time, the engineer aliases the icon automatically.

## Scope

**Only file changed:** `lib/generate-prompts.ts`

- `getSystemPrompt('architect')` — append naming convention rule to 文件规划要求 section
- `getMultiFileEngineerPrompt()` — append alias rule to the existing 严禁包限制 block

**Not changed:**
- `getSystemPrompt('engineer')` — single-file path, no multi-component file imports
- All runtime logic, API routes, component code

## Why Not Option C (Post-processing Scan)

Post-processing import parsing adds maintenance cost for a low-frequency edge case. A + B dual-prompt coverage is sufficient and simpler.

## Testing

- Generate a calculator app and verify `/App.js` no longer has duplicate `Calculator` identifiers
- Generate a settings/menu app and verify `Settings`/`Menu` icons don't conflict with component exports
- Existing E2E tests should continue to pass
