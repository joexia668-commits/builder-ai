# 多模型支持（Multi-Model Support）

## 概述

BuilderAI 支持 4 种 AI 模型（Gemini 2.0 Flash、Gemini 1.5 Pro、DeepSeek V3、Groq Llama 3.3 70B），通过统一的 `AIProvider` 接口抽象底层 SDK 差异。模型注册表位于 `lib/model-registry.ts`，Provider 实现和选择逻辑在 `lib/ai-providers.ts`。用户和项目均可设置偏好模型，请求级别可覆盖。

## 设计思路

核心取舍：每个 `/api/generate` 请求独立解析模型 ID，不共享 provider 实例。优点是无状态、易测试、可按 Agent 切换模型；代价是冷启动开销（SDK 初始化）每次请求都会发生。

`resolveModelId()` 的优先级链设计确保"最具体的配置最优先"：用户在工作区切换模型立即生效（request-level），无需修改项目或账户设置。API key 缺失时自动跳过该候选，防止因 key 未配置而中断。

## 代码逻辑

### MODEL_REGISTRY

```typescript
// lib/model-registry.ts
export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    providerModel: "gemini-2.0-flash",
    badge: "Fast",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    maxOutputTokens: 8192,
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "gemini",
    providerModel: "gemini-1.5-pro",
    badge: "Best",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    maxOutputTokens: 8192,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    providerModel: "deepseek-chat",
    badge: "Balanced",
    envKey: "DEEPSEEK_API_KEY",
    maxOutputTokens: 8192,
  },
  {
    id: "llama-3.3-70b",
    name: "Groq Llama 3.3 70B",
    provider: "groq",
    providerModel: "llama-3.3-70b-versatile",
    badge: "Fast",
    envKey: "GROQ_API_KEY",
    maxOutputTokens: 8192,
  },
]

export const DEFAULT_MODEL_ID = "deepseek-chat"
```

`envKey` 是必须非空的环境变量名；模型在 `getAvailableModels(env)` 中仅当对应 key 存在时才出现。

### AIProvider 接口

```typescript
export interface AIProvider {
  streamCompletion(
    messages: CompletionMessage[],
    onChunk: (text: string) => void,
    options?: CompletionOptions
  ): Promise<void>
}

export interface CompletionMessage {
  role: "system" | "user";
  content: string;
}
```

三个 Provider 类均实现此接口：

| 类 | SDK | 特殊处理 |
|----|-----|---------|
| `GeminiProvider` | `@google/generative-ai` | system + user 合并为单条 prompt；jsonMode → `responseMimeType: "application/json"` |
| `DeepSeekProvider` | `openai`（兼容 API，baseURL=api.deepseek.com）| `finish_reason === "length"` → throw `max_tokens_exceeded` |
| `GroqProvider` | `groq-sdk` | `finish_reason === "length"` → throw `max_tokens_exceeded` |

### STREAM_TIMEOUT_MS

```typescript
const STREAM_TIMEOUT_MS = 150_000  // 150 秒
```

每个 Provider 内部维护独立 `AbortController`，`setTimeout` 触发时 abort 流，抛出 `"stream timeout"` 错误。防止 Vercel serverless 函数被挂起到 300s 最大超时。

### createProvider（工厂函数）

```typescript
export function createProvider(modelId: string): AIProvider {
  const model = getModelById(modelId)
  if (!model) throw new Error(`Unknown model: ${modelId}`)
  switch (model.provider) {
    case "gemini":  return new GeminiProvider(model.providerModel, model.maxOutputTokens)
    case "deepseek": return new DeepSeekProvider(model.providerModel, model.maxOutputTokens)
    case "groq":    return new GroqProvider(model.providerModel, model.maxOutputTokens)
  }
}
```

### resolveModelId（优先级链）

```typescript
export function resolveModelId(
  requestModelId?: string | null,
  projectModelId?: string | null,
  userModelId?: string | null,
  env: Record<string, string | undefined> = process.env
): string
```

优先级（从高到低）：

```
1. requestModelId    — 工作区当前选择的模型（每次请求携带）
2. projectModelId    — 项目级别偏好（Project.preferredModel）
3. userModelId       — 用户级别偏好（User.preferredModel）
4. env.AI_PROVIDER   — 服务器环境变量
5. DEFAULT_MODEL_ID  — "deepseek-chat"
6. 第一个有 key 的模型 — 终极回退
```

每个候选通过 `getModelById(id)` 验证后，检查 `Boolean(env[model.envKey])`；API key 未设置则跳过该候选。

### isRateLimitError 与 Gemini → Groq 回退

```typescript
export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("quota exceeded")
  )
}
```

`withRetry()` 在捕获到 rate limit 错误时自动重试（最多 3 次，指数退避 1s→2s→4s）。若达到上限，`/api/generate` 路由捕获后在 SSE 流中发送 `{ type: "reset" }` 事件，客户端清空缓冲并以 Groq 作为回退模型重新发起请求。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| 工作区切换模型 | request-level modelId 覆盖所有低优先级设置 |
| 项目配置了偏好模型 | projectModelId 优先于 user 和 env |
| API key 未配置 | resolveModelId 跳过该候选，选下一个有 key 的模型 |
| Gemini 429 限速 | withRetry 重试，耗尽后 SSE reset → 客户端切 Groq |
| DeepSeek 输出超 token | finish_reason=length → throw max_tokens_exceeded → 触发上层重试 |
| 流超过 150s | AbortController abort → throw "stream timeout" |

## 未覆盖场景 / 已知限制

- **自定义 API endpoint**：DeepSeek baseURL 硬编码为 `api.deepseek.com`，不支持用户配置私有部署地址。
- **Provider 健康检查**：无主动 health check 机制，API key 存在但 provider 不可用时需等到请求失败才触发 fallback。
- **跨请求限速协调**：`withRetry` 是单次请求级别的，同一时刻多用户并发打到同一 provider 时无全局限速协调。
- **Gemini 1.5 Pro 与 2.0 Flash 共用同一 envKey**：两个 Gemini 模型共用 `GOOGLE_GENERATIVE_AI_API_KEY`，无法单独启用其中一个。
- **max_tokens_exceeded 后无自动缩减**：token 超限时上层重试注入"省略注释"提示，但没有自动截断 context 的机制。

## 相关文件

- `lib/model-registry.ts` — `MODEL_REGISTRY`、`ModelDefinition`、`DEFAULT_MODEL_ID`、`resolveModelId` 辅助
- `lib/ai-providers.ts` — `AIProvider` 接口、三个 Provider 类、`createProvider`、`resolveModelId`、`isRateLimitError`
- `lib/types.ts` — `CompletionOptions`
- `app/api/generate/route.ts` — 调用 `resolveModelId` 和 `createProvider`
- `components/workspace/workspace.tsx` — 工作区模型选择 state（`selectedModel`）
