# Context Management Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Snip context compression, fallback retry for engineer layers, and two-phase architect output to reduce token cost, improve reliability, and increase generation quality.

**Architecture:** Three orthogonal changes: (1) `snipCompletedFiles` compresses non-dependency files to export signatures before injecting into prompts; (2) `runLayerWithFallback` retries failed layers then falls back to per-file requests with a circuit breaker; (3) architect system prompt adds `<thinking>/<output>` two-phase structure parsed by `extractScaffoldFromTwoPhase`.

**Tech Stack:** TypeScript strict, Jest (fake timers for retry tests), React (chat-area.tsx), Next.js App Router.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/engineer-circuit.ts` | Create | `retryWithBackoff`, `runLayerWithFallback`, circuit breaker state |
| `lib/generate-prompts.ts` | Modify | Add `snipCompletedFiles`; call it inside `getMultiFileEngineerPrompt`; update architect two-phase prompt |
| `lib/extract-json.ts` | Modify | Add `extractScaffoldFromTwoPhase` with `<output>` block parsing + fallback |
| `components/workspace/chat-area.tsx` | Modify | Extract `readEngineerSSE`; replace raw layer fetch with `runLayerWithFallback`; use `extractScaffoldFromTwoPhase` |
| `__tests__/engineer-circuit.test.ts` | Create | Unit tests for retry + circuit breaker |
| `__tests__/generate-prompts.test.ts` | Modify | Tests for `snipCompletedFiles` |
| `__tests__/extract-json.test.ts` | Modify | Tests for `extractScaffoldFromTwoPhase` |

---

## Task 1: `retryWithBackoff` utility

**Files:**
- Create: `lib/engineer-circuit.ts`
- Create: `__tests__/engineer-circuit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/engineer-circuit.test.ts`:

```typescript
import { retryWithBackoff } from "@/lib/engineer-circuit";

jest.useFakeTimers();

