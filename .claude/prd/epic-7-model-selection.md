# EPIC 7: 用户可选 AI 模型

| Field | Value |
|-------|-------|
| Goal | 允许用户在项目级别或全局级别选择不同的 AI 模型（Gemini Flash、Gemini Pro、DeepSeek V3、Groq Llama 3.3 70B） |
| Business Value | 提升用户对生成质量与速度的掌控感，支持多 Provider 对比，降低单一 API 依赖风险 |
| Total Estimate | ~10 天 |
| Phase | Phase 7 of 7 |

## 功能描述

用户可在工作区的 ChatInput 区域为当前项目选择 AI 模型，也可在 Header 用户菜单中设置全局默认模型。项目级选择优先级高于全局默认。模型偏好持久化到数据库，刷新页面后保留。生成时 `/api/generate` 根据传入的 `modelId` 动态路由到对应 AI Provider，未配置 API Key 的模型在 UI 中自动置灰不可选。

## 现有架构分析

当前 `app/api/generate/route.ts` 硬编码使用 DeepSeek（通过 `openai` SDK 兼容层），无法在运行时切换。`package.json` 已预安装三个 AI SDK 且 `.env.example` 已预留 `AI_PROVIDER` 变量，说明多模型支持是原始设计意图。

**关键现状：**

| 发现 | 位置 |
|------|------|
| DeepSeek 硬编码，不可切换 | `app/api/generate/route.ts` |
| `@google/generative-ai` 已安装未使用 | `package.json` |
| `groq-sdk` 已安装未使用 | `package.json` |
| `AI_PROVIDER` 环境变量已预留 | `.env.example` |
| Edge Runtime 兼容测试（`RT-E5-01~03`）当前失败 | `__tests__/generate-route.test.ts` |

## 数据层

### Schema 变更

`User` 和 `Project` 表各增加一个可空字段，与现有数据完全向后兼容：

```prisma
model User {
  // 现有字段...
  preferredModel  String?   // 全局默认模型 ID，如 "gemini-2.0-flash"
}

model Project {
  // 现有字段...
  preferredModel  String?   // 项目级模型覆盖，优先级高于 User.preferredModel
}
```

执行迁移：
```bash
prisma migrate dev --name add-preferred-model-to-user-and-project
```

### 模型解析优先级链

```
请求体 modelId → 有效 → 使用
              → 无效/缺失 → Project.preferredModel
                          → User.preferredModel
                          → 环境变量 AI_PROVIDER
                          → DEFAULT_MODEL_ID ("deepseek-chat")
```

## 新增核心模块

### `lib/model-registry.ts`

定义所有可用模型的元数据：

```typescript
export interface ModelDefinition {
  id: string;            // 逻辑 ID，如 "gemini-2.0-flash"
  name: string;          // 显示名，如 "Gemini 2.0 Flash"
  provider: "gemini" | "deepseek" | "groq";
  providerModel: string; // SDK 实际传入的 model 参数
  badge?: "Fast" | "Best" | "Balanced";
  description?: string;
  envKey: string;        // 判断是否已配置的环境变量 Key
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  { id: "gemini-2.0-flash",  provider: "gemini",   badge: "Fast",     envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "gemini-1.5-pro",    provider: "gemini",   badge: "Best",     envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "deepseek-chat",     provider: "deepseek", badge: "Balanced", envKey: "DEEPSEEK_API_KEY" },
  { id: "llama-3.3-70b",     provider: "groq",     badge: "Fast",     envKey: "GROQ_API_KEY" },
];

export const DEFAULT_MODEL_ID = "deepseek-chat";
```

### `lib/ai-providers.ts`

统一抽象层，隔离三个 SDK 的差异：

```typescript
export interface AIProvider {
  streamCompletion(
    messages: Array<{ role: "system" | "user"; content: string }>,
    onChunk: (text: string) => void
  ): Promise<void>;
}

// 三个实现：GeminiProvider、DeepSeekProvider、GroqProvider
// 工厂函数：createProvider(modelId: string): AIProvider
```

## API 变更

### `/api/generate/route.ts`

请求 Body 新增可选 `modelId` 字段：

```typescript
const { agent, prompt, context, projectId, modelId } = body;
```

- 删除硬编码的 `new OpenAI({ baseURL: deepseek })`，替换为 `createProvider(resolvedModelId)`
- 实现 `resolveModelId()` 辅助函数执行优先级链解析
- 非白名单 `modelId` 返回 `400 Bad Request`
- **同步修复**：将 `getServerSession` 替换为 `getToken`，补充 `export const runtime = 'edge'`（修复已失败的 `RT-E5-01~03` 测试）

