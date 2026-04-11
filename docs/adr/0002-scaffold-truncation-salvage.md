# ADR 0002 — Architect scaffold 截断级联 与 salvage 抢救

**日期：** 2026-04-11
**状态：** Accepted
**相关 commits：** `2919d5f`, `c26dda9`, `493f755`, 本次 cleanup commit

---

## 触发事件

线上生产环境（Vercel Hobby + DeepSeek V3）下，用户在一个已有代码的项目里发出"生成类似苹果手机的密码管理器"需求，**多次重试全部失败，预览面板始终空白**。浏览器 DevTools 里看到：

```
[sse:5psp] (engineer) event #3135 {type: 'error', error: '生成的代码不完整，请重试', errorCode: 'parse_failed'}
[sse:5psp] (engineer) close reason=normal duration=90057ms events=3136
```

---

## 根因链（自顶向下）

这**不是一个单点 bug**，而是**四层错误级联**，每一层都会独立让用户看到 `parse_failed`，但实际触发的根因只在最底层。系统设计上的每一层"fallback 友好性"反而让定位变得更难。

### 第一层：客户端 90s 流超时

`lib/ai-providers.ts:22` 定义 `STREAM_TIMEOUT_MS = 90_000`。每个 provider（Gemini / DeepSeek / Groq）在 `streamCompletion()` 里创建一个 `AbortController`，90 秒后无条件 `abort()` 正在进行的 LLM 流式响应。

这个墙对"快速反馈"有意义，但对**长输出任务**（内容量大的 architect scaffold / 多屏 UI 的 engineer 代码）成了硬天花板。观察到的 `duration=90057ms` ≈ 90000ms 不是巧合，是我方 abort 精确触发。

### 第二层：Architect scaffold 被砍在 `files` 数组中间

Architect agent 的职责是输出一份多文件脚手架 JSON：

```json
{
  "files": [ {...}, {...}, ... ],
  "sharedTypes": "...",
  "designNotes": "..."
}
```

对"密码管理器"这种有 20-30+ 文件的复杂需求，`files` 数组本身就足够长，长到 architect 还在往里写第 28 个文件的 `hints` 字段时，90s 墙就塌下来了。实测数据：Architect 写完 27 个完整文件后，在第 28 个文件的字符串值内部被砍。

### 第三层：`extractScaffoldFromTwoPhase` 严格 JSON.parse 失败

`lib/extract-json.ts` 原本的提取路径：

1. 尝试匹配 `<output>...</output>` 取里面的 JSON
2. 失败则对整个 raw 字符串 `JSON.parse`
3. 都失败返回 `null`

被截断的 JSON 既没闭合字符串也没闭合外层对象，`JSON.parse` 必然抛错。提取返回 `null`。

### 第四层：chat-area 静默 fall-through 到 legacy 单文件路径

`components/workspace/chat-area.tsx:394` 的守卫：

```ts
const scaffold = extractScaffoldFromTwoPhase(outputs.architect);
if (scaffold && scaffold.files.length > 1) {
  // 多文件分层路径
} else {
  // fall through — 进入 legacy 单文件 Engineer
}
```

`scaffold === null` 走 else 分支。此时 Engineer 被要求**一次性输出整个多屏密码管理器到单个 `/App.js`**。这个任务**必然**会超过 90s 墙（同一堵墙再撞一次），于是 Engineer 的输出也被截断，`extractReactCode` 返回 null，最终发出 `parse_failed:singleFile` —— 这是用户看到的 error code。

**级联总结**：一个原本是"architect 文件数组内部被砍"的小问题，因为 chat-area 静默 fall-through 的设计，放大成了"engineer 单文件也被砍"的表象，让用户永远看不到真实根因，重试也永远失败。

---

## 诊断过程

严格遵循 `superpowers:systematic-debugging` 的 Phase 1：**禁止在找到根因之前动手修代码**。

### 加观测日志（commit `2919d5f`）

在 `app/api/generate/handler.ts` 三个 `parse_failed` 发送点各加一条 `console.error`，打印 4 个诊断字段：

| 字段 | 含义 |
|-----|-----|
| `elapsedMs` | 从 ReadableStream 启动到 parse_failed 触发的毫秒数 |
| `fullContentLength` | 累计收到的 LLM 流字符数 |
| `tail` | 最后 200 字符（看在哪截断） |
| `expectedPaths / okPaths / failedPaths` | 多文件路径下每个 file 的结果 |

此外三种不同 parse_failed 路径（`partialMultiFile` / `multiFile` / `singleFile`）各自打 tag，一眼能看出走的是哪条分支。

### 关键证据

线上复现后拿到的日志：

```
[generate:diag:parse_failed:singleFile] {
  elapsedMs: 89998,
  fullContentLength: 11480,
  tail: '...setSelected(updated);\n    setEditing(false);\n  };\n  ...'
}
```

