# 导出与部署（Export & Deploy）

## 概述

用户可将 AI 生成的应用以两种方式交付：托管部署（Vercel）和本地导出（ZIP）。`lib/project-assembler.ts` 将 Sandpack 格式文件映射为 Next.js 项目结构，`lib/vercel-deploy.ts` 调用 Vercel Deploy API v13，`lib/zip-exporter.ts` 打包为 DEFLATE 压缩的 ZIP 文件。所有导出/部署操作在 Demo 账户下返回 403。

## 设计思路

核心取舍：`assembleProject()` 在合并时保护基础设施文件不被 AI 覆写。AI 生成的 `App.js` 直接影响 `pages/index.tsx`，但 `package.json`、`next.config.js`、`tsconfig.json` 等平台文件不可被 AI 输出替换，否则 Next.js 构建会失败。

两种模式的差异体现在 Supabase 配置注入：`hosted` 模式将凭证硬编码（用户无需配置环境变量即可部署）；`export` 模式使用环境变量占位符（用户可自行修改）。

## 代码逻辑

### assembleProject（lib/project-assembler.ts）

```typescript
export interface AssembleOptions {
  projectName: string;
  projectId: string;
  generatedFiles: Record<string, string>;
  mode: 'hosted' | 'export';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export function assembleProject(options: AssembleOptions): AssembledProject
```

执行步骤：

```
1. 读取 templates/nextjs/ 目录下所有模板文件（递归）
   readTemplateDir(TEMPLATE_DIR)

2. 移除占位符 supabase 文件
   过滤 lib/supabase.hosted.ts、lib/supabase.export.ts

3. Sandpack 路径 → Next.js 路径映射
   mapSandpackPath("/App.tsx")  → "pages/index.tsx"
   mapSandpackPath("/App.jsx")  → "pages/index.tsx"
   mapSandpackPath("/App.js")   → "pages/index.tsx"
   其他路径：去掉开头 / 保持不变

4. 合并（模板优先，AI 生成覆盖非保护文件）
   PROTECTED = {
     'package.json', 'next.config.js', 'tsconfig.json',
     'tailwind.config.js', 'postcss.config.js',
     'pages/_app.tsx', 'pages/_document.tsx',
     'styles/globals.css', 'lib/utils.ts',
   }
   for AI-generated file:
     if !PROTECTED.has(path) → files[path] = content

5. 注入正确的 lib/supabase.ts
   hosted + 有凭证：
     export const supabase = createClient('${url}', '${key}')
   export 模式或无凭证：
     const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
     export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### createVercelDeployment（lib/vercel-deploy.ts）

```typescript
export async function createVercelDeployment(
  options: CreateDeploymentOptions
): Promise<CreateDeploymentResult>
// CreateDeploymentOptions: { projectSlug, files, vercelProjectId? }
// CreateDeploymentResult: { vercelDeployId, vercelProjectId, url }
```

调用流程：

```
1. getToken()  → process.env.VERCEL_TOKEN（未设置时 throw）
2. 文件编码：toVercelFiles(files)
   → [{ file: path, data: base64, encoding: "base64" }]
3. POST VERCEL_API/v13/deployments
   body: { name: projectSlug, files, projectSettings: { framework: "nextjs" },
           target: "production", project?: vercelProjectId }
   可选：teamId via VERCEL_TEAM_ID env
4. 返回 { vercelDeployId, vercelProjectId, url }（url 确保 https:// 前缀）
```

### pollDeploymentStatus（lib/vercel-deploy.ts）

```typescript
export async function pollDeploymentStatus(
  deployId: string,
  maxAttempts = 40
): Promise<PollResult>
// PollResult: { status: 'ready' | 'error' | 'building', url? }
```

轮询逻辑（每次调用检查一次，调用方负责添加间隔）：

```
for i in 0..maxAttempts:
  GET VERCEL_API/v13/deployments/{deployId}
  readyState === 'READY'              → return { status: 'ready', url }
  readyState === 'ERROR' | 'CANCELED' → return { status: 'error' }
maxAttempts 耗尽                      → return { status: 'building' }
```

### createProjectZip（lib/zip-exporter.ts）

```typescript
export async function createProjectZip(
  files: Record<string, string>,
  projectName: string
): Promise<Buffer>
```

```
zip.folder(projectName)
for each [filePath, content]:
  folder.file(filePath, content)
zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
→ Buffer
```

所有文件嵌套在以项目名命名的顶层目录下（如 `my-app/pages/index.tsx`）。

## 覆盖场景

| 场景 | 处理方式 |
|------|---------|
| Hosted 部署有 Supabase 凭证 | lib/supabase.ts 硬编码 URL 和 key |
| Export 模式（无凭证）| lib/supabase.ts 使用 process.env 占位符 |
| AI 生成了 package.json | PROTECTED 集合阻止覆盖 |
| Vercel 部署成功（READY）| pollDeploymentStatus 返回 ready + url |
| Vercel 部署失败（ERROR）| pollDeploymentStatus 返回 error |
| maxAttempts 耗尽仍在构建 | 返回 building，前端继续展示"部署中" |
| Demo 账户访问部署 | API 路由检查 isDemo → 返回 403 |
| ZIP 导出 | createProjectZip → Buffer → 返回给前端下载 |

## 未覆盖场景 / 已知限制

- **自定义域名**：Vercel 部署使用自动分配的 `.vercel.app` 域名，不支持通过 BuilderAI 配置自定义域名。
- **部署回滚**：无法通过 BuilderAI 界面触发 Vercel 回滚，只能手动在 Vercel 控制台操作。
- **非 Next.js 模板**：`assembleProject` 和模板目录固定为 Next.js，不支持 Vite/CRA/纯 HTML 等其他框架输出。
- **CI/CD 流水线**：每次部署是独立触发，无 Git 集成或自动化 CI/CD。
- **pollDeploymentStatus 无自动间隔**：调用方（API 路由）负责添加 sleep 间隔，当前实现采用轮询而非 Vercel webhook。
- **ZIP 无 .env 文件**：export 模式的 ZIP 不包含 `.env.example`，用户需手动配置 Supabase 环境变量。

## 相关文件

- `lib/project-assembler.ts` — `assembleProject`、`mapSandpackPath`
- `lib/vercel-deploy.ts` — `createVercelDeployment`、`pollDeploymentStatus`
- `lib/zip-exporter.ts` — `createProjectZip`
- `templates/nextjs/` — Next.js 项目模板文件
- `app/api/deploy/route.ts` — 部署触发端点
- `app/api/export/route.ts` — ZIP 导出端点
