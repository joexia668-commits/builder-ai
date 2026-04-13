# BuilderAI — Code Conventions

## General

- `import type { ... }` for type-only imports

## Naming

| Category | Convention | Example |
|----------|-----------|---------|
| Variables, functions | camelCase | `fetchProjects`, `codeBuffer` |
| Components | PascalCase | `AgentPanel`, `PreviewFrame` |
| Types, interfaces | PascalCase | `AgentRole`, `CodeRenderer` |
| Constants | UPPER_SNAKE_CASE | `AGENTS`, `MAX_CODE_LENGTH` |
| Files (components) | kebab-case | `agent-panel.tsx`, `preview-frame.tsx` |
| Files (lib/utils) | kebab-case | `api-client.ts`, `ai-provider.ts` |

## API Client — fetchAPI Abstraction (CRITICAL)

ALL frontend API calls MUST go through the unified `fetchAPI()` or `fetchSSE()` functions:

```typescript
// lib/api-client.ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// For JSON API calls
export async function fetchAPI(path: string, options?: RequestInit): Promise<Response>

// For SSE streaming calls
export function fetchSSE(path: string, options?: RequestInit): Promise<Response>
```

**NEVER** call `fetch('/api/...')` directly in components. This enables zero-cost switch to separate backend deployment.

## React Components

- Functional components only
- Use `'use client'` directive only when needed (event handlers, hooks, browser APIs)
- Server Components by default
- Props interface defined above component:

```typescript
interface AgentMessageProps {
  readonly agent: Agent;
  readonly content: string;
  readonly isStreaming: boolean;
}

export function AgentMessage({ agent, content, isStreaming }: AgentMessageProps) {
  // ...
}
```

## State Management

- React hooks (`useState`, `useReducer`) for local state
- No global state library needed for this project size
- Custom hooks in `hooks/` directory for reusable logic:
  - `useAgentStream()` — SSE streaming logic
  - `useVersions()` — version timeline data
  - `useProject()` — project CRUD

## Error Handling

- API routes: return `{ error: string, details?: unknown }`
- AI API failures: show retry button, don't crash the page

## CodeRenderer Interface (Extension Point)

```typescript
interface CodeRenderer {
  render(code: string): void;
  refresh(): void;
  getMode(): 'html' | 'sandpack';
  destroy(): void;
}
```

Current: `HtmlRenderer` (iframe srcdoc)
Future: `SandpackRenderer` (React components)

## CSS

- Tailwind utility classes for all styling
- shadcn/ui components for complex UI elements
- No custom CSS files unless absolutely necessary
- Use `cn()` utility for conditional class merging

## Comments

- Self-documenting code preferred
- Comments explain "why", not "what"
- JSDoc for exported functions in `lib/`
- No comments on obvious code
