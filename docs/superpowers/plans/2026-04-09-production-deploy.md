# Production Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to export generated apps as a Next.js zip or deploy them one-click to Vercel.

**Architecture:** The generation pipeline (PM → Architect → Engineer → Sandpack) is unchanged. A new `project-assembler` maps Sandpack-format files to a full Next.js 14 Pages Router project by merging AI-generated files with platform-provided templates. Export zips this project; Deploy sends it to the Vercel Deploy API and polls for readiness.

**Tech Stack:** Next.js 14 (Pages Router), TypeScript (loose), Tailwind, shadcn/ui, jszip, Vercel Deploy API v13, Prisma/Supabase.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Modify | Add `Deployment` model |
| `lib/types.ts` | Modify | Add `Deployment` type |
| `lib/project-assembler.ts` | Create | Merge templates + AI files → Next.js structure |
| `lib/zip-exporter.ts` | Create | Pack `Record<string,string>` into a zip Buffer |
| `lib/vercel-deploy.ts` | Create | Vercel Deploy API v13 wrapper |
| `app/api/export/route.ts` | Create | GET → zip download |
| `app/api/deploy/route.ts` | Create | POST → trigger Vercel deployment |
| `app/api/deploy/[id]/route.ts` | Create | GET → poll deployment status |
| `components/preview/preview-panel.tsx` | Modify | Add Export + Deploy buttons |
| `templates/nextjs/` | Create | All platform template files |
| `__tests__/project-assembler.test.ts` | Create | Unit tests for assembler |
| `__tests__/zip-exporter.test.ts` | Create | Unit tests for zip exporter |
| `__tests__/vercel-deploy.test.ts` | Create | Unit tests for Vercel wrapper (mocked) |
| `__tests__/export-route.test.ts` | Create | API route tests for export |
| `__tests__/deploy-route.test.ts` | Create | API route tests for deploy |
| `__tests__/preview-panel-deploy.test.tsx` | Create | Component tests for new buttons |

---

## Task 1: Add jszip dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jszip**

```bash
cd /Users/ruby/Projects/personal/builder-ai
npm install jszip
npm install --save-dev @types/jszip
```

Expected: `jszip` appears in `dependencies`, `@types/jszip` in `devDependencies`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jszip for zip export"
```

---

## Task 2: Add Deployment model to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/types.ts`

- [ ] **Step 1: Add Deployment model to schema**

In `prisma/schema.prisma`, add after the `Message` model and add `deployments` relation to `Project`:

```prisma
model Project {
  id             String       @id @default(cuid())
  name           String
  description    String?
  userId         String
  preferredModel String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  messages       Message[]
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  versions       Version[]
  deployments    Deployment[]
}
```

Then add the new model at the end of the file:

```prisma
model Deployment {
  id              String   @id @default(cuid())
  projectId       String
  versionId       String
  vercelProjectId String
  vercelDeployId  String
  url             String
  status          String   // building | ready | error
  createdAt       DateTime @default(now())
  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Push schema to DB**

```bash
npx prisma db push
npx prisma generate
```

Expected: `✓ Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Add Deployment type to lib/types.ts**

Append to the end of `lib/types.ts`:

```typescript
export interface Deployment {
  id: string;
  projectId: string;
  versionId: string;
  vercelProjectId: string;
  vercelDeployId: string;
  url: string;
  status: 'building' | 'ready' | 'error';
  createdAt: Date;
}
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma lib/types.ts
git commit -m "feat: add Deployment model and type"
```

---

## Task 3: Create Next.js platform template files

**Files:**
- Create: `templates/nextjs/` (directory + all files)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p templates/nextjs/pages
mkdir -p templates/nextjs/components/ui
mkdir -p templates/nextjs/lib
mkdir -p templates/nextjs/styles
```

- [ ] **Step 2: Create templates/nextjs/package.json**

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@radix-ui/react-label": "^2.0.2",
    "@radix-ui/react-separator": "^1.0.3",
    "@radix-ui/react-slot": "^1.0.2",
    "@supabase/supabase-js": "^2.39.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "lucide-react": "^0.300.0",
    "next": "14.2.0",
    "react": "^18",
    "react-dom": "^18",
    "tailwind-merge": "^2.0.0",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.0.1",
    "postcss": "^8",
    "tailwindcss": "^3.3.0",
    "typescript": "^5"
  }
}
```

- [ ] **Step 3: Create templates/nextjs/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create templates/nextjs/next.config.js**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
```

- [ ] **Step 5: Create templates/nextjs/postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 6: Create templates/nextjs/tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

- [ ] **Step 7: Create templates/nextjs/styles/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 8: Create templates/nextjs/pages/_app.tsx**

```tsx
import type { AppProps } from 'next/app'
import '@/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
```

- [ ] **Step 9: Create templates/nextjs/pages/_document.tsx**

```tsx
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
```

- [ ] **Step 10: Create templates/nextjs/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 11: Create templates/nextjs/lib/supabase.hosted.ts** (injected for platform-deployed apps)

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

- [ ] **Step 12: Create templates/nextjs/lib/supabase.export.ts** (placeholder for exported apps)

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

- [ ] **Step 13: Create templates/nextjs/.env.example**

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

- [ ] **Step 14: Create templates/nextjs/components/ui/button.tsx**

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

- [ ] **Step 15: Create templates/nextjs/components/ui/card.tsx**

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
```

