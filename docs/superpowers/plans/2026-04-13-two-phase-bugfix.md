# Two-Phase Bug Fix Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight triage LLM call before the bug_fix/style_change Engineer call to identify which files need modification, then send only those files for code changes — preventing DeepSeek from regenerating all 15+ files and timing out.

**Architecture:** Phase 1 sends file paths (no code) to the LLM, which returns a JSON array of affected paths. Phase 2 feeds only those files (max 3) into the existing `buildDirectMultiFileEngineerContext`. Fallback to current full-file behavior if triage fails or returns too many paths.

**Tech Stack:** TypeScript, existing SSE infrastructure, no new dependencies.

---

### Task 1: `buildTriageContext` in `lib/agent-context.ts`

**Files:**
- Modify: `lib/agent-context.ts`
- Test: `__tests__/agent-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/agent-context.test.ts`:

```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmIterationContext,
  buildTriageContext,
} from "@/lib/agent-context";

// ... (existing tests above) ...

describe("buildTriageContext", () => {
  const prompt = "修复 dynamic_app_data 表名";
  const filePaths = ["/App.js", "/components/Layout.js", "/utils/db.js"];

  it("contains user prompt", () => {
    const result = buildTriageContext(prompt, filePaths);
    expect(result).toContain(prompt);
  });

  it("contains all file paths", () => {
    const result = buildTriageContext(prompt, filePaths);
    for (const p of filePaths) {
      expect(result).toContain(p);
    }
  });

  it("does not contain file contents", () => {
    const result = buildTriageContext(prompt, filePaths);
    expect(result).not.toContain("import ");
    expect(result).not.toContain("export ");
    expect(result).not.toContain("function ");
  });

  it("asks for JSON array output", () => {
    const result = buildTriageContext(prompt, filePaths);
    expect(result).toContain("JSON");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="agent-context" --testNamePattern="buildTriageContext"`
Expected: FAIL with "buildTriageContext is not a function"

- [ ] **Step 3: Implement `buildTriageContext`**

Add at the end of `lib/agent-context.ts` (before any closing line):

```typescript
/**
 * Build a lightweight context for the triage phase.
 * Includes only file paths (no code) so the LLM identifies which files
 * need modification without being tempted to regenerate everything.
 */
export function buildTriageContext(
  userPrompt: string,
  filePaths: string[]
): string {
  const pathList = filePaths.map((p) => `- ${p}`).join("\n");

  return `你是一位代码分析助手。根据用户反馈，判断以下 React 应用中哪些文件需要修改。

用户反馈：${userPrompt}

文件列表：
${pathList}

只输出一个 JSON 数组，包含需要修改的文件路径，不输出其他内容。
示例：["/App.js", "/components/Layout.js"]`;
}
```

Update the import at the top of `__tests__/agent-context.test.ts` to include `buildTriageContext`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="agent-context" --testNamePattern="buildTriageContext"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/agent-context.ts __tests__/agent-context.test.ts
git commit -m "feat(agent-context): add buildTriageContext for two-phase bug fix triage"
```

---

### Task 2: `triageMode` handling in `app/api/generate/handler.ts`

**Files:**
- Modify: `app/api/generate/handler.ts`

- [ ] **Step 1: Add `triageMode` to request body destructuring**

In `app/api/generate/handler.ts`, find the request body destructuring block (line ~36):

```typescript
const { agent, prompt, context, projectId, modelId, targetFiles, partialMultiFile } =
  body as {
    projectId: string;
    prompt: string;
    agent: AgentRole;
    context?: string;
    modelId?: string;
    partialMultiFile?: boolean;
    targetFiles?: Array<{
      path: string;
      description: string;
      exports: string[];
      deps: string[];
      hints: string;
    }>;
  };
```

Replace with:

```typescript
const { agent, prompt, context, projectId, modelId, targetFiles, partialMultiFile, triageMode } =
  body as {
    projectId: string;
    prompt: string;
    agent: AgentRole;
    context?: string;
    modelId?: string;
    partialMultiFile?: boolean;
    triageMode?: boolean;
    targetFiles?: Array<{
      path: string;
      description: string;
      exports: string[];
      deps: string[];
      hints: string;
    }>;
  };
```

- [ ] **Step 2: Override `maxOutputTokens` and `jsonMode` for triage**

Find the `completionOptions` block (line ~115-116):

```typescript
          const completionOptions: CompletionOptions =
            agent === "pm" ? { jsonMode: true } : {};
```

Replace with:

```typescript
          const completionOptions: CompletionOptions =
            triageMode
              ? { jsonMode: true, maxOutputTokens: 512 }
              : agent === "pm"
                ? { jsonMode: true }
                : {};
```

- [ ] **Step 3: Skip FILE extraction for triage**

Find the `if (agent === "engineer")` block (line ~156). Wrap the entire block with a triage guard:

```typescript
          if (agent === "engineer" && !triageMode) {
            // ... existing engineer extraction logic unchanged ...
          }
