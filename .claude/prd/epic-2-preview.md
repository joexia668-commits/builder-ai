# EPIC 2: Sandpack 沙箱 + 伪全栈预览

| Field | Value |
|-------|-------|
| Goal | Engineer Agent 输出 React 代码，Sandpack 沙箱渲染 + Supabase 数据直连 |
| Business Value | "伪全栈"体验：纯前端沙箱 + BaaS 注入 = 可交互的真实应用 |
| Total Estimate | ~2h |
| Phase | Phase 2 of 4 |
| Status | **基础 Sandpack 已集成，需补充关键加固** |

## 架构说明

采用 **Sandpack (前端沙箱) + Supabase (BaaS 数据直连)** 的"降维打击"方案：

- AI 生成**纯 React 函数组件**（不生成后端代码）
- 组件在 Sandpack 沙箱中直接运行
- 沙箱预置 `/supabaseClient.js`，AI 生成的代码可直接 `import` 并操作 `dynamic_app_data` 表
- 平台自身数据（项目、消息、版本）通过 Prisma 存储

## 渲染策略：Hybrid Stable（核心决策）

**拒绝"流式渲染到 Sandpack"**，采用稳定的一次性更新策略：

| 阶段 | 左侧 Chat 区 | 右侧 Preview 区 |
|------|-------------|----------------|
| Agent 生成中 | 实时流式显示 Engineer 代码输出（markdown 预览） | Skeleton 加载动画 + "编译中..." 提示 |
| `code_complete` | Engineer 消息完成 | **一次性**更新 Sandpack files，渲染完整应用 |
| 生成完毕 | 所有 Agent 消息可回看 | 应用可交互，代码可在 Monaco 中编辑 |

### 为什么不做流式 Sandpack 更新？
1. Sandpack 对残缺 JSX 语法零容忍，每 500ms 喂不完整代码 → 频繁红屏闪烁
2. 高频 `setFiles()` 导致 React 重渲染风暴，浏览器 CPU 爆满
3. 一次性更新保证 100% 渲染成功率，Demo 演示绝对稳定

## 代码生成策略

### Engineer Agent 输出规范

```jsx
// AI 输出的代码格式（单个 React 函数组件）
export default function App() {
  // 可使用: useState, useEffect, useCallback, useRef
  // 样式: 原生 CSS（内联 style 或 /styles.css）
  // 持久化（可选）: import { supabase } from '/supabaseClient.js'
  return <div>...</div>
}
```

### Sandpack 预配置环境

```typescript
const SANDPACK_CONFIG = {
  template: "react",
  theme: "dark",
  files: {
    "/App.js": { code: generatedCode },
    "/supabaseClient.js": {
      code: `
        import { createClient } from '@supabase/supabase-js';
        export const supabase = createClient(
          '${NEXT_PUBLIC_SUPABASE_URL}',
          '${NEXT_PUBLIC_SUPABASE_ANON_KEY}'
        );
      `,
      hidden: true  // 隐藏，用户无需关注
    }
  },
  customSetup: {
    dependencies: {
      "@supabase/supabase-js": "^2.39.0",
      "lucide-react": "^0.300.0"
    }
  },
  options: {
    showConsole: true,
    showLineNumbers: true,
    showTabs: true,
    recompileDelay: 500
  }
};
```

## Supabase 客户端注入（P1 核心亮点）

### 注入机制
1. Sandpack `files` 对象中预置 `/supabaseClient.js`（hidden）
2. `customSetup.dependencies` 包含 `@supabase/supabase-js`
3. System Prompt 告知 AI：`import { supabase } from '/supabaseClient.js'`
4. AI 生成的代码直接操作 `dynamic_app_data` 表

### 数据表设计
```sql
-- dynamic_app_data 表结构（已在 Prisma schema 中）
id       UUID PRIMARY KEY
appId    TEXT   -- projectId，隔离不同应用数据
key      TEXT   -- 数据键，如 "todos"、"notes"
data     JSONB  -- 任意 JSON 数据
UNIQUE(appId, key)
```