- [ ] **Step 16: Create templates/nextjs/components/ui/input.tsx**

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
```

- [ ] **Step 17: Create templates/nextjs/components/ui/badge.tsx**

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

- [ ] **Step 18: Commit all template files**

```bash
git add templates/
git commit -m "feat: add Next.js platform template files"
```

---

## Task 4: Implement lib/project-assembler.ts (TDD)

**Files:**
- Create: `lib/project-assembler.ts`
- Create: `__tests__/project-assembler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/project-assembler.test.ts`:

```typescript
import { assembleProject } from '@/lib/project-assembler'

const GENERATED_FILES: Record<string, string> = {
  '/App.tsx': 'export default function App() { return <div>Hello</div> }',
  '/components/Header.tsx': 'export function Header() { return <header>Header</header> }',
  '/hooks/useData.ts': 'export function useData() { return [] }',
  '/lib/helpers.ts': 'export function format(s: string) { return s.trim() }',
}

describe('assembleProject', () => {
  describe('file path mapping', () => {
    it('maps /App.tsx to pages/index.tsx', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: { '/App.tsx': 'content' },
        mode: 'export',
      })
      expect(result.files['pages/index.tsx']).toBe('content')
      expect(result.files['/App.tsx']).toBeUndefined()
    })

    it('maps /components/* stripping leading slash', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: { '/components/Header.tsx': 'header content' },
        mode: 'export',
      })
      expect(result.files['components/Header.tsx']).toBe('header content')
    })

    it('maps /hooks/* and /lib/* stripping leading slash', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: GENERATED_FILES,
        mode: 'export',
      })
      expect(result.files['hooks/useData.ts']).toBe('export function useData() { return [] }')
      expect(result.files['lib/helpers.ts']).toBe('export function format(s: string) { return s.trim() }')
    })
  })

  describe('template files injection', () => {
    it('includes package.json from template', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['package.json']).toBeDefined()
      expect(result.files['package.json']).toContain('"next"')
    })

    it('includes pages/_app.tsx from template', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['pages/_app.tsx']).toBeDefined()
    })

    it('includes components/ui/button.tsx from template', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['components/ui/button.tsx']).toBeDefined()
    })
  })

  describe('supabase injection', () => {
    it('export mode: lib/supabase.ts has placeholder values', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'export',
      })
      expect(result.files['lib/supabase.ts']).toContain('NEXT_PUBLIC_SUPABASE_URL')
      expect(result.files['lib/supabase.ts']).not.toContain('https://real.supabase.co')
    })

    it('hosted mode: lib/supabase.ts injects real credentials', () => {
      const result = assembleProject({
        projectName: 'test-app',
        projectId: 'proj_123',
        generatedFiles: {},
        mode: 'hosted',
        supabaseUrl: 'https://real.supabase.co',
        supabaseAnonKey: 'anon-key-123',
      })
      expect(result.files['lib/supabase.ts']).toContain('https://real.supabase.co')
      expect(result.files['lib/supabase.ts']).toContain('anon-key-123')
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="project-assembler"
```

Expected: FAIL — `Cannot find module '@/lib/project-assembler'`

- [ ] **Step 3: Create lib/project-assembler.ts**

```typescript
import fs from 'fs'
import path from 'path'

export interface AssembleOptions {
  projectName: string;
  projectId: string;
  generatedFiles: Record<string, string>;
  mode: 'hosted' | 'export';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface AssembledProject {
  files: Record<string, string>;
}

const TEMPLATE_DIR = path.join(process.cwd(), 'templates/nextjs')

/** Map Sandpack-style path to Next.js project path. */
function mapSandpackPath(sandpackPath: string): string {
  const normalized = sandpackPath.startsWith('/') ? sandpackPath.slice(1) : sandpackPath
  if (normalized === 'App.tsx' || normalized === 'App.jsx' || normalized === 'App.js') {
    return 'pages/index.tsx'
  }
  return normalized
}

/** Recursively read all files from a directory, returning path → content map. */
function readTemplateDir(dir: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      Object.assign(result, readTemplateDir(fullPath, relativePath))
    } else {
      result[relativePath] = fs.readFileSync(fullPath, 'utf-8')
    }
  }
  return result
}

function buildSupabaseTs(mode: 'hosted' | 'export', url?: string, key?: string): string {
  if (mode === 'hosted' && url && key) {
    return `import { createClient } from '@supabase/supabase-js'
export const supabase = createClient('${url}', '${key}')
`
  }
  return `import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
`
}

export function assembleProject(options: AssembleOptions): AssembledProject {
  const { generatedFiles, mode, supabaseUrl, supabaseAnonKey } = options

  // 1. Load all platform template files
  const templateFiles = readTemplateDir(TEMPLATE_DIR)

  // Remove the placeholder supabase files — we'll inject the right one below
  delete templateFiles['lib/supabase.hosted.ts']
  delete templateFiles['lib/supabase.export.ts']

  // 2. Map AI-generated files from Sandpack format to Next.js paths
  const mappedGenerated: Record<string, string> = {}
  for (const [sandpackPath, content] of Object.entries(generatedFiles)) {
    const nextjsPath = mapSandpackPath(sandpackPath)
    mappedGenerated[nextjsPath] = content
  }

  // 3. Merge: templates first, then AI-generated (AI can override non-critical template files)
  // But protect template infrastructure files from being overwritten
  const PROTECTED = new Set([
    'package.json', 'next.config.js', 'tsconfig.json',
    'tailwind.config.js', 'postcss.config.js',
    'pages/_app.tsx', 'pages/_document.tsx',
    'styles/globals.css', 'lib/utils.ts',
  ])

  const files: Record<string, string> = { ...templateFiles }
  for (const [nextjsPath, content] of Object.entries(mappedGenerated)) {
    if (!PROTECTED.has(nextjsPath)) {
      files[nextjsPath] = content
    }
  }

  // 4. Inject correct supabase.ts
  files['lib/supabase.ts'] = buildSupabaseTs(mode, supabaseUrl, supabaseAnonKey)

  return { files }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="project-assembler"
```

Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add lib/project-assembler.ts __tests__/project-assembler.test.ts
git commit -m "feat: implement project-assembler with TDD"
```

---

## Task 5: Implement lib/zip-exporter.ts (TDD)

**Files:**
- Create: `lib/zip-exporter.ts`
- Create: `__tests__/zip-exporter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/zip-exporter.test.ts`:

```typescript
import { createProjectZip } from '@/lib/zip-exporter'
import JSZip from 'jszip'

const FILES: Record<string, string> = {
  'package.json': '{"name":"my-app"}',
  'pages/index.tsx': 'export default function Home() { return <div>Hi</div> }',
  'components/ui/button.tsx': 'export function Button() { return <button /> }',
}

describe('createProjectZip', () => {
  it('returns a Buffer', async () => {
    const buf = await createProjectZip(FILES, 'my-app')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('zip contains files nested under project name folder', async () => {
    const buf = await createProjectZip(FILES, 'my-app')
    const zip = await JSZip.loadAsync(buf)
    expect(zip.files['my-app/package.json']).toBeDefined()
    expect(zip.files['my-app/pages/index.tsx']).toBeDefined()
    expect(zip.files['my-app/components/ui/button.tsx']).toBeDefined()
  })

  it('file content is preserved in zip', async () => {
    const buf = await createProjectZip(FILES, 'my-app')
    const zip = await JSZip.loadAsync(buf)
    const content = await zip.files['my-app/package.json'].async('string')
    expect(content).toBe('{"name":"my-app"}')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="zip-exporter"
```

Expected: FAIL — `Cannot find module '@/lib/zip-exporter'`

- [ ] **Step 3: Create lib/zip-exporter.ts**

```typescript
import JSZip from 'jszip'

/**
 * Pack a flat file map into a zip Buffer.
 * All files are nested under a top-level folder named after the project.
 */
export async function createProjectZip(
  files: Record<string, string>,
  projectName: string
): Promise<Buffer> {
  const zip = new JSZip()
  const folder = zip.folder(projectName)!

  for (const [filePath, content] of Object.entries(files)) {
    folder.file(filePath, content)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="zip-exporter"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/zip-exporter.ts __tests__/zip-exporter.test.ts
git commit -m "feat: implement zip-exporter with TDD"
```

---

## Task 6: Implement app/api/export/route.ts (TDD)

**Files:**
- Create: `app/api/export/route.ts`
- Create: `__tests__/export-route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/export-route.test.ts`:

```typescript
import { GET } from '@/app/api/export/route'

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    version: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/project-assembler', () => ({
  assembleProject: jest.fn(() => ({ files: { 'package.json': '{}' } })),
}))
jest.mock('@/lib/zip-exporter', () => ({
  createProjectZip: jest.fn(async () => Buffer.from('fake-zip')),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = getServerSession as jest.Mock
const mockVersionFindFirst = prisma.version.findFirst as jest.Mock
const mockProjectFindFirst = prisma.project.findFirst as jest.Mock

describe('GET /api/export', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const req = new Request('http://localhost/api/export?projectId=p1&versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when projectId is missing', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    const req = new Request('http://localhost/api/export?versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when project not found', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFindFirst.mockResolvedValue(null)
    const req = new Request('http://localhost/api/export?projectId=p1&versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns zip with correct headers when successful', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFindFirst.mockResolvedValue({ id: 'p1', name: 'My App', userId: 'u1' })
    mockVersionFindFirst.mockResolvedValue({
      id: 'v1', code: '', files: { '/App.tsx': 'content' },
    })
    const req = new Request('http://localhost/api/export?projectId=p1&versionId=v1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('.zip')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="export-route"
```

Expected: FAIL — `Cannot find module '@/app/api/export/route'`

- [ ] **Step 3: Create app/api/export/route.ts**

```typescript
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getVersionFiles } from '@/lib/version-files'
import { assembleProject } from '@/lib/project-assembler'
import { createProjectZip } from '@/lib/zip-exporter'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const versionId = searchParams.get('versionId')

  if (!projectId) {
    return new Response(JSON.stringify({ error: 'projectId is required' }), { status: 400 })
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  })
  if (!project) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }

  const version = await prisma.version.findFirst({
    where: versionId
      ? { id: versionId, projectId }
      : { projectId },
    orderBy: versionId ? undefined : { versionNumber: 'desc' },
  })
  if (!version) {
    return new Response(JSON.stringify({ error: 'No version found' }), { status: 404 })
  }

  const generatedFiles = getVersionFiles(version as { code: string; files?: Record<string, string> | null })
  const projectName = slugify(project.name) || 'my-app'

  const assembled = assembleProject({
    projectName,
    projectId,
    generatedFiles,
    mode: 'export',
  })

  const zipBuffer = await createProjectZip(assembled.files, projectName)

  return new Response(zipBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${projectName}.zip"`,
      'Content-Length': String(zipBuffer.length),
    },
  })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="export-route"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/export/route.ts __tests__/export-route.test.ts
