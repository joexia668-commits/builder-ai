# Sandpack 运行时自修复设计

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this spec.

**Goal:** 代码送入 Sandpack 后自动捕获运行时错误（ReferenceError、TypeError 等），构建修复 prompt 发给 Engineer，静默替换修复后的代码，最多 2 轮，形成 generate → preview → detect → fix 的闭环。

**方案选型:** 利用 Sandpack 的 `listen` API 捕获 `show-error` 消息，调 LLM 修复，静默回写。不捕获 console.error/warn，不处理用户手动编辑导致的错误。

---

## 1. 错误捕获

### 1.1 SandpackRuntimeError 类型

`lib/types.ts` 新增：

```typescript
export interface SandpackRuntimeError {
  readonly message: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}
```

### 1.2 useSandpackError Hook

新增 `hooks/use-sandpack-error.ts`：

- 在 `SandpackProvider` 内部使用
- 用 `useSandpack()` 的 `listen` 注册消息监听
- 过滤 `type === "action" && action === "show-error"` 消息
- 提取 `message`、`path`、`line`、`column`

**时间窗口控制：**
- 接收 `enabled: boolean` 参数
- 父组件在生成完成后设置 `enabled = true`，5 秒后设为 `false`
- 窗口外的错误不触发回调
- 去重：同一个错误消息只触发一次（避免 Sandpack 重编译重复报错）

**接口：**

```typescript
function useSandpackError(options: {
  enabled: boolean;
  onError: (error: SandpackRuntimeError) => void;
}): void
```

---

## 2. 修复流程

### 2.1 触发位置

在 `workspace.tsx` 中处理。`preview-frame.tsx` 通过 props 链上报错误到 workspace。

### 2.2 流程

```
Sandpack 报 show-error
  → useSandpackError 回调触发
  → preview-frame → preview-panel → workspace.onSandpackError(error)
  → workspace:
    1. 检查 fixAttempt < 2（最大 2 轮）
    2. 构建修复 prompt（buildRuntimeErrorFixPrompt）
    3. POST /api/generate { agent: "engineer", prompt: "修复运行时错误", context }
    4. 解析返回的修复代码（extractMultiFileCode 或 extractAnyMultiFileCode）
    5. 静默替换 currentFiles（setCurrentFiles）
    6. Sandpack 自动重编译
    7. fixAttempt++
    8. 重新开启 5 秒监听窗口
    
  第 2 轮：
    → 如果仍有错误 → 放弃，Activity 显示"运行时错误修复失败"
    → 如果没错误 → 更新版本（PATCH 最新版本的 files）
```

### 2.3 状态管理

`workspace.tsx` 新增状态：

```typescript
const [fixAttempt, setFixAttempt] = useState(0);
const [errorFixEnabled, setErrorFixEnabled] = useState(false);
```

- 每次生成完成后：`setFixAttempt(0)` + `setErrorFixEnabled(true)` + 5 秒后 `setErrorFixEnabled(false)`
- 每次修复尝试：`fixAttempt++` + 重新开启 5 秒窗口
- `fixAttempt >= 2`：停止，不再尝试

### 2.4 版本更新

修复成功后，不创建新版本，而是 PATCH 最新版本的 files：

```typescript
await fetchAPI(`/api/versions/${latestVersion.id}`, {
  method: "PATCH",
  body: JSON.stringify({ files: fixedFiles }),
});
```

需要在 `app/api/versions/[id]/route.ts` 新增 PATCH handler（仅更新 files 字段）。

---

## 3. 修复 Prompt

### 3.1 buildRuntimeErrorFixPrompt

新增于 `lib/generate-prompts.ts`：

```typescript
function buildRuntimeErrorFixPrompt(
  error: SandpackRuntimeError,
  allFiles: Readonly<Record<string, string>>,
  projectId: string
): string
```

**Prompt 内容：**

1. 错误描述：message、path、line、column
2. 出错文件完整代码（`// === EXISTING FILE: /path ===`）
3. 出错文件的直接 import 依赖的代码（通过 `extractFileImports()` 获取路径，最多 5 个）
4. 修复要求：
   - 只修复导致运行时错误的问题
   - 对可能为 undefined/null 的值加防御性检查
   - 不要引入新的外部包
   - 不要改变功能逻辑
5. 输出格式：`// === FILE: /path ===` + 修复后的完整代码

---

## 4. Props 传递链

```
workspace.tsx
  ├─ onSandpackError: (error: SandpackRuntimeError) => void
  ├─ errorFixEnabled: boolean
  └─ isFixingError: boolean（控制 UI 状态）
       ↓
preview-panel.tsx
  ├─ onSandpackError
  ├─ errorFixEnabled
  └─ isFixingError
       ↓
preview-frame.tsx
  ├─ onSandpackError
  ├─ errorFixEnabled
  └─ useSandpackError({ enabled: errorFixEnabled, onError: onSandpackError })
```

---

## 5. 影响范围

### 需要修改/新增的文件

| 文件 | 变更 |
|------|------|
| `lib/types.ts` | 新增 `SandpackRuntimeError` 接口 |
| `hooks/use-sandpack-error.ts` | 新增：Sandpack 错误监听 hook |
| `lib/generate-prompts.ts` | 新增 `buildRuntimeErrorFixPrompt()` |
| `components/preview/preview-frame.tsx` | 接入 `useSandpackError`，上报错误 |
| `components/preview/preview-panel.tsx` | 透传 `onSandpackError`、`errorFixEnabled`、`isFixingError` |
| `components/workspace/workspace.tsx` | 修复逻辑：接收错误 → 调 API → 替换文件 → 轮次控制 → 版本更新 |
| `app/api/versions/[id]/route.ts` | 新增 PATCH handler（更新 files 字段） |
| `__tests__/use-sandpack-error.test.ts` | hook 测试 |
| `__tests__/generate-prompts-runtime.test.ts` | prompt 构建测试 |

### 不需要改的

- 后处理管线（checkImportExportConsistency 等）
- AI 生成流程
- Sandpack 配置
- 时间线 UI

---

## 6. 不做的事

- **不捕获 console.error / console.warn** — 仅 `show-error` 崩溃级错误
- **不在用户手动编辑后触发** — 仅生成完成后 5 秒窗口内
- **不超过 2 轮修复** — 超过放弃
- **不创建中间版本** — 修复成功后 PATCH 最新版本
- **不改后处理管线** — 运行时兜底独立于静态检查
- **不做通用 AST 分析** — 依赖 Sandpack 的运行时错误报告
