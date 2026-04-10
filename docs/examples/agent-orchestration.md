# Multi-Agent Orchestration — 详细说明

系统通过意图分类器（`lib/intent-classifier.ts`）将每次用户输入路由到不同的 Agent 编排路径，各路径在 Agent 数量、并发模式和上下文注入上差异显著。

## 路由总览

```
classifyIntent(prompt, hasExistingCode)
      │
      ├── bug_fix / style_change ────► [Engineer]                    ──► Sandpack
      │                                  单次 SSE 请求，~20s
      │
      ├── feature_add ───────────────► [PM] ─► [Architect] ─► [Engineer × N]  ──► Sandpack
      │                                  串行      串行         分层并行，~60s
      │
      └── new_project ───────────────► [PM] ─► [Architect] ─► [Engineer × N]  ──► Sandpack
                                         串行      串行         分层并行，~60s
```

意图分类优先级：`bug_fix` > `style_change` > `new_project` > `feature_add`（默认）

---

## 场景一：新建项目 `new_project`

三个 Agent 严格串行，Architect → Engineer 之间展开分层并行。

```
用户输入："做一个任务管理应用"
      │
      ▼
[PM Agent]  ──────────────────────────────────────── 单次 SSE 请求
  输入：用户原始需求
  输出：JSON PmOutput
        { intent, features[], persistence: "none"|"localStorage"|"supabase", modules[] }
      │
      ▼
[Architect Agent]  ────────────────────────────────── 单次 SSE 请求
  输入：PmOutput JSON
  输出（两阶段格式）：
        <thinking> 分析文件依赖关系、模块边界 </thinking>
        <output>
          {
            files: [{ path, description, exports[], deps[], hints }],
            sharedTypes: "...",
            designNotes: "..."
          }
        </output>
  处理：topologicalSort(files) → 按依赖关系分层 layers[][]
      │
      ▼
[Engineer Agent × N]  ─────────────────────────── 每层内文件并行，层间串行
  Layer 1（无依赖，并行生成）:
    → /App.js
    → /hooks/useTasks.js
  Layer 2（依赖 Layer 1，并行生成）:
    → /components/TaskList.js
    → /components/TaskForm.js
    → /components/Header.js
  Layer 3（依赖 Layer 2，并行生成）:
    → /components/TaskDetailView.js
  ...
  每层内文件并发调用 /api/generate，层间严格有序
      │
      ▼
  allFiles 汇聚
    → findMissingLocalImports()    # 检测幻觉导入，展示 missing_imports 错误
    → buildSandpackConfig(files)   # 注入 Proxy stub 防白屏
    → Sandpack 预览
    → POST /api/versions { files } # 不可变快照
```

**并发模式：** 层间串行 × 层内并行。10 文件项目分 3 层，SSE 请求数等于层数而非文件数，有效绕过单次请求 token 上限。

**上下文压缩（Snip）：** 每一层生成时，已完成文件按依赖关系差异化注入：直接依赖文件注入完整代码，非直接依赖只注入 export 签名行。

---

## 场景二：新增功能 `feature_add`

与新建项目相同的三 Agent 路径，但贯穿全链路注入了上一版本上下文，使各 Agent 输出增量而非重建。

```
用户输入："加一个分类筛选功能"（已有 V1 代码）
      │
      ▼
[PM Agent]
  常规输入：用户需求
  额外输入：buildPmIterationContext(lastPmOutput)
            ↳ 上一版本的 intent / features / modules 结构化摘要
  效果：PM 输出增量 PRD（"在现有 Todo 基础上新增分类筛选"），而非重建整个应用规划
      │
      ▼
[Architect Agent]
  输入：增量 PmOutput
  效果：Scaffold 只规划新增文件和需修改的文件，不重新规划已有文件
      │
      ▼
[Engineer Agent × N]
  常规输入：targetFile、scaffold、sharedTypes
  额外输入：existingFiles = currentFiles（V1 完整代码）
            ↳ 注入方式：// === EXISTING FILE: /path === 代码块
  效果：Engineer 看到 V1 实现，保留已有逻辑，只添加新功能
      │
      ▼
  merge(V1 files, new files) → Sandpack + /api/versions
```