### `app/api/user/preferences/route.ts`（新增）

```
GET  /api/user/preferences  → { preferredModel: string | null }
PATCH /api/user/preferences → { preferredModel: string } → 更新 User 表
```

### `/api/projects/[id]/route.ts`

PATCH 支持 `preferredModel` 字段更新（加白名单校验）。

## 前端交互流程

```
1. 进入工作区，从 project.preferredModel（或 User 全局偏好）初始化模型选择器
2. 用户通过 ChatInput 旁的 ModelSelector Dropdown 切换模型
   → PATCH /api/projects/{id} 持久化项目级偏好（带 debounce 500ms）
3. 用户发送 prompt
   → POST /api/generate { ..., modelId: selectedModel }
   → SSE 流式生成（与现有流程相同）
4. 用户在 Header 用户菜单 → "偏好设置"
   → Dialog 弹出全局 ModelSelector
   → PATCH /api/user/preferences
   → Toast 确认提示
```

## UI 交互细节

### ModelSelector 组件（`components/workspace/model-selector.tsx`）
- 基于现有 `DropdownMenu`（shadcn/ui）实现
- 展示：模型名称 + Provider 标识色块 + `Fast`/`Best` Badge
- 已禁用模型（对应 `envKey` 未配置）显示灰色且不可点击，附注"未配置"
- 生成进行中时整体 `disabled`

### ChatInput 集成
- `ModelSelector` 嵌入 Textarea 下方左侧，与现有"停止生成"按钮并列
- 选择后即时触发项目偏好持久化

### Header 全局偏好
- 用户头像 Dropdown 菜单新增"偏好设置"入口
- 点击弹出 Dialog，内含全局 `ModelSelector`
- 保存成功后 Toast 提示

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `lib/model-registry.ts` | 新增 |
| `lib/ai-providers.ts` | 新增 |
| `app/api/user/preferences/route.ts` | 新增 |
| `components/workspace/model-selector.tsx` | 新增 |
| `prisma/schema.prisma` | 修改：User + Project 各增 `preferredModel` |
| `app/api/generate/route.ts` | 修改：动态 Provider + Edge Runtime 修复 |
| `app/api/projects/[id]/route.ts` | 修改：PATCH 支持 `preferredModel` |
| `components/workspace/chat-input.tsx` | 修改：集成 ModelSelector |
| `components/workspace/chat-area.tsx` | 修改：维护 `selectedModel` state，随 generate 请求传出 |
| `components/workspace/workspace.tsx` | 修改：从 project 读取初始模型值 |
| `components/layout/header.tsx` | 修改：全局偏好设置入口 |
| `lib/types.ts` | 修改：`Project` 接口增 `preferredModel` 字段 |

## 验收标准

- [ ] ChatInput 下方显示模型选择器，展示当前激活模型名称与 Provider 标识
- [ ] 切换模型后刷新页面，选择仍保留（持久化到 Project 表）
- [ ] Header 用户菜单有"偏好设置"入口，可设置全局默认模型
- [ ] 项目级模型偏好优先级高于全局偏好
- [ ] 未配置 API Key 的模型在 Dropdown 中置灰，不可选择
- [ ] 生成进行中模型选择器不可操作
- [ ] 传入非白名单 `modelId` 时 `/api/generate` 返回 400
- [ ] Gemini Flash、DeepSeek V3、Groq Llama 三个 Provider 均可正常流式生成
- [ ] Edge Runtime 兼容测试 `RT-E5-01~03` 全部通过
- [ ] 模型切换后 Toast 提示保存成功

## 风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| Gemini SDK 流式 API 与 OpenAI SDK 接口差异 | 高 | `ai-providers.ts` 用 mock 单元测试驱动，覆盖全部分支 |
| Edge Runtime + Prisma 查询：`resolveModelId` 需查 DB | 中 | 将 `modelId` 解析前移至前端传入，路由仅做白名单校验，绕开 DB 查询 |
| `RT-E5-01~03` 当前已失败，影响 CI | 高 | Task 2.1 重构 `generate/route.ts` 时必须同步修复 |
| 生产环境 Groq API Key 遗漏配置 | 低 | ModelSelector 自动置灰，UX 层降级处理 |

## 依赖

- EPIC 0（项目骨架 + 认证）完成
- EPIC 1（多 Agent 协作 + `/api/generate`）完成
- `@google/generative-ai`、`groq-sdk` 已在 `package.json` 中安装
