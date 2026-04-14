# Sandpack 预览（Sandpack Preview）

## 概述

AI 生成的 React 代码运行在 Sandpack 沙箱中（浏览器内编译执行）。`lib/sandpack-config.ts` 的 `buildSandpackConfig()` 负责将原始生成文件转换为 Sandpack 可用的配置：标准化 export 格式、注入缺失文件的 stub、注入隐藏的 supabase 客户端（含认证 mock）。参见 ADR 0015（Babel export 兼容性修复）。

## 设计思路

核心取舍：`normalizeExports()` 在所有文件上双向标准化，使 `import X from` 和 `import { X } from` 两种写法都能解析到有效组件。代价是向文件末尾注入额外 export 语句，增加一丁点代码体积。

ADR 0015 的核心发现：Sandpack Babel 不接受 `export default function Name` 后跟 `export { Name }`——Babel 会报错"duplicate export"。解决方案是将 `export default function Name` 拆分为普通函数声明 + `export default Name; export { Name };`。

supabase auth mock 采用有状态设计（`_authState.session`），确保 `signInWithPassword` → `getSession` 的 session 读取能正常工作，否则登录页会陷入死循环。

## 代码逻辑

### buildSandpackConfig 主流程

```typescript
export function buildSandpackConfig(
  input: string | Record<string, string>,
  projectId: string
): SandpackConfig
```

执行步骤：

```
1. normalize input
   string → { "/App.js": code }（单文件路径）
   Record  → { ...input }（多文件，副本）

2. normalizeExports(userFiles)  // 仅多文件时执行

3. 确保 /App.js 存在（Sandpack 入口）
   若无 /App.js → 注入 PLACEHOLDER_APP（"等待 AI 生成代码..."）

4. 转换为 SandpackFileEntry 格式
   { code: string, hidden?: boolean }

5. findMissingLocalImportsWithNames(userFiles)
   → 每个缺失路径注入 Proxy stub
     export const X = () => null;  // named exports
     export default new Proxy({}, { get(_, key) { console.warn(...); return () => null } })

6. 注入隐藏 /supabaseClient.js（buildSupabaseClientCode）

7. 返回 SandpackConfig
   template: "react"
   customSetup.dependencies: { @supabase/supabase-js: ^2.39.0, lucide-react: ^0.300.0 }
   options.externalResources: ["https://cdn.tailwindcss.com"]
   options.recompileMode: "delayed", recompileDelay: 500
```

### normalizeExports

```typescript
function normalizeExports(files: Record<string, string>): Record<string, string>
```

逐文件处理（三步规则）：

**Step 1：检测 default export 名称**

```typescript
// export default function/class Name(...) → defaultName = "Name"
const defaultFnMatch = code.match(
  /export\s+default\s+(?:async\s+)?(?:function|class)\s+([a-zA-Z_$][\w$]*)/
)
// export default Name（标识符引用）→ defaultName = "Name"
const defaultIdMatch = code.match(/export\s+default\s+([a-zA-Z_$][\w$]*)/)
```

**Step 2：收集所有 named exports**

```typescript
// export function/class/const/let/var Name
// export { Foo, Bar as Baz } → 取外部名 Baz
```

**Step 3：双向标准化**

```typescript
// 3a. export default function Name → 拆分为普通声明 + export default Name; + export { Name };
//     （ADR 0015：Babel 拒绝在 export default function 后跟 export { Name }）
if (defaultFnMatch && defaultName && !namedSet.has(defaultName)) {
  transformedCode = transformedCode.replace(
    /export\s+default\s+((?:async\s+)?(?:function|class)\s+)/,
    "$1"  // 去掉 "export default" 前缀，保留 function/class 关键字
  )
  additions.push(`export default ${defaultName};`)
  additions.push(`export { ${defaultName} };`)
}

// 3b. export default Name（标识符）→ 补充 export { Name }
if (!defaultFnMatch && defaultName && !namedSet.has(defaultName)) {
  additions.push(`export { ${defaultName} };`)
}

// 3c. 有 named exports 但无 default → 将第一个 named 提升为 default
if (!hasDefault && namedSet.size > 0) {
  additions.push(`export default ${Array.from(namedSet)[0]};`)
}
```

修改后尾部追加注释标记：`// [builder-ai: export normalization]`

### supabase auth mock

```typescript
function buildSupabaseClientCode(projectId: string): string
// 注入 x-app-id header（ADR 0007：Supabase RLS 要求）
// auth mock 实现：
//   signInWithPassword({ email }) → _authState.session = { access_token: "demo" }
//   signUp               → session: null
//   signOut              → _authState.session = null
//   getSession           → { session: _authState.session }
//   onAuthStateChange    → 返回 mock subscription 对象
```

`/supabaseClient.js` 始终作为 hidden 文件注入，AI 生成代码可通过 `import { supabase } from '/supabaseClient.js'` 访问。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| `export default function App` | ADR 0015 拆分，追加 `export default App; export { App };` |
| `export default App`（标识符） | 追加 `export { App };` |
| 文件只有 named exports（无 default）| 追加 `export default FirstNamed;` |
| 两种写法已均存在 | 无修改（additions 为空） |
| AI 引用了 `/components/Foo.js` 但未生成 | Proxy stub 注入，防 "Element type is invalid: got undefined" |
| AI 代码调用 `supabase.auth.signInWithPassword` | auth mock 返回成功，防登录页死循环 |
| 单文件 string input | 不执行 normalizeExports（直接封装为 `/App.js`） |

## 未覆盖场景 / 已知限制

- **CSS Modules**：`import styles from './App.module.css'` 在 Sandpack React 模板中不支持。
- **动态 import**：`import('./heavy')` 在 Sandpack 沙箱中无法使用，AI 生成时若产生此模式会报运行时错误。
- **非 React 框架**：模板固定为 `"react"`，Vue/Svelte/纯 HTML 不支持。
- **真实 Supabase CRUD**：auth mock 仅拦截认证方法；`supabase.from(...).select()` 等数据操作走真实 Supabase 连接，受 RLS 和网络限制影响。
- **`export { default as X }` 形式**：normalizeExports 的 named export 收集器可能将 `default` 本身误加入 namedSet，但 `if (exported !== "default")` 过滤已处理此情况。

## 相关文件

- `lib/sandpack-config.ts` — `buildSandpackConfig`、`normalizeExports`、`buildSupabaseClientCode`
- `lib/extract-code.ts` — `findMissingLocalImportsWithNames`（供 stub 注入使用）
- `docs/adr/0015-sandpack-export-normalization.md` — export 兼容性 ADR
- `docs/adr/0007-supabase-rls-x-app-id.md` — RLS x-app-id header ADR
- `components/preview/preview-panel.tsx` — Sandpack 组件挂载点