git commit -m "feat: add export API route (zip download)"
```

---

## Task 7: Add Export button to PreviewPanel

**Files:**
- Modify: `components/preview/preview-panel.tsx`
- Create: `__tests__/preview-panel-deploy.test.tsx`

- [ ] **Step 1: Write failing test**

Create `__tests__/preview-panel-deploy.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PreviewPanel } from '@/components/preview/preview-panel'

jest.mock('@/components/preview/preview-frame', () => ({
  PreviewFrame: () => <div data-testid="preview-frame" />,
}))
jest.mock('@/components/preview/multi-file-editor', () => ({
  MultiFileEditor: () => <div />,
}))
jest.mock('@/components/timeline/version-timeline', () => ({
  VersionTimeline: () => <div />,
}))
jest.mock('@/lib/api-client', () => ({
  fetchAPI: jest.fn(),
}))

import { fetchAPI } from '@/lib/api-client'
const mockFetchAPI = fetchAPI as jest.Mock

const DEFAULT_PROPS = {
  files: { '/App.tsx': 'content' },
  projectId: 'proj_1',
  isGenerating: false,
  onFilesChange: jest.fn(),
  versions: [],
  previewingVersion: null,
  onPreviewVersion: jest.fn(),
  onVersionRestore: jest.fn(),
  latestVersionId: 'v1',
}