### Prompt 注入模板
```
如果应用需要数据持久化（如待办、笔记），请使用已预置的 Supabase 客户端：
import { supabase } from '/supabaseClient.js';

操作 dynamic_app_data 表：
- 读取：supabase.from('dynamic_app_data').select('*').eq('app_id', '${projectId}')
- 写入：supabase.from('dynamic_app_data').upsert({ app_id: '${projectId}', key: 'todos', data: {...} })
```

## LLM 输出清洗加固（P1）

### 痛点
Gemini 有 ~20% 概率在代码前后添加 markdown 包裹或解释文字，导致代码提取失败。

### 清洗策略（`lib/extract-code.ts`）

三层提取，优先级递降：

1. **Markdown fence 优先**：`/```(?:jsx?|tsx?)\n([\s\S]*?)```/` — 精确捕获围栏内容
2. **头部定位**：无 fence 时，从 `import ` 或 `export default` 开始截取
3. **尾部截断保底**：找最后一个 `}` 截断，清除 LLM 追加的解释文字

```typescript
export function extractReactCode(raw: string): string {
  // 1. fence 优先
  const fenceMatch =
    raw.match(/```(?:jsx?|tsx?)\n([\s\S]*?)```/) ??
    raw.match(/```\n([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // 2. 头部定位
  let code = raw;
  const importIdx = code.indexOf('import ');
  const exportIdx = code.indexOf('export default');
  if (importIdx >= 0) code = code.substring(importIdx);
  else if (exportIdx >= 0) code = code.substring(exportIdx);

  // 3. 尾部截断：去掉最后一个 } 之后的解释文字
  const lastBrace = code.lastIndexOf('}');
  if (lastBrace >= 0) code = code.substring(0, lastBrace + 1);

  // 4. 确保有 export default
  if (!code.includes('export default')) {
    code += '\nexport default App;';
  }

  return code.trim();
}
```

### 兜底机制
如果清洗后代码仍无法被 Sandpack 渲染，显示友好的错误提示 + 重试按钮，而非白屏。

## Sandpack Error Boundary（P1）

```tsx
// 包裹 Sandpack 组件，防止沙箱内部报错拖垮父级 React 应用
<ErrorBoundary fallback={<SandpackErrorFallback onRetry={...} />}>
  <Sandpack {...config} />
</ErrorBoundary>
```

## Preview 区生成期间 Skeleton（P1）

```tsx
// 生成中：显示 Skeleton + 动画
{isGenerating ? (
  <div className="flex flex-col items-center justify-center h-full">
    <Skeleton className="w-full h-full" />
    <span className="text-sm text-muted-foreground mt-2">
      Engineer 正在编译应用...
    </span>
  </div>
) : (
  <Sandpack {...config} />
)}
```

## Tab 切换
- **预览 tab**: Sandpack Preview（实时渲染 React 应用）
- **代码 tab**: Monaco Editor（language: javascript，可编辑 App.js）

### 编辑联动
- Monaco 编辑代码 → **debounce 500ms** → 更新 `code` state → Sandpack `/App.js` 更新 → 自动重新渲染
- 注意：Sandpack 自身已有 `recompileDelay: 500`，但父组件 state 的高频更新仍会触发 React 重渲染，debounce 是必要的

## 验收标准

- [x] Engineer 输出代码后，Sandpack 渲染 React 应用
- [x] 代码 / 预览 Tab 切换正常
- [x] Monaco Editor 可编辑
- [ ] **Sandpack 内预置 `/supabaseClient.js`（hidden）**
- [ ] **生成的应用能通过 Supabase SDK 读写 `dynamic_app_data` 表**
- [ ] **LLM 输出清洗：fence 提取 + 头部定位 + 尾部 `}` 截断三层兜底**
- [ ] **生成期间 Preview 区显示 Skeleton，不闪白屏**
- [ ] **Sandpack Error Boundary 防止父页面崩溃**
- [ ] **常用依赖预装（supabase-js, lucide-react）**
- [ ] **Monaco onChange debounce 500ms，防止高频 state 更新**

## 依赖

- EPIC 1（多 Agent 对话系统）完成
- Supabase `dynamic_app_data` 表已创建（EPIC 0 schema）
