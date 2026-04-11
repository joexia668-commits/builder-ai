# Style Change Intent Regression — Design Spec

**Date:** 2026-04-11  
**Status:** Approved

---

## Problem

When a user generates a calculator app (V1) and then asks for a minor style change such as
"所有按键底色换成黄色", the entire layout and visual style is regenerated from scratch instead
of applying a targeted change.

### Root Cause 1 (primary): Intent misclassification

`classifyIntent` in `lib/intent-classifier.ts` uses a fixed keyword list (`STYLE_KEYWORDS`).
Chinese color words like `"黄色"`, `"底色"`, `"换色"`, `"红色"` are not in the list.
The prompt falls through to `feature_add`, triggering the full PM → Architect → Engineer
pipeline, which rewrites the whole application.

### Root Cause 2 (secondary): LLM re-emits all files in multi-file direct path

`buildDirectMultiFileEngineerContext` in `lib/agent-context.ts` instructs the LLM to output
**all** files including unchanged ones ("原样复制"). LLMs don't reliably follow this instruction
and silently alter styles in files they were not asked to touch.

---

## Fix Design

### Layer 1 — Intent Classifier (`lib/intent-classifier.ts`)

Add a second detection layer using regex patterns, evaluated after the keyword list:

| Pattern | Rationale |
|---------|-----------|
| `/[\u4e00-\u9fa5]{0,4}色/` | Matches any Chinese color word ending in 色 (黄色, 红色, 底色, 背景色, 配色…) |
| `/(换\|改\|变\|调)(成\|为\|掉\|一下)/` | Matches explicit change verbs (换成, 改为, 变成…) that signal style intent |
| `/#[0-9a-fA-F]{3,6}\|rgb\(\|rgba\(/i` | Matches CSS hex/rgb color values |

Additionally, extend `STYLE_KEYWORDS` with: `"圆角"`, `"阴影"`, `"shadow"`, `"border-radius"`,
`"加粗"`, `"字号"`.

Priority order remains: `bug_fix > style_change > new_project > feature_add`.

**Files changed:** `lib/intent-classifier.ts`

---

### Layer 2 — Multi-file Direct Path (`lib/agent-context.ts`)

Change `buildDirectMultiFileEngineerContext` to instruct the LLM to output **only files it
actually modifies**, not all files.

**Before (problematic instruction):**
> 必须输出全部文件（未修改的文件原样复制，不得省略）

**After (fixed instruction):**
> 只输出你实际需要修改的文件。未修改的文件不要输出——它们会被自动保留。

The merge in `chat-area.tsx` is already `{ ...currentFiles, ...directFiles }`, so:
- LLM outputs 1 modified file → all other files come from `currentFiles` unchanged ✅
- LLM outputs N modified files → each path overrides only that path ✅

`targetFiles` payload still passes all file paths to the server (so `extractMultiFileCode` is
used instead of `extractReactCode`). No server-side changes needed.

**Files changed:** `lib/agent-context.ts`

---

## Files in Scope

| File | Change |
|------|--------|
| `lib/intent-classifier.ts` | Add regex layer + extend STYLE_KEYWORDS |
| `lib/agent-context.ts` | Fix `buildDirectMultiFileEngineerContext` prompt instruction |

No changes to: `chat-area.tsx`, server routes, `extract-code.ts`, or database schema.

---

## Testing

- Unit test: `classifyIntent("所有按键底色换成黄色", true)` → `"style_change"`
- Unit test: `classifyIntent("把标题颜色改成 #ff0000", true)` → `"style_change"`
- Unit test: `classifyIntent("添加一个登录功能", true)` → `"feature_add"` (no regression)
- Unit test: `classifyIntent("修复按钮点击没反应", true)` → `"bug_fix"` (no regression)
- E2E: generate calculator → send "所有按键底色换成黄色" → verify layout unchanged, only button background color changes