describe('PreviewPanel export button', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders Export button when files exist', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} />)
    expect(screen.getByTestId('btn-export')).toBeInTheDocument()
  })

  it('Export button is disabled when isGenerating', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} isGenerating={true} />)
    expect(screen.getByTestId('btn-export')).toBeDisabled()
  })

  it('Export button triggers download', async () => {
    const fakeBlob = new Blob(['zip'], { type: 'application/zip' })
    mockFetchAPI.mockResolvedValue({ ok: true, blob: async () => fakeBlob })

    // Mock URL.createObjectURL + click
    const createObjectURL = jest.fn(() => 'blob:fake')
    const revokeObjectURL = jest.fn()
    Object.defineProperty(window, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    })

    render(<PreviewPanel {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByTestId('btn-export'))

    await waitFor(() => expect(mockFetchAPI).toHaveBeenCalledWith(
      expect.stringContaining('/api/export'),
      expect.any(Object)
    ))
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="preview-panel-deploy"
```

Expected: FAIL

- [ ] **Step 3: Update components/preview/preview-panel.tsx**

Add `latestVersionId` prop and Export button. Replace the existing `PreviewPanelProps` and component:

```tsx
"use client";

import { useState } from "react";
import { PreviewFrame } from "@/components/preview/preview-frame";
import { MultiFileEditor } from "@/components/preview/multi-file-editor";
import { VersionTimeline } from "@/components/timeline/version-timeline";
import { fetchAPI } from "@/lib/api-client";
import type { ProjectVersion } from "@/lib/types";

type Tab = "preview" | "code";

interface PreviewPanelProps {
  files: Record<string, string>;
  projectId: string;
  isGenerating: boolean;
  onFilesChange: (files: Record<string, string>) => void;
  versions: ProjectVersion[];
  previewingVersion: ProjectVersion | null;
  onPreviewVersion: (version: ProjectVersion | null) => void;
  onVersionRestore: (newVersion: ProjectVersion) => void;
  latestVersionId?: string;
}

export function PreviewPanel({
  files,
  projectId,
  isGenerating,
  onFilesChange,
  versions,
  previewingVersion,
  onPreviewVersion,
  onVersionRestore,
  latestVersionId,
}: PreviewPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [isExporting, setIsExporting] = useState(false);
  const hasCode = Object.values(files).some((code) => code.length > 0);

  async function handleExport() {
    if (!latestVersionId) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ projectId, versionId: latestVersionId });
      const res = await fetchAPI(`/api/export?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 min-w-0">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex gap-1">
          {(["preview", "code"] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={`tab-${t}`}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {t === "preview" ? "预览" : "代码"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {hasCode && (
            <button
              data-testid="btn-export"
              disabled={isGenerating || isExporting || !latestVersionId}
              onClick={handleExport}
              className="px-3 py-1 rounded text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isExporting ? "导出中..." : "Export ↓"}
            </button>
          )}
          <span className="text-xs text-gray-400">⚡ Sandpack</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "preview" ? (
          <div className="flex-1 overflow-hidden relative">
            {hasCode ? (
              <PreviewFrame files={files} projectId={projectId} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 bg-gray-50 text-center px-8">
                <div className="text-5xl">🏗️</div>
                <p className="font-semibold text-gray-700">BuilderAI</p>
                <p className="text-sm text-gray-400">等待生成 — 在左侧输入需求，AI 将为你生成应用</p>
              </div>
            )}
            {isGenerating && (
              <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-48 h-4 bg-gray-200 rounded animate-pulse" />
                  <div className="w-32 h-4 bg-gray-200 rounded animate-pulse" />
                  <p className="text-sm text-muted-foreground">正在生成中...</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <MultiFileEditor files={files} onFilesChange={onFilesChange} />
        )}

        {versions.length > 0 && (
          <VersionTimeline
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={onPreviewVersion}
            onRestoreVersion={onVersionRestore}
            isGenerating={isGenerating}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass latestVersionId in workspace.tsx**

In `components/workspace/workspace.tsx` at line 127, update the `PreviewPanel` render to add the new prop:

```tsx
          <PreviewPanel
            files={displayFiles}
            projectId={project.id}
            isGenerating={isGenerating}
            onFilesChange={setCurrentFiles}
            versions={versions}
            previewingVersion={previewingVersion}
            onPreviewVersion={setPreviewingVersion}
            onVersionRestore={handleRestoreVersion}
            latestVersionId={versions[versions.length - 1]?.id}
          />
```

- [ ] **Step 5: Run all tests**

```bash
npm test -- --testPathPatterns="preview-panel"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/preview/preview-panel.tsx components/workspace/workspace.tsx __tests__/preview-panel-deploy.test.tsx
git commit -m "feat: add Export button to PreviewPanel (P1 complete)"
```

---

## Task 8: Add VERCEL_TOKEN to env config

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (manual step, not committed)

- [ ] **Step 1: Add VERCEL_TOKEN to .env.example**

Append to `.env.example`:

```
# Vercel Deploy API (for one-click deployment)
VERCEL_TOKEN=your_vercel_api_token
VERCEL_TEAM_ID=                    # optional: your Vercel team ID
```

- [ ] **Step 2: Add your actual Vercel token to .env.local**

Go to https://vercel.com/account/tokens, create a token named `builder-ai-deploy`.
Add to `.env.local`:

```
VERCEL_TOKEN=your_actual_token_here
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add VERCEL_TOKEN to env config"
```

---

## Task 9: Implement lib/vercel-deploy.ts (TDD)

**Files:**
- Create: `lib/vercel-deploy.ts`
- Create: `__tests__/vercel-deploy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/vercel-deploy.test.ts`:

```typescript
import { createVercelDeployment, pollDeploymentStatus } from '@/lib/vercel-deploy'

// Mock global fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('createVercelDeployment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.VERCEL_TOKEN = 'test-token'
  })

  it('calls Vercel Deploy API with correct headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'dpl_abc', url: 'my-app.vercel.app', readyState: 'QUEUED' }),
    })

    await createVercelDeployment({
      projectSlug: 'my-app',
      files: { 'pages/index.tsx': 'export default function Home() {}' },
      vercelProjectId: undefined,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v13/deployments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('returns deploymentId and url', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'dpl_abc', url: 'my-app.vercel.app', readyState: 'QUEUED' }),
    })

    const result = await createVercelDeployment({
      projectSlug: 'my-app',
      files: { 'pages/index.tsx': 'content' },
      vercelProjectId: undefined,
    })

    expect(result.vercelDeployId).toBe('dpl_abc')
    expect(result.url).toBe('https://my-app.vercel.app')
  })

  it('throws when VERCEL_TOKEN is not set', async () => {
    delete process.env.VERCEL_TOKEN
    await expect(
      createVercelDeployment({ projectSlug: 'x', files: {}, vercelProjectId: undefined })
    ).rejects.toThrow('VERCEL_TOKEN')
  })

  it('throws when Vercel API returns error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Invalid token' } }),
    })

    await expect(
      createVercelDeployment({ projectSlug: 'x', files: {}, vercelProjectId: undefined })
    ).rejects.toThrow('Invalid token')
  })
})