**关键设计：** 上下文注入贯穿 PM、Engineer 两个节点，避免每次迭代"失忆"重建。`lastPmOutput` 和 `currentFiles` 由 `Workspace` 持有，跨多次生成累积。

---

## 场景三：修复 Bug / 调整样式 `bug_fix` | `style_change`

完全跳过 PM 和 Architect，直接路由到 Engineer。响应时间从 ~60s 降到 ~20s。

```
用户输入："按钮颜色改成蓝色" / "修复列表不更新的 bug"
      │
      ▼
[Engineer Agent]  ──────────────────────── 单次 SSE 请求（跳过 PM + Architect）
      │
      ├── 单文件 V1（/App.js only）:
      │     输入：buildDirectEngineerContext(prompt, currentFiles)
      │           ↳ <source file="/App.js"> V1 代码 </source>  XML 标签格式
      │     输出：code_complete event → onFilesGenerated({ "/App.js": newCode })
      │
      └── 多文件 V1（多个文件）:
            输入：buildDirectMultiFileEngineerContext(prompt, currentFiles)
                  ↳ targetFiles = 所有 V1 文件路径
            输出：files_complete event → merge(V1, newFiles) → onFilesGenerated(mergedFiles)
      │
      ▼
  Sandpack + /api/versions
```

**为什么用 XML 标签（`<source file="...">`）而非 `// === FILE:` 分隔符？**

`// === FILE:` 是 Engineer 的**输出格式**标记，若同时用于**输入**，LLM 会模式匹配并输出多文件格式，导致单文件 `extractReactCode` 失败。XML 标签语义上明确区分"输入参考"与"输出格式"，消除歧义。

---

## 容错与降级

Engineer 层内置三级容错，确保生成始终完成而非整体崩溃。

```
Engineer 层请求失败
      │
      ▼ 全层整体重试（指数退避，最多 3 次，间隔 100ms → 200ms → 400ms）
      │
      ▼ 仍失败 → 降级为逐文件单独请求（每文件各自重试 3 次）
      │
      ▼ 连续 3 个文件失败 → 熔断
        ↳ 剩余文件标记为 failed，已完成文件正常渲染，不全量抛错
```

其他降级策略：

| 场景 | 降级行为 |
|------|---------|
| Gemini 429 限速 | 自动 fallback 到 Groq；客户端收到 `reset` 事件后清空已缓冲输出，Groq 从头重新生成 |
| Engineer token 超限 | 追加"280 行以内，不写注释"指令后重试一次 |
| Scaffold 解析失败 | 回退到单文件 Engineer 路径（`extractReactCode`） |
| 缺失本地导入 | `findMissingLocalImports()` 检测后展示 `missing_imports` 错误；`buildSandpackConfig()` 注入 Proxy stub 防白屏 |

---

## SSE 事件协议

`/api/generate` 发送换行分隔的 JSON 流，客户端 `fetchSSE` 按 type 分发处理：

```
data: {"type":"thinking","content":"pm 正在分析..."}
data: {"type":"chunk","content":"..."}           // 流式文本增量
data: {"type":"reset"}                           // 限速 fallback，客户端清空缓冲
data: {"type":"code_complete","code":"..."}      // Engineer 单文件完成
data: {"type":"files_complete","files":{...}}    // Engineer 多文件完成
data: {"type":"done"}
data: {"type":"error","error":"...","errorCode":"rate_limited|parse_failed|missing_imports|context_overflow|..."}
```

---

## 模型选择优先级链

```
request-level modelId
    → project.preferredModel
    → user.preferredModel
    → AI_PROVIDER env var
    → DEFAULT_MODEL_ID ("gemini-2.0-flash")
```

每次 `/api/generate` 请求都独立走这条链，因此同一项目的不同 Agent 调用可以使用不同模型（例如在工作区内切换后即时生效）。
