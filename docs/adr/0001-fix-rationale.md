# ADR 0001 — Fix Rationale: Six Under-Documented Bug Fixes

这些 commit 的标题只记录了 "what"，本文补充 "why"——根因和决策背景，方便日后排查。

---

## 1. `0209e18` — Array.from() instead of spread on matchAll iterator

**问题：** `[...code.matchAll(re)]` 在部分环境下抛出 TypeError。

**根因：** `String.prototype.matchAll` 返回的是一个 `RegExpStringIterator`，不是数组。
TypeScript 在低版本 `lib` target（如 `ES2019` 以下）下，spread 操作符对迭代器的支持不完整；
此外，某些 V8 版本对 `Symbol.iterator` 的协议处理与 spread 的互动存在边界行为差异。
`Array.from()` 显式消费迭代器，在所有 target 下行为一致。

---

## 2. `28efeeb` — disable jsonMode for architect

**问题：** Architect agent 输出被截断，`<thinking>` 块消失，只剩裸 JSON，导致 `extractScaffoldFromTwoPhase` 解析失败。

**根因：** `jsonMode: true` 被错误地同时传给了 PM 和 Architect。
Gemini/Groq 的 JSON mode 会在 API 层强制输出合法 JSON，这直接屏蔽了 Architect 依赖的两阶段格式：

```
<thinking>推理过程</thinking>
<output>{ ...JSON... }</output>
```

XML 标签在 JSON mode 下无法出现。只有 PM 输出裸 JSON，需要 JSON mode；
Architect 必须关闭，才能让 `<thinking>` 块正常出现。

---

## 3. `7211215` — force single-file output in direct engineer context

**问题：** bug_fix / style_change 直接路径下，Engineer 偶尔输出多文件格式（带 `// === FILE: ...` 分隔符），导致 `extractReactCode` 返回空字符串，预览白屏。

**根因：** 直接路径（single-file V1）的上下文没有明确禁止多文件输出。
模型在 context 里看到源文件是多文件格式（`<source file="...">` 标签），会推断应用是多文件结构，
主动切换到 FILE 分隔符格式输出。`extractReactCode` 只识别单文件 `export default function App()`，
遇到 FILE 分隔符格式则提取失败。

修复方案：在 `buildDirectEngineerContext` 的输出要求段显式写明"不得输出多文件格式"。

---

## 4. `44d73166` — inject V1 existing files into multi-file engineer prompt

**问题：** feature_add 迭代时，Engineer 生成的文件会丢失用户已有的样式和逻辑，相当于每次都从头重建。

**根因：** `getMultiFileEngineerPrompt` 原来没有 `existingFiles` 参数。
全流程（PM → Architect → Engineer）走完后，Engineer 只收到 Architect 规划的脚手架描述，
不知道当前 V1 代码里已经有什么。没有参照，Engineer 会按自己的风格重新生成，
覆盖用户手动调整过的颜色、布局、样式。

修复方案：在 `MultiFileEngineerPromptInput` 添加可选 `existingFiles`，
仅在 feature_add 迭代时注入（新项目不传，避免无关干扰）。

---

## 5. `b212054` — correct snip header placement and restore function stub suffix

**问题：** Engineer 输出的 completed files 截断逻辑（snip）产生了两个 bug：
1. 函数 stub 丢失 `{}`，变成 `function foo()` 而不是 `function foo() {}`，TypeScript 报语法错误。
2. `(snipped — exports only)` 注释出现在文件内容里而不是文件头，Engineer 把它当作代码输出，导致 parse 失败。

**根因：**
- `extractExportSignatures` 的 `.replace(/\s*\{[^}]*\}.*$/, "")` 把函数体连同 `{}` 一起删掉了。修复：替换为 `" {}"` 保留空 stub。
- snip header 原来写在 `extractExportSignatures` 返回值里，导致它混入代码内容。
  修复：header 移到调用方 `snipCompletedFiles`，在拼 prompt 时按 path 是否为直接依赖决定是否显示 snipped 标注。

---

## 6. `c815ec9` — move GitHub login param to signIn call site

**问题：** GitHub OAuth 登录页偶发行为异常；邮件发送失败时前端收到 500 但无任何错误日志。

**根因（两个独立问题）：**

1. **GitHub login 参数位置错误：** `authorization: { params: { login: "" } }` 写在 NextAuth provider 静态配置里，
   等于在所有 OAuth 请求上永远传 `login=`（空字符串），GitHub 会把它解析为"预填用户名为空"的 hint，
   在某些 GitHub 账号状态下触发不期望的跳转行为。正确做法是在 `signIn()` 调用点按需传参。

2. **邮件发送无错误处理：** `resend.emails.send()` 调用没有 try/catch，发送失败时异常向上冒泡，
   NextAuth 会把它吞掉并返回通用 500，日志里看不到任何原因。
   修复：包裹 try/catch，catch 里 `console.error` + 重新 throw 语义明确的错误。
