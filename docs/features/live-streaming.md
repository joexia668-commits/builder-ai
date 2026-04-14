# 实时流式预览（Live Streaming）

## 概述

Engineer 生成多文件代码时，SSE 流以文本增量到达客户端。`lib/engineer-stream-tap.ts` 实现一个无副作用的流观测器，从原始 token 流中实时识别文件边界并发出结构化事件，驱动 Activity 标签页的逐文件实时代码展示。整个机制是纯观测层，不影响生成质量和解析逻辑。

## 设计思路

核心取舍：stream tap 对主流程零侵入——它只消费 `chunk` 事件的副本，最终 `files_complete` 到达后 `liveStreams` 被覆盖，UI 自动切换到完整版本。这意味着 tap 即使出错也不影响生成结果。

`SAFE_TAIL=256` 的设计：文件标记 `// === FILE: /path ===` 可能跨两个 token 到达，保留 256 字节缓冲区确保完整标记被识别，避免误发 `file_chunk`。

## 代码逻辑

### StreamTapEvent 类型

```typescript
export interface StreamTapEvent {
  readonly type: "file_start" | "file_chunk" | "file_end";
  readonly path?: string;   // 文件路径
  readonly delta?: string;  // 仅 file_chunk 携带内容
}
```

### createEngineerStreamTap

```typescript
export function createEngineerStreamTap(): EngineerStreamTap

export interface EngineerStreamTap {
  feed(delta: string): StreamTapEvent[];   // 喂入新 token，返回产生的事件
  finalize(): StreamTapEvent[];            // 流结束时冲刷剩余 buffer
  reset(): void;                           // 用于重试或切换文件时重置状态
}
```

文件标记正则：

```typescript
const FILE_HEADER_RE = /\/\/ === FILE: (\/[^\s=]+)[^\n]*(\n)?/;
const SAFE_TAIL = 256;
```

**feed() 逻辑**：

```
buffer += delta
loop:
  match = FILE_HEADER_RE.exec(buffer)
  if !match:
    if currentPath && buffer.length > SAFE_TAIL:
      emit file_chunk(buffer[0 .. -SAFE_TAIL])  // 安全输出前段
      buffer = buffer[-SAFE_TAIL..]
    break
  if match 末尾恰好在 buffer 边界且无换行符:
    break  // 延迟消费，等待下个 token 确认完整
  if currentPath && match.index > 0:
    emit file_chunk(currentPath, buffer[0..match.index])  // 当前文件剩余内容
  if currentPath:
    emit file_end(currentPath)
  currentPath = match[1]
  emit file_start(currentPath)
  buffer = buffer[match.end..]
```

**finalize() 逻辑**：

```
if currentPath && buffer.length > 0:
  emit file_chunk(currentPath, buffer)
if currentPath:
  emit file_end(currentPath)
buffer = ""; currentPath = null
```

### coalesceChunks

```typescript
export function coalesceChunks(events: readonly StreamTapEvent[]): StreamTapEvent[]
// 将同一文件的连续 file_chunk 事件合并为一条
// 条件：相邻两条事件均为 file_chunk 且 path 相同
```

减少 React re-render 次数，特别是在高频 token 流（如 DeepSeek）下。

### GenerationSession 中的 liveStreams

```typescript
interface GenerationSession {
  liveStreams: Record<string, LiveFileStream>;
  // ...
}

interface LiveFileStream {
  path: string;
  content: string;   // 已积累的代码内容
  isDone: boolean;   // file_end 收到后为 true
}
```

**更新逻辑**（chat-area.tsx）：

```
on file_start  → liveStreams[path] = { path, content: "", isDone: false }
on file_chunk  → liveStreams[path].content += delta
on file_end    → liveStreams[path].isDone = true
```

`updateSession(projectId, { liveStreams: { ...prev, [path]: updated } })` 触发 `notifyListeners`，使所有订阅者重渲染。

### useGenerationSession

`useSyncExternalStore(subscribe, getSession, () => EMPTY_SESSION)` — Activity 标签页通过此 hook 订阅实时流，无需 prop drilling。

```typescript
// components/workspace/chat-area.tsx 调用
updateSession(projectId, { liveStreams: newStreams })

// hooks/use-generation-session.ts 消费
const session = useGenerationSession(projectId)
session.liveStreams  // Record<string, LiveFileStream>
```

### 自愈：files_complete 覆盖

```
on files_complete:
  updateSession(projectId, { liveStreams: {} })  // 清空 tap 的中间状态
  onFilesGenerated(result.files)                 // 用完整解析结果更新 Sandpack
```

tap 的不完整中间状态被完整解析结果覆盖，UI 自动切换到最终版本。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| 正常多文件流 | feed() 识别边界，逐文件触发 file_start/chunk/end |
| 标记被 token 切割（跨两个 delta）| SAFE_TAIL buffer 延迟消费，等完整标记 |
| 最后一个文件无下个标记 | finalize() 冲刷剩余 buffer |
| 单次 delta 包含完整文件 | 一次 feed() 发出 file_start + file_chunk + file_end |
| 生成完成（files_complete）| liveStreams 清空，Sandpack 更新为最终代码 |
| AbortController 触发 | reset() 清空 tap 状态 |

## 未覆盖场景 / 已知限制

- **非标准标记变体**：LLM 偶发输出 `// ===FILE: /path===`（无空格）时 FILE_HEADER_RE 可能不匹配，tap 静默跳过该文件。
- **超长单行代码**：单行超过 `SAFE_TAIL=256` 字节时，file_chunk 可能在行中间截断，Activity 展示的是半行代码（视觉问题，不影响最终解析）。
- **单文件直接路径**：`code_complete` 事件不经过 stream tap，Activity 标签无实时展示（只显示最终结果）。
- **stream tap 失错不报告**：tap 是纯观测层，抛出的异常被静默忽略，不影响主流程但可能导致 liveStreams 状态不一致。

## 相关文件

- `lib/engineer-stream-tap.ts` — `createEngineerStreamTap`、`StreamTapEvent`
- `lib/coalesce-chunks.ts` — `coalesceChunks`
- `lib/generation-session.ts` — `GenerationSession`、`liveStreams`、`updateSession`
- `lib/types.ts` — `LiveFileStream`
- `components/workspace/chat-area.tsx` — tap 初始化和事件消费