```

This means when `triageMode` is true, the handler streams raw chunks back (the JSON array) and sends `done` — no FILE-block extraction.

- [ ] **Step 4: Verify `CompletionOptions` supports `maxOutputTokens`**

Check `lib/ai-providers.ts` for the `CompletionOptions` type and ensure `maxOutputTokens` is supported. If not, add it.

In `lib/ai-providers.ts`, find the `CompletionOptions` interface (line ~15):

```typescript
interface CompletionOptions {
  jsonMode?: boolean;
}
```

Add `maxOutputTokens`:

```typescript
interface CompletionOptions {
  jsonMode?: boolean;
  maxOutputTokens?: number;
}
```

Then in each provider's `streamCompletion`, use `options?.maxOutputTokens` to override the instance-level `this.maxOutputTokens` when present:

**GeminiProvider** (line ~74): change `maxOutputTokens: this.maxOutputTokens` to `maxOutputTokens: options?.maxOutputTokens ?? this.maxOutputTokens`

**DeepSeekProvider** (line ~143): change `max_tokens: this.maxOutputTokens` to `max_tokens: options?.maxOutputTokens ?? this.maxOutputTokens`

**GroqProvider** (line ~198): change `max_tokens: this.maxOutputTokens` to `max_tokens: options?.maxOutputTokens ?? this.maxOutputTokens`

- [ ] **Step 5: Run full test suite**

Run: `npm test -- --testPathIgnorePatterns=".worktrees"`
Expected: All 843+ tests pass

- [ ] **Step 6: Commit**

```bash
git add app/api/generate/handler.ts lib/ai-providers.ts
git commit -m "feat(generate): handle triageMode flag — limit tokens, skip FILE extraction"
```

---

### Task 3: Triage phase in `components/workspace/chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

- [ ] **Step 1: Add `buildTriageContext` to imports**

Find the import from `@/lib/agent-context` (line ~20-27):

```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmHistoryContext,
  buildArchIterationContext,
} from "@/lib/agent-context";
```

Add `buildTriageContext`:

```typescript
import {
  buildEngineerContext,
  buildEngineerContextFromStructured,
  buildDirectEngineerContext,
  buildDirectMultiFileEngineerContext,
  buildPmHistoryContext,
  buildArchIterationContext,
  buildTriageContext,
} from "@/lib/agent-context";
```

- [ ] **Step 2: Add `triageAffectedFiles` helper function**

Add this function inside the component, before the `handleSubmit` function (or near the other helper functions). It can be a standalone async function at the top of the file, after the imports and before the component:

```typescript
async function triageAffectedFiles(
  prompt: string,
  currentFiles: Record<string, string>,
  projectId: string,
  modelId: string,
  signal: AbortSignal
): Promise<string[]> {
  const filePaths = Object.keys(currentFiles);
  const triageContext = buildTriageContext(prompt, filePaths);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        prompt,
        agent: "engineer",
        context: triageContext,
        modelId,
        triageMode: true,
      }),
      signal,
    });

    if (!response.ok || !response.body) return [];

    let accumulated = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "chunk" && event.content) {
            accumulated += event.content;
          }
        } catch { /* skip malformed lines */ }
      }
    }

    // Extract JSON array from accumulated text — LLM may include whitespace/newlines
    const jsonMatch = accumulated.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Intersect with actual file keys to discard hallucinated paths
    const validKeys = new Set(filePaths);
    return parsed.filter((p): p is string => typeof p === "string" && validKeys.has(p));
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Insert triage phase before direct multi-file path**

In the direct path block (line ~350), find:

```typescript
        const isMultiFileV1 = Object.keys(currentFiles).length > 1;
        const baseDirectContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, currentFiles)
          : buildDirectEngineerContext(prompt, currentFiles);
```

Replace with:

```typescript
        const isMultiFileV1 = Object.keys(currentFiles).length > 1;

        // Two-phase triage: identify affected files first, then send only those
        let triageFiles = currentFiles;
        if (isMultiFileV1) {
          updateAgentState("engineer", { status: "thinking", output: "正在分析需要修改的文件..." });
          const triagePaths = await triageAffectedFiles(
            prompt, currentFiles, project.id, selectedModel, abortController.signal
          );
          if (triagePaths.length > 0 && triagePaths.length <= MAX_PATCH_FILES) {
            triageFiles = Object.fromEntries(
              triagePaths.map((p) => [p, currentFiles[p]])
            );
          }
        }

        const baseDirectContext = isMultiFileV1
          ? buildDirectMultiFileEngineerContext(prompt, triageFiles)
          : buildDirectEngineerContext(prompt, currentFiles);
```

- [ ] **Step 4: Run full test suite**

Run: `npm test -- --testPathIgnorePatterns=".worktrees"`
Expected: All tests pass

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat(chat-area): add two-phase triage before bug_fix/style_change multi-file path"
```

---

### Task 4: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --testPathIgnorePatterns=".worktrees"`
Expected: All tests pass

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: `✓ Compiled successfully` (ignore DATABASE_URL and ESLint plugin conflict — they are pre-existing environment issues)

- [ ] **Step 3: Verify data flow matches spec**

Manually trace the code path:
1. `chat-area.tsx`: `intent === "bug_fix" && isMultiFileV1` → calls `triageAffectedFiles`
2. `triageAffectedFiles` → sends `{ triageMode: true }` to `/api/generate`
3. `handler.ts`: `triageMode` → `jsonMode: true`, `maxOutputTokens: 512`, skips FILE extraction
4. Client accumulates chunks → `JSON.parse` → intersect with `currentFiles` keys → `triagePaths`
5. `triagePaths.length > 0 && <= MAX_PATCH_FILES` → `triageFiles = pick(currentFiles, triagePaths)`
6. `buildDirectMultiFileEngineerContext(prompt, triageFiles)` → only 2-3 files passed
7. Fallback: triage fails / empty / >3 paths → `triageFiles = currentFiles` → unchanged behavior

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