1. **`elapsedMs` ≈ 90000ms** → 确认是我方 abort，不是 DeepSeek max_tokens（DeepSeek 默认 8192 tokens ≈ 30K 字符，11480 远未达到）
2. **tag 是 `singleFile` 而不是 `multiFile`** → 说明走了 legacy 分支，scaffold 已经失败过
3. **tail 是半句 JSX** → 干净截断，模型还在继续出，被硬砍

同时通过 Supabase SQL 取回当次的 Architect 原文，看到 `files` 数组完整写了 27 个元素，在第 28 个的 `hints` 字符串中间断掉。确认了四层级联。

---

## 修复

### 主修复：`extractScaffoldFromTwoPhase` 逐元素抢救

核心思路：**只要 `files` 数组里有任何一个完整的 top-level 对象，就把它们抢救出来**；不完整的尾部元素丢弃；返回一个 `sharedTypes` / `designNotes` 为空串的 `ScaffoldData`。

实现：`lib/extract-json.ts` 新增 `locateFilesArrayText()`，用带 JSON string-literal 感知的括号计数算法：

- 用正则定位 `"files":\s*\[` 开始
- 从 `[` 开始单字符扫描，维护：
  - `depth`（`[` `{` 增，`]` `}` 减）
  - `inString`（奇数个未转义的 `"` 切换）
  - `escape`（跟踪 `\\` 的影响）
- 每当 `depth` 从 2 回到 1 且当前字符是 `}`，记录位置为"最后一个完整 top-level file 对象结尾"
- 扫描到 EOF 未见外层 `]` 时，用最后记录的位置合成 `raw.slice(start, lastEnd+1) + "]"` 作为抢救结果

两次提交分阶段修：
- **`c26dda9`** —— 最初版本只处理 "files 数组完整、tail 被砍" 的情况
- **`493f755`** —— 增强为支持 "files 数组内部截断"（实际的生产情况）

单测覆盖四种场景：
- `EJ-TP-07` 尾部 sharedTypes 被砍（files 数组完整）
- `EJ-TP-08` 截断在 files 数组中间（抢救已完成元素）
- `EJ-TP-08b` 截断在最后一个 file 的字符串值内部（真实生产 shape）
- `EJ-TP-08c` 第一个 file 就被砍（返回 null）
- `EJ-TP-09` 裸 JSON 无 `<output>` 标签（历史格式兼容）
- `EJ-TP-10` file 字符串内含方括号和转义引号（不被 salvage 逻辑迷惑）

### 附带修复 1：过滤 `/supabaseClient.js`

Scaffold 可能把 `/supabaseClient.js` 列入 files 数组（architect 自己也标注"已存在"，但还是列了）。但这个文件是平台基建，由 `buildSandpackConfig` 在渲染时自动注入、由 `findMissingLocalImports` 白名单放行。Engineer 被要求生成它时会迷茫地输出一个不相关的组件，触发良性但嘈杂的 fallback 失败日志。

修复：`components/workspace/chat-area.tsx` 在取到 scaffold 之后立刻 filter 掉这个路径。scaffold 仍然可以显示所有文件；engineer 只被要求生成剩下的。

### 附带修复 2：Prisma 连接终止的三步治理

生产 log 里伴随出现：

```
prisma:error Connection terminated due to connection timeout
at /var/task/node_modules/pg-pool/index.js:45:11
```

独立问题，但会让 messages / versions 持久化偶发失败，给整个 debug 过程增加噪音（比如无法从 DB 查到某次失败的 architect message）。这个 bug **自己也是一个小型 Phase 1 → Phase 4 调查**，前两步都不是根因，给后人留个警示：

#### 第一步：pg Pool 参数调优（未命中根因）

最初假设是 "Lambda 冻结期间 pool 里的 stale 连接解冻后被 hand out"，按这个方向把 `max: 3 → 2`，`idleTimeoutMillis: 30000 → 5000`，加 `allowExitOnIdle: true`，加 `pool.on("error")` 兜底。**没用**。同样的 `Connection terminated` 报错继续出现。

**为什么没用**：仔细读 error 的两层结构才发现真相 ——

```
Error: Connection terminated due to connection timeout    ← 外层：pg-pool 试图建立新连接超时
  cause: Connection terminated unexpectedly               ← 内层：旧 socket 在查询执行中被对端干掉
```

**真正发生的是**：查询**正在执行时**对端 drop socket，不是空闲时被驱逐。缩短 idle timeout 只能处理"刚解冻就拿到死连接"的场景，救不了"查询中途 socket 死"的场景。

#### 第二步：确认是 Supavisor 端口问题（命中 1/2）

加了一条启动诊断 log 打印 `DATABASE_URL` 的 host:port：

```ts
console.log(`[prisma:diag] DATABASE_URL host=${url.hostname} port=${url.port}`);
```

发现生产环境用的是 **`*.pooler.supabase.com:5432`** —— 走 Supabase Supavisor pooler 的**主机**，但端口是 **5432（session mode）** 而不是 **6543（transaction mode）**。

session mode 对 serverless 是灾难级错配：