describe("retryWithBackoff", () => {
  beforeEach(() => jest.clearAllTimers());

  // EC-01: succeeds on first attempt — fn called once
  it("EC-01: 首次成功不重试", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, 3, 100);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // EC-02: fails once, succeeds on attempt 2
  it("EC-02: 第一次失败后重试成功", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    const promise = retryWithBackoff(fn, 3, 100);
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // EC-03: fails all attempts — throws last error
  it("EC-03: 耗尽重试次数后抛出最后错误", async () => {
    const err = new Error("always fails");
    const fn = jest.fn().mockRejectedValue(err);

    const promise = retryWithBackoff(fn, 3, 100);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(200);
    await expect(promise).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // EC-04: aborted before retry — throws Aborted
  it("EC-04: abort 信号触发后不重试", async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    const promise = retryWithBackoff(fn, 3, 100, controller.signal);
    controller.abort();
    await jest.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // EC-05: exponential backoff — delays double each attempt
  it("EC-05: 退避延迟指数增长（100ms → 200ms）", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const promise = retryWithBackoff(fn, 3, 100);
    expect(fn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1); // not yet
    await jest.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2); // after 100ms
    await jest.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(2); // not yet
    await jest.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3); // after 200ms
    await expect(promise).resolves.toBe("ok");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="engineer-circuit"
```

Expected: FAIL — "Cannot find module '@/lib/engineer-circuit'"

- [ ] **Step 3: Implement `retryWithBackoff`**

Create `lib/engineer-circuit.ts`:

```typescript
import type { ScaffoldFile } from "@/lib/types";

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 100,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, baseDelayMs * Math.pow(2, attempt));
          signal?.addEventListener(
            "abort",
            () => { clearTimeout(timer); reject(new Error("Aborted")); },
            { once: true }
          );
        });
      }
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="engineer-circuit"
```

Expected: PASS (EC-01 through EC-05)

- [ ] **Step 5: Commit**

```bash
git add lib/engineer-circuit.ts __tests__/engineer-circuit.test.ts
git commit -m "feat: add retryWithBackoff utility for engineer layer retries"
```

---

## Task 2: `runLayerWithFallback` with circuit breaker

**Files:**
- Modify: `lib/engineer-circuit.ts`
- Modify: `__tests__/engineer-circuit.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/engineer-circuit.test.ts`:

```typescript
import { retryWithBackoff, runLayerWithFallback } from "@/lib/engineer-circuit";
import type { ScaffoldFile } from "@/lib/types";

const FILE_A: ScaffoldFile = { path: "/A.js", description: "A", exports: ["A"], deps: [], hints: "" };
const FILE_B: ScaffoldFile = { path: "/B.js", description: "B", exports: ["B"], deps: ["/A.js"], hints: "" };
const FILE_C: ScaffoldFile = { path: "/C.js", description: "C", exports: ["C"], deps: [], hints: "" };

describe("runLayerWithFallback", () => {
  beforeEach(() => jest.clearAllTimers());

  // EC-10: full-layer request succeeds — returns files, no fallback
  it("EC-10: 整层请求成功，直接返回文件", async () => {
    const requestFn = jest.fn().mockResolvedValue({ "/A.js": "code-a", "/B.js": "code-b" });
    const result = await runLayerWithFallback([FILE_A, FILE_B], requestFn);
    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(requestFn).toHaveBeenCalledTimes(1);
  });

  // EC-11: layer fails 3×, fallback per-file both succeed
  it("EC-11: 整层失败后降级为逐文件请求", async () => {
    const requestFn = jest
      .fn()
      // 3 full-layer failures
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      // per-file: A succeeds
      .mockResolvedValueOnce({ "/A.js": "code-a" })
      // per-file: B succeeds
      .mockResolvedValueOnce({ "/B.js": "code-b" });

    const promise = runLayerWithFallback([FILE_A, FILE_B], requestFn);
    // advance through 3 layer retries: 100ms + 200ms
    await jest.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
  });

  // EC-12: fallback per-file: A fails, B succeeds — A in failed[]
  it("EC-12: 逐文件降级时部分文件失败", async () => {
    const fn = jest
      .fn()
      // 3 full-layer failures
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      // per-file A: 3 failures
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      // per-file B: success
      .mockResolvedValueOnce({ "/B.js": "code-b" });

    const promise = runLayerWithFallback([FILE_A, FILE_B], fn);
    await jest.advanceTimersByTimeAsync(700);
    const result = await promise;

    expect(result.failed).toContain("/A.js");
    expect(result.files["/B.js"]).toBe("code-b");
  });

  // EC-13: circuit breaker — 3 consecutive per-file failures → 4th file skipped
  // Circuit opens after consecutiveFailures >= 3, so need 4 files: A,B,C fail → D skipped
  it("EC-13: 断路器触发后剩余文件直接标记失败", async () => {
    const FILE_D: ScaffoldFile = { path: "/D.js", description: "D", exports: ["D"], deps: [], hints: "" };
    const fn = jest.fn().mockRejectedValue(new Error("API down"));

    const promise = runLayerWithFallback([FILE_A, FILE_B, FILE_C, FILE_D], fn);
    // 3 full-layer retries + 3×A + 3×B + 3×C retries = many timers
    await jest.advanceTimersByTimeAsync(3000);
    const result = await promise;

    // All 4 files in failed[]
    expect(result.failed).toContain("/A.js");
    expect(result.failed).toContain("/B.js");
    expect(result.failed).toContain("/C.js");
    expect(result.failed).toContain("/D.js");
    // D was never attempted (circuit was open after A, B, C consecutive failures)
    // Total calls: 3 (full) + 3 (A) + 3 (B) + 3 (C) = 12; D = 0
    const dCalls = fn.mock.calls.filter(([files]) => files.length === 1 && files[0].path === "/D.js");
    expect(dCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="engineer-circuit"
```

Expected: FAIL — "runLayerWithFallback is not a function"

- [ ] **Step 3: Implement `runLayerWithFallback`**

Append to `lib/engineer-circuit.ts`:

```typescript
export interface LayerResult {
  files: Record<string, string>;
  failed: string[];
}

export async function runLayerWithFallback(
  layerFiles: readonly ScaffoldFile[],
  requestFn: (files: readonly ScaffoldFile[]) => Promise<Record<string, string>>,
  signal?: AbortSignal
): Promise<LayerResult> {
  // Step 1: attempt full-layer request with retries
  try {
    const files = await retryWithBackoff(() => requestFn(layerFiles), 3, 100, signal);
    return { files, failed: [] };
  } catch {
    // Full-layer failed → fallback to per-file
  }

  // Step 2: per-file fallback with circuit breaker
  const result: LayerResult = { files: {}, failed: [] };
  let consecutiveFailures = 0;

  for (const file of layerFiles) {
    if (consecutiveFailures >= 3) {
      result.failed.push(file.path);
      continue;
    }
    try {
      const files = await retryWithBackoff(() => requestFn([file]), 3, 100, signal);
      Object.assign(result.files, files);
      consecutiveFailures = 0;
    } catch {
      result.failed.push(file.path);
      consecutiveFailures++;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run all engineer-circuit tests**

```bash
npm test -- --testPathPatterns="engineer-circuit"
```

Expected: PASS (EC-01 through EC-13)

- [ ] **Step 5: Commit**

```bash
git add lib/engineer-circuit.ts __tests__/engineer-circuit.test.ts
git commit -m "feat: add runLayerWithFallback with per-file fallback and circuit breaker"
```

---

## Task 3: `snipCompletedFiles` in generate-prompts

**Files:**
- Modify: `lib/generate-prompts.ts`
- Modify: `__tests__/generate-prompts.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/generate-prompts.test.ts`:

```typescript
import { snipCompletedFiles, getMultiFileEngineerPrompt } from "@/lib/generate-prompts";
import type { ScaffoldFile } from "@/lib/types";

describe("snipCompletedFiles", () => {
  const FILE_A: ScaffoldFile = {
    path: "/A.js", description: "A", exports: ["ComponentA"], deps: [], hints: "",
  };
  const FILE_B: ScaffoldFile = {
    path: "/B.js", description: "B", exports: ["ComponentB"], deps: ["/A.js"], hints: "",
  };

  const completedFiles = {
    "/A.js": "export function ComponentA() { return null; }\nconst x = 1;",
    "/util.js": "export const add = (a, b) => a + b;\nexport default function noop() {}",
  };

  // GP-SC-01: direct dep gets full code
  it("GP-SC-01: 直接依赖文件保留完整代码", () => {
    const result = snipCompletedFiles(completedFiles, [FILE_B]);
    expect(result["/A.js"]).toBe(completedFiles["/A.js"]);
  });

  // GP-SC-02: non-dep gets snipped header + export lines only
  it("GP-SC-02: 非依赖文件被压缩为 exports only", () => {
    const result = snipCompletedFiles(completedFiles, [FILE_A]);
    expect(result["/util.js"]).toContain("snipped — exports only");
    expect(result["/util.js"]).toContain("export const add");
    expect(result["/util.js"]).toContain("export default function noop");
    expect(result["/util.js"]).not.toContain("const x = 1");
  });

  // GP-SC-03: file with no exports gets placeholder comment
  it("GP-SC-03: 无导出的文件包含 placeholder 注释", () => {
    const noExports = { "/styles.js": "const x = 1;" };
    const result = snipCompletedFiles(noExports, [FILE_A]);
    expect(result["/styles.js"]).toContain("snipped — exports only");
    expect(result["/styles.js"]).toContain("(no exports found)");
  });

  // GP-SC-04: non-dep file gets snipped (shorter prompt) vs when it IS a dep (full code)
  it("GP-SC-04: 非依赖文件被 snip 后 prompt 比完整注入时更短", () => {
    const bigCode = "export function Big() {}\n".repeat(50);
    const completed = { "/A.js": bigCode };

    // Target does NOT depend on /A.js → /A.js gets snipped
    const targetNoDep: ScaffoldFile = {
      path: "/C.js", description: "C", exports: ["C"], deps: [], hints: "",
    };
    // Target DOES depend on /A.js → /A.js passed in full
    const targetWithDep: ScaffoldFile = {
      path: "/C.js", description: "C", exports: ["C"], deps: ["/A.js"], hints: "",
    };

    const promptSnipped = getMultiFileEngineerPrompt({
      projectId: "p1", targetFiles: [targetNoDep],
      sharedTypes: "", completedFiles: completed, designNotes: "",
    });
    const promptFull = getMultiFileEngineerPrompt({
      projectId: "p1", targetFiles: [targetWithDep],
      sharedTypes: "", completedFiles: completed, designNotes: "",
    });

    expect(promptSnipped.length).toBeLessThan(promptFull.length);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="generate-prompts"
```

Expected: FAIL — "snipCompletedFiles is not a function"

- [ ] **Step 3: Implement `snipCompletedFiles` and wire into `getMultiFileEngineerPrompt`**

In `lib/generate-prompts.ts`, add before `getMultiFileEngineerPrompt`:

```typescript
function extractExportSignatures(code: string): string {
  const exportLines = code
    .split("\n")
    .filter((line) => /^export\s/.test(line))
    .map((line) => line.replace(/\s*\{[\s\S]*$/, " {}").replace(/\s*=.*$/, "").trimEnd());
  return exportLines.length > 0 ? exportLines.join("\n") : "// (no exports found)";
}

export function snipCompletedFiles(
  completedFiles: Record<string, string>,
  targetFiles: readonly ScaffoldFile[]
): Record<string, string> {
  const directDeps = new Set<string>();
  for (const f of targetFiles) {
    for (const dep of f.deps) {
      directDeps.add(dep);
    }
  }

  const result: Record<string, string> = {};
  for (const [path, code] of Object.entries(completedFiles)) {
    if (directDeps.has(path)) {
      result[path] = code;
    } else {
      result[path] =
        `// === FILE: ${path} (snipped — exports only) ===\n` +
        extractExportSignatures(code);
    }
  }
  return result;
}
```

In `getMultiFileEngineerPrompt`, replace the `completedFileEntries` block (lines 118–121):

```typescript
// Before (remove this):
const completedFileEntries = Object.entries(completedFiles);

// After (replace with):
const snipped = snipCompletedFiles(completedFiles, targetFiles);
const completedFileEntries = Object.entries(snipped);
```

- [ ] **Step 4: Run all generate-prompts tests**

```bash
npm test -- --testPathPatterns="generate-prompts"
```

Expected: PASS (all existing + new GP-SC-01 through GP-SC-04)

- [ ] **Step 5: Commit**

```bash
git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
git commit -m "feat: add snipCompletedFiles to compress non-dependency context in engineer prompts"
```

---

## Task 4: `extractScaffoldFromTwoPhase` in extract-json

**Files:**
- Modify: `lib/extract-json.ts`
- Modify: `__tests__/extract-json.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/extract-json.test.ts`:

```typescript
import { extractScaffoldFromTwoPhase } from "@/lib/extract-json";
import type { ScaffoldData } from "@/lib/types";

const VALID_SCAFFOLD: ScaffoldData = {
  files: [
    { path: "/App.js", description: "Entry", exports: ["default"], deps: [], hints: "main" },
  ],
  sharedTypes: "type Id = string",
  designNotes: "minimal app",
};

describe("extractScaffoldFromTwoPhase", () => {
  // EJ-TP-01: valid two-phase format — returns scaffold from <output> block
  it("EJ-TP-01: 正确解析双阶段输出的 <output> 块", () => {
    const raw = `<thinking>
分析文件依赖关系...
</thinking>

<output>
${JSON.stringify(VALID_SCAFFOLD)}
</output>`;
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
    expect(result?.files[0].path).toBe("/App.js");
  });

  // EJ-TP-02: bare JSON (legacy format) — falls back to extractScaffold
  it("EJ-TP-02: 无 <output> 标签时回退到 extractScaffold 兼容解析", () => {
    const raw = JSON.stringify(VALID_SCAFFOLD);
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
    expect(result?.sharedTypes).toBe("type Id = string");
  });

  // EJ-TP-03: <output> block contains malformed JSON — falls back to bare JSON
  it("EJ-TP-03: <output> 块内 JSON 非法时回退到 bare JSON 解析", () => {
    const raw = `<thinking>...</thinking>\n<output>broken json</output>\n${JSON.stringify(VALID_SCAFFOLD)}`;
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
  });

  // EJ-TP-04: completely invalid input — returns null
  it("EJ-TP-04: 完全非法输入返回 null", () => {
    expect(extractScaffoldFromTwoPhase("not json at all")).toBeNull();
  });

  // EJ-TP-05: empty string — returns null
  it("EJ-TP-05: 空字符串返回 null", () => {
    expect(extractScaffoldFromTwoPhase("")).toBeNull();
  });

  // EJ-TP-06: <output> block with fenced JSON inside
  it("EJ-TP-06: <output> 块内包含 ```json 围栏时也能解析", () => {
    const raw = `<thinking>x</thinking>\n<output>\n\`\`\`json\n${JSON.stringify(VALID_SCAFFOLD)}\n\`\`\`\n</output>`;
    const result = extractScaffoldFromTwoPhase(raw);
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="extract-json"
```

Expected: FAIL — "extractScaffoldFromTwoPhase is not a function"

- [ ] **Step 3: Implement `extractScaffoldFromTwoPhase`**

Add to `lib/extract-json.ts` after `extractScaffold`:

```typescript
export function extractScaffoldFromTwoPhase(raw: string): ScaffoldData | null {
  const outputMatch = raw.match(/<output>\s*([\s\S]*?)\s*<\/output>/i);
  if (outputMatch) {
    const result = extractScaffold(outputMatch[1]);
    if (result) return result;
  }
  return extractScaffold(raw);
}
```

- [ ] **Step 4: Run all extract-json tests**

```bash
npm test -- --testPathPatterns="extract-json"
```

Expected: PASS (all existing + EJ-TP-01 through EJ-TP-06)

- [ ] **Step 5: Commit**

```bash
git add lib/extract-json.ts __tests__/extract-json.test.ts
git commit -m "feat: add extractScaffoldFromTwoPhase with <output> block parsing and legacy fallback"
```

---

## Task 5: Update architect system prompt for two-phase output

**Files:**
- Modify: `lib/generate-prompts.ts`
- Modify: `__tests__/generate-prompts.test.ts`

- [ ] **Step 1: Add failing test**

Append to `__tests__/generate-prompts.test.ts`:

```typescript
describe("architect two-phase prompt", () => {
  // GP-TP-01: architect prompt instructs <thinking> + <output> structure
  it("GP-TP-01: architect 提示词包含双阶段 <thinking>/<output> 结构指令", () => {
    const prompt = getSystemPrompt("architect", "proj-1");
    expect(prompt).toContain("<thinking>");
    expect(prompt).toContain("<output>");
    expect(prompt).toContain("</output>");
  });

  // GP-TP-02: <output> block must contain only JSON per prompt
  it("GP-TP-02: architect 提示词指示 <output> 块内只输出 JSON", () => {
    const prompt = getSystemPrompt("architect", "proj-1");
    expect(prompt).toMatch(/<output>[\s\S]*?JSON[\s\S]*?<\/output>/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="generate-prompts" --testNamePattern="GP-TP"
```

Expected: FAIL

- [ ] **Step 3: Update architect system prompt**

In `lib/generate-prompts.ts`, replace the last line of the `architect` prompt value (the `输出格式：严格输出单个 JSON 对象...` line) with:

```typescript
    architect: `你是一位资深系统架构师。你会收到 PM 的产品需求文档，需要设计多文件 React 应用的文件脚手架。

技术约束（必须遵守）：
- 使用 React 函数组件 + Hooks
- 样式使用 Tailwind CSS（已在 Sandpack 环境预配置）
- 如需数据持久化，使用 Supabase JS SDK（@supabase/supabase-js 已预装）
- 不使用 Next.js、路由、或任何 Node.js API
- 允许使用 lucide-react 图标库；绝对禁止使用 recharts、framer-motion 等其他外部库

【严禁包限制 - 违反将导致代码无法运行】
只允许使用以下外部依赖：
- lucide-react（图标库，已安装）
- /supabaseClient.js（数据库客户端，已注入）
- react 和 react-dom（已安装）

绝对禁止引入任何其他 npm 包，包括但不限于：
recharts, react-router-dom, axios, lodash, date-fns,
framer-motion, styled-components, react-query, zustand,
@radix-ui/*, @headlessui/*, classnames 等。

UI 样式只使用 Tailwind CSS class。
图标只使用 lucide-react。
HTTP 请求只使用原生 fetch API。

文件规划要求：
- 拆分为 8 到 20 个文件，每个文件单一职责，不超过 150 行
- 必须包含 /App.js 作为入口文件
- 每个文件明确导出内容和依赖关系

JSON schema：
{"files":[{"path":"string","description":"string","exports":["string"],"deps":["string"],"hints":"string"}],"sharedTypes":"string","designNotes":"string"}

字段说明：
- files: 文件列表，每项包含 path（文件路径）、description（职责描述）、exports（导出列表）、deps（依赖的其他文件路径）、hints（实现提示）
- sharedTypes: 所有文件共享的 TypeScript/JSDoc 类型定义
- designNotes: 整体设计说明和风格指南

输出格式（严格遵守两个阶段）：

<thinking>
在此分析文件拆分合理性、依赖关系、模块边界。内容不限，不出现在最终结果中。
</thinking>

<output>
{"files":[...],"sharedTypes":"...","designNotes":"..."}
</output>

<output> 块内只输出 JSON，不含任何其他内容。`,
```

- [ ] **Step 4: Run generate-prompts tests**

```bash
npm test -- --testPathPatterns="generate-prompts"
```

Expected: PASS (all existing + GP-TP-01, GP-TP-02)

- [ ] **Step 5: Commit**

```bash
git add lib/generate-prompts.ts __tests__/generate-prompts.test.ts
git commit -m "feat: update architect prompt to two-phase <thinking>/<output> structure"
```

---

## Task 6: Wire up in `chat-area.tsx`

**Files:**
- Modify: `components/workspace/chat-area.tsx`

This task has no new unit tests (the layer orchestration is integration-level; retry/snip/parse are already tested). Run the full suite to confirm no regressions.

- [ ] **Step 1: Add import for new utilities**

At the top of `components/workspace/chat-area.tsx`, add to existing imports:

```typescript
import { runLayerWithFallback } from "@/lib/engineer-circuit";
import { extractScaffoldFromTwoPhase } from "@/lib/extract-json";
```

- [ ] **Step 2: Replace `extractScaffold` call with `extractScaffoldFromTwoPhase`**

Find (around line 163):
```typescript
const scaffold = extractScaffold(outputs.architect);
```

Replace with:
```typescript
const scaffold = extractScaffoldFromTwoPhase(outputs.architect);
```

- [ ] **Step 3: Extract SSE reader helper**

Inside `ChatArea` (before `handleSubmit`), add the helper function:

```typescript
async function readEngineerSSE(
  body: ReadableStream<Uint8Array>
): Promise<Record<string, string>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let layerResult: Record<string, string> | null = null;

  const processLines = (lines: string[]) => {
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as {
          type: string;
          content?: string;
          code?: string;
          files?: Record<string, string>;
          error?: string;
        };
        if (event.type === "files_complete" && event.files) {
          layerResult = event.files;
        } else if (event.type === "code_complete" && event.code) {
          layerResult = { "/App.js": event.code };
        } else if (event.type === "error") {
          throw new Error(event.error ?? "Stream error");
        }
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) continue;
        throw parseErr;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    sseBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = done ? "" : (lines.pop() ?? "");
    processLines(lines);
    if (done) break;
  }
  if (sseBuffer.trim()) processLines([sseBuffer]);

  if (!layerResult) throw new Error("No files received from engineer");
  return layerResult;
}
```

- [ ] **Step 4: Replace the layer fetch block with `runLayerWithFallback`**

Find the block starting with `const response = await fetch("/api/generate", {` inside the engineer layer loop (around line 212), which ends just before `if (layerResult) {` (around line 280).

Replace the entire fetch + SSE reading block with:

```typescript
const layerResult = await runLayerWithFallback(
  layerFiles,
  async (files) => {
    const engineerPrompt = getMultiFileEngineerPrompt({
      projectId: project.id,
      targetFiles: files,
      sharedTypes: scaffold.sharedTypes,
      completedFiles: allCompletedFiles,
      designNotes: scaffold.designNotes,
    });

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        prompt,
        agent: "engineer",
        context: engineerPrompt,
        modelId: selectedModel,
        targetFiles: files,
        completedFiles: allCompletedFiles,
        scaffold: { sharedTypes: scaffold.sharedTypes, designNotes: scaffold.designNotes },
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }
    if (!response.body) throw new Error("No response body");
    setTransitionText(null);
    return readEngineerSSE(response.body);
  },
  abortController.signal
);
```

- [ ] **Step 5: Update the layerResult handling block**

Find the block after the old fetch (around line 280):
```typescript
if (layerResult) {
  Object.assign(allCompletedFiles, layerResult);
  setEngineerProgress((prev) =>
    prev ? { ...prev, completedFiles: Object.keys(allCompletedFiles) } : prev
  );
} else {
  allFailedFiles.push(...layerPaths);
  setEngineerProgress((prev) =>
    prev ? { ...prev, failedFiles: [...prev.failedFiles, ...layerPaths] } : prev
  );
}
```

Replace with:

```typescript
Object.assign(allCompletedFiles, layerResult.files);
if (layerResult.failed.length > 0) {
  allFailedFiles.push(...layerResult.failed);
}
setEngineerProgress((prev) =>
  prev
    ? {
        ...prev,
        completedFiles: Object.keys(allCompletedFiles),
        failedFiles: [...prev.failedFiles, ...layerResult.failed],
      }
    : prev
);
```

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: All tests PASS. Pay special attention to:
- `__tests__/chat-area-abort.test.tsx`
- `__tests__/chat-area-error-retry.test.tsx`
- `__tests__/workspace-generating.test.tsx`

- [ ] **Step 7: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: wire up runLayerWithFallback and extractScaffoldFromTwoPhase in ChatArea"
```

---

## Task 7: Smoke test end-to-end

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Create a multi-file project**

Open http://localhost:3000, create a new project, prompt: "一个任务管理应用，支持添加、删除、标记完成的待办事项，数据存储在 localStorage"

Expected: PM → Architect (with `<thinking>` in raw output) → Engineer layers complete without crashing, files appear in preview.

- [ ] **Step 3: Verify snip is active**

In browser DevTools → Network, find a `generate` request for engineer (layer 2+). Check the `context` field in the request payload — non-direct-dep files should show `(snipped — exports only)` headers instead of full code.

- [ ] **Step 4: Run full test suite one final time**

```bash
npm test
```

Expected: PASS

- [ ] **Step 5: Final commit if needed**

```bash
git add -p
git commit -m "chore: finalize context management optimization"
```