describe('pollDeploymentStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.VERCEL_TOKEN = 'test-token'
  })

  it('returns ready when deployment is READY', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'READY', url: 'my-app.vercel.app' }),
    })

    const result = await pollDeploymentStatus('dpl_abc', 1)
    expect(result.status).toBe('ready')
    expect(result.url).toBe('https://my-app.vercel.app')
  })

  it('returns error when deployment has ERROR state', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'ERROR' }),
    })

    const result = await pollDeploymentStatus('dpl_abc', 1)
    expect(result.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="vercel-deploy"
```

Expected: FAIL — `Cannot find module '@/lib/vercel-deploy'`

- [ ] **Step 3: Create lib/vercel-deploy.ts**

```typescript
const VERCEL_API = 'https://api.vercel.com'

export interface CreateDeploymentOptions {
  projectSlug: string;
  files: Record<string, string>;
  vercelProjectId?: string;
}

export interface CreateDeploymentResult {
  vercelDeployId: string;
  vercelProjectId: string;
  url: string;
}

export interface PollResult {
  status: 'ready' | 'error' | 'building';
  url?: string;
}

function getToken(): string {
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN environment variable is not set')
  return token
}

function normalizeUrl(url: string): string {
  return url.startsWith('https://') ? url : `https://${url}`
}

/** Convert file map to Vercel deployment files array. */
function toVercelFiles(files: Record<string, string>) {
  return Object.entries(files).map(([file, data]) => ({
    file,
    data: Buffer.from(data).toString('base64'),
    encoding: 'base64',
  }))
}

export async function createVercelDeployment(
  options: CreateDeploymentOptions
): Promise<CreateDeploymentResult> {
  const token = getToken()
  const { projectSlug, files, vercelProjectId } = options

  const body: Record<string, unknown> = {
    name: projectSlug,
    files: toVercelFiles(files),
    projectSettings: { framework: 'nextjs' },
    target: 'production',
  }
  if (vercelProjectId) body.project = vercelProjectId

  const teamId = process.env.VERCEL_TEAM_ID
  const url = teamId
    ? `${VERCEL_API}/v13/deployments?teamId=${teamId}`
    : `${VERCEL_API}/v13/deployments`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json() as {
    id?: string;
    url?: string;
    projectId?: string;
    readyState?: string;
    error?: { message: string };
  }

  if (!res.ok) {
    throw new Error(data.error?.message ?? `Vercel API error: ${res.status}`)
  }

  return {
    vercelDeployId: data.id!,
    vercelProjectId: data.projectId ?? vercelProjectId ?? '',
    url: normalizeUrl(data.url!),
  }
}

/**
 * Poll Vercel until deployment reaches a terminal state.
 * @param deployId - Vercel deployment ID
 * @param maxAttempts - maximum poll cycles (default 40 = ~120s at 3s intervals)
 */
export async function pollDeploymentStatus(
  deployId: string,
  maxAttempts = 40
): Promise<PollResult> {
  const token = getToken()
  const teamId = process.env.VERCEL_TEAM_ID

  for (let i = 0; i < maxAttempts; i++) {
    const url = teamId
      ? `${VERCEL_API}/v13/deployments/${deployId}?teamId=${teamId}`
      : `${VERCEL_API}/v13/deployments/${deployId}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json() as { readyState: string; url?: string }

    if (data.readyState === 'READY') {
      return { status: 'ready', url: data.url ? normalizeUrl(data.url) : undefined }
    }
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      return { status: 'error' }
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }

  return { status: 'error' }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="vercel-deploy"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/vercel-deploy.ts __tests__/vercel-deploy.test.ts
git commit -m "feat: implement Vercel Deploy API wrapper with TDD"
```

---

## Task 10: Implement Deploy API routes (TDD)

**Files:**
- Create: `app/api/deploy/route.ts` (POST — trigger deployment)
- Create: `app/api/deploy/[id]/route.ts` (GET — poll status)
- Create: `__tests__/deploy-route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/deploy-route.test.ts`:

```typescript
import { POST } from '@/app/api/deploy/route'
import { GET } from '@/app/api/deploy/[id]/route'

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))
jest.mock('@/lib/auth', () => ({ authOptions: {} }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    version: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    deployment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  },
}))
jest.mock('@/lib/project-assembler', () => ({
  assembleProject: jest.fn(() => ({ files: { 'package.json': '{}' } })),
}))
jest.mock('@/lib/vercel-deploy', () => ({
  createVercelDeployment: jest.fn(),
  pollDeploymentStatus: jest.fn(),
}))
jest.mock('@/lib/version-files', () => ({
  getVersionFiles: jest.fn(() => ({ '/App.tsx': 'content' })),
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { createVercelDeployment, pollDeploymentStatus } from '@/lib/vercel-deploy'

const mockSession = getServerSession as jest.Mock
const mockProjectFind = prisma.project.findFirst as jest.Mock
const mockVersionFind = prisma.version.findFirst as jest.Mock
const mockDeployCreate = prisma.deployment.create as jest.Mock
const mockDeployFind = prisma.deployment.findUnique as jest.Mock
const mockDeployUpdate = prisma.deployment.update as jest.Mock
const mockCreateDeploy = createVercelDeployment as jest.Mock
const mockPollStatus = pollDeploymentStatus as jest.Mock

describe('POST /api/deploy', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null)
    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', versionId: 'v1' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when projectId missing', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('creates deployment record and returns deploymentId', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockProjectFind.mockResolvedValue({ id: 'p1', name: 'My App', userId: 'u1' })
    mockVersionFind.mockResolvedValue({ id: 'v1', code: '', files: { '/App.tsx': 'x' } })
    mockCreateDeploy.mockResolvedValue({
      vercelDeployId: 'dpl_abc',
      vercelProjectId: 'vp_xyz',
      url: 'https://my-app.vercel.app',
    })
    mockDeployCreate.mockResolvedValue({
      id: 'dep_1',
      status: 'building',
      url: 'https://my-app.vercel.app',
    })

    const req = new Request('http://localhost/api/deploy', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', versionId: 'v1' }),
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.deploymentId).toBe('dep_1')
    expect(body.status).toBe('building')
  })
})

describe('GET /api/deploy/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockSession.mockResolvedValue(null)
    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    expect(res.status).toBe(401)
  })

  it('returns current status without polling when already ready', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockDeployFind.mockResolvedValue({
      id: 'dep_1', status: 'ready', url: 'https://my-app.vercel.app',
      project: { userId: 'u1' },
    })

    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ready')
    expect(body.url).toBe('https://my-app.vercel.app')
    expect(mockPollStatus).not.toHaveBeenCalled()
  })

  it('polls Vercel and updates DB when status is building', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u1' } })
    mockDeployFind.mockResolvedValue({
      id: 'dep_1', status: 'building', url: 'https://my-app.vercel.app',
      vercelDeployId: 'dpl_abc',
      project: { userId: 'u1' },
    })
    mockPollStatus.mockResolvedValue({ status: 'ready', url: 'https://my-app.vercel.app' })
    mockDeployUpdate.mockResolvedValue({
      id: 'dep_1', status: 'ready', url: 'https://my-app.vercel.app',
    })

    const req = new Request('http://localhost/api/deploy/dep_1')
    const res = await GET(req, { params: { id: 'dep_1' } })
    const body = await res.json()

    expect(mockPollStatus).toHaveBeenCalledWith('dpl_abc', 1)
    expect(body.status).toBe('ready')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="deploy-route"
```

Expected: FAIL

- [ ] **Step 3: Create app/api/deploy/route.ts**

```typescript
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getVersionFiles } from '@/lib/version-files'
import { assembleProject } from '@/lib/project-assembler'
import { createVercelDeployment } from '@/lib/vercel-deploy'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { projectId?: string; versionId?: string }
  const { projectId, versionId } = body

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const version = await prisma.version.findFirst({
    where: versionId ? { id: versionId, projectId } : { projectId },
    orderBy: versionId ? undefined : { versionNumber: 'desc' },
  })
  if (!version) return NextResponse.json({ error: 'No version found' }, { status: 404 })

  const generatedFiles = getVersionFiles(
    version as { code: string; files?: Record<string, string> | null }
  )
  const projectSlug = slugify(project.name) || 'my-app'

  const assembled = assembleProject({
    projectName: projectSlug,
    projectId,
    generatedFiles,
    mode: 'hosted',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })

  const vercelResult = await createVercelDeployment({
    projectSlug,
    files: assembled.files,
    vercelProjectId: undefined,
  })

  const deployment = await prisma.deployment.create({
    data: {
      projectId,
      versionId: version.id,
      vercelProjectId: vercelResult.vercelProjectId,
      vercelDeployId: vercelResult.vercelDeployId,
      url: vercelResult.url,
      status: 'building',
    },
  })

  return NextResponse.json(
    { deploymentId: deployment.id, status: 'building', url: deployment.url },
    { status: 202 }
  )
}
```

- [ ] **Step 4: Create app/api/deploy/[id]/route.ts**

```typescript
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { pollDeploymentStatus } from '@/lib/vercel-deploy'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deployment = await prisma.deployment.findUnique({
    where: { id: params.id },
    include: { project: { select: { userId: true } } },
  })

  if (!deployment || deployment.project.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Already in terminal state — return immediately
  if (deployment.status === 'ready' || deployment.status === 'error') {
    return NextResponse.json({ status: deployment.status, url: deployment.url })
  }

  // Still building — do a single poll cycle (frontend retries every 3s)
  const pollResult = await pollDeploymentStatus(deployment.vercelDeployId, 1)

  if (pollResult.status !== 'building') {
    const updated = await prisma.deployment.update({
      where: { id: params.id },
      data: {
        status: pollResult.status,
        ...(pollResult.url ? { url: pollResult.url } : {}),
      },
    })
    return NextResponse.json({ status: updated.status, url: updated.url })
  }

  return NextResponse.json({ status: 'building', url: deployment.url })
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="deploy-route"
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/deploy/ __tests__/deploy-route.test.ts
git commit -m "feat: add deploy API routes (trigger + poll status)"
```

---

## Task 11: Add Deploy button to PreviewPanel

**Files:**
- Modify: `components/preview/preview-panel.tsx`
- Modify: `__tests__/preview-panel-deploy.test.tsx`

- [ ] **Step 1: Add Deploy button tests to existing test file**

In `__tests__/preview-panel-deploy.test.tsx`, add after the existing export tests:

```tsx
describe('PreviewPanel deploy button', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders Deploy button when files exist', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} />)
    expect(screen.getByTestId('btn-deploy')).toBeInTheDocument()
  })

  it('Deploy button is disabled when isGenerating', () => {
    render(<PreviewPanel {...DEFAULT_PROPS} isGenerating={true} />)
    expect(screen.getByTestId('btn-deploy')).toBeDisabled()
  })

  it('shows building state after deploy click', async () => {
    mockFetchAPI.mockResolvedValue({
      ok: true,
      json: async () => ({ deploymentId: 'dep_1', status: 'building', url: 'https://app.vercel.app' }),
    })

    render(<PreviewPanel {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByTestId('btn-deploy'))

    await waitFor(() =>
      expect(screen.getByTestId('btn-deploy')).toHaveTextContent('部署中...')
    )
  })

  it('shows deployed URL after successful deploy', async () => {
    // First call: POST /api/deploy → building
    // Subsequent calls: GET /api/deploy/dep_1 → ready
    mockFetchAPI
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deploymentId: 'dep_1', status: 'building', url: 'https://app.vercel.app' }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ready', url: 'https://app.vercel.app' }),
      })

    render(<PreviewPanel {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByTestId('btn-deploy'))

    await waitFor(() =>
      expect(screen.getByTestId('deploy-url')).toBeInTheDocument()
    , { timeout: 5000 })
  })
})
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
npm test -- --testPathPatterns="preview-panel-deploy"
```

Expected: the new deploy button tests FAIL (button not yet added)

- [ ] **Step 3: Add Deploy button and polling logic to preview-panel.tsx**

At the top of `components/preview/preview-panel.tsx`, update the React import to include `useRef`:

```tsx
import { useState, useRef } from "react";
```

Then add three new state declarations after the existing `const [tab, setTab]` line:

```tsx
const [deployState, setDeployState] = useState<'idle' | 'building' | 'ready' | 'error'>('idle');
const [deployUrl, setDeployUrl] = useState<string | null>(null);
const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

Add the `handleDeploy` function after `handleExport`:
async function handleDeploy() {
  if (!latestVersionId) return;
  setDeployState('building');
  setDeployUrl(null);

  try {
    const res = await fetchAPI('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, versionId: latestVersionId }),
    });
    if (!res.ok) throw new Error('Deploy failed');
    const { deploymentId } = await res.json() as { deploymentId: string };

    // Poll for completion
    deployPollRef.current = setInterval(async () => {
      const pollRes = await fetchAPI(`/api/deploy/${deploymentId}`);
      if (!pollRes.ok) return;
      const { status, url } = await pollRes.json() as { status: string; url: string };

      if (status === 'ready') {
        clearInterval(deployPollRef.current!);
        setDeployState('ready');
        setDeployUrl(url);
      } else if (status === 'error') {
        clearInterval(deployPollRef.current!);
        setDeployState('error');
      }
    }, 3000);
  } catch {
    setDeployState('error');
  }
}
```

Add the Deploy button and URL display in the toolbar (after the Export button):

```tsx
{hasCode && (
  <button
    data-testid="btn-deploy"
    disabled={isGenerating || deployState === 'building' || !latestVersionId}
    onClick={handleDeploy}
    className={`px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      deployState === 'ready'
        ? 'bg-green-100 text-green-700 border border-green-200'
        : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
    }`}
  >
    {deployState === 'building' ? '部署中...' : deployState === 'ready' ? '已部署 ↗' : 'Deploy ↗'}
  </button>
)}
{deployUrl && (
  <a
    data-testid="deploy-url"
    href={deployUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-indigo-600 hover:underline truncate max-w-[160px]"
  >
    {deployUrl.replace('https://', '')}
  </a>
)}
```

- [ ] **Step 4: Run all tests**

```bash
npm test -- --testPathPatterns="preview-panel-deploy"
```

Expected: PASS (all tests including deploy button tests)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/preview/preview-panel.tsx __tests__/preview-panel-deploy.test.tsx
git commit -m "feat: add Deploy button with polling to PreviewPanel (P2 complete)"
```

---

## Done

At this point both P1 (Export) and P2 (Deploy) are complete:

- Users can click **Export ↓** to download a full Next.js zip project
- Users can click **Deploy ↗** to deploy to Vercel, with live status polling
- Deploy URL persists in the UI after successful deployment
- All new logic is covered by unit tests

P3 (backend API routes generation) and P4 (deployment history view) are future phases — see spec for details.