| Port | Mode | 连接生命周期 | 适合 |
|------|------|--------------|------|
| 5432 | session | 客户端主动断开前一直占一个 backend | 长生命周期客户端 |
| 6543 | transaction | 每个 transaction 结束就归还 backend | **serverless（应该用这个）** |

Vercel Lambda 冻结时不会主动断连，session 被 Supavisor 过期 reaper 清理，socket 状态不一致，才会有"查询中途 socket 突然死"的怪象。

改 Vercel env var `5432` → `6543`，Redeploy。**部分生效** —— 错误频率下降，但没有根除。

#### 第三步：`$extends` 透明重试（最终防线）

Supavisor 在免费档下即便走 transaction mode 也会偶发 drop socket（可能是 rate limit、内部 backend 轮转、TCP keepalive 不匹配）。根因已经到了 Supabase 的服务端行为，**客户端层面没法根除**。

最终修复：用 Prisma 7 的 `$extends({ query: { $allModels: { $allOperations } } })` 在 client 层包一层透明重试：

```ts
const TRANSIENT_DB_ERROR_RE =
  /Connection terminated|ECONNRESET|socket hang up|write EPIPE|ETIMEDOUT/i;

function withConnectionRetry(base) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query, model, operation }) {
          for (let attempt = 1; attempt <= 3; attempt++) {
            try { return await query(args); }
            catch (err) {
              if (attempt === 3 || !TRANSIENT_DB_ERROR_RE.test(err.message)) throw err;
              await new Promise(r => setTimeout(r, 100 * 2 ** (attempt - 1) + Math.random() * 50));
            }
          }
        }
      }
    }
  });
}
```

指数退避 100ms → 200ms → 400ms + jitter。非瞬态错误第一次就透传。

**生产验证**：单次请求层面，user 查询通常在 attempt 2 (100ms 延迟) 内 recover，用户层面零影响。典型 log 序列：

```
[prisma:retry] User.findUnique attempt 1/3 failed: Connection terminated...
[prisma:retry] User.findUnique recovered on attempt 2/3
```

#### 额外清理：Prisma 内置 error log 的噪音

Prisma 的 `log: ["error"]` 会在错误被 `$extends` 拿到**之前**就往 stderr 广播一条 `prisma:error ...`。这导致每次成功的重试看起来都像是未处理的致命错误。生产环境下拿掉 `"error"` 级别（dev 保留 `["query", "warn"]`），让错误只通过 route handler 的统一异常路径记录。

#### 教训

1. **不要在 error 只看外层 message，要看 cause 链**。第一步的误判完全是因为我把外层 "connection timeout" 当成了真相，忽略了内层 "terminated unexpectedly"。两层 error 讲的是两件不同的事。
2. **Supabase 的 pooler host 暴露两个端口，两个语义截然不同**。host 名字含 `pooler` 不代表走对了 mode —— port 才是决定性的。这个坑 Supabase 文档藏得很深。
3. **serverless + 连接池天然 fragile**，即便配置正确也会偶发 drop。客户端必须假设瞬态失败是常态，透明重试是基础设施而不是 workaround。

---

## 为什么不是"把超时调大"

最直觉的修法是把 `STREAM_TIMEOUT_MS` 从 90s 提到 240s。拒绝这个方向的原因：

1. **Vercel Hobby 的 Edge Function 实际执行时间上限未知且随时可能变**。`maxDuration = 300` 是请求上限，不代表套餐允许。盲目放大客户端超时会把"受控的 parse_failed"变成"函数无响应 504"，用户体验更差。
2. **延长超时不解决根本问题 ——它只是把门槛推高一点**。32 个文件能撑 90s 墙，64 个文件就能撑 180s 墙。结构性的解法是**让每个请求的工作量变小**，而不是**让每个请求的窗口变大**。
3. **salvage 改动是零风险的**：对"scaffold 正常完整"的情况零影响，只在 `JSON.parse` 已经失败的回退路径才触发。

---

## 未解决 / 后续

- **AI 生成的应用登录失败**：用户确认预览能渲染出登录界面，但登录不通。这是另一个独立问题，涉及 `lib/sandpack-config.ts` 注入的 supabase client 暴露的 API 面与 engineer 生成代码期望之间的不对齐。可能与 memory 里记录的 "Supabase DynamicAppData RLS Issue" 同源。留待单独 debug 循环。
- **Architect system prompt 里对文件总数 / 每个文件 hints 长度的约束**。当前 architect 对于复杂需求倾向于输出非常详细的 scaffold（27+ 文件、每个 hints 200+ 字），和 DeepSeek V3 在 90s 内的可输出量处于临界状态。可以考虑在 prompt 里加上 "files 数量控制在 20 以内" "hints 保持简洁" 的软约束，作为纵深防御。
- **`chat-area.tsx` 的 scaffold 守卫 `files.length > 1` 应该改 `>= 1`**。当前语义是"只有超过 1 个文件才走多文件路径"，其实只要 scaffold 有任何文件就应该走多文件路径，单文件 fallback 是历史遗留分支。此次没改是为了保持最小变更。
