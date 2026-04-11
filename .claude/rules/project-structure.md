# BuilderAI — Project Structure

```
builder-ai/
├── app/
│   ├── layout.tsx                      # Root layout (providers, fonts, metadata)
│   ├── page.tsx                        # Home: project list (authed) or landing (unauthed)
│   ├── globals.css                     # Tailwind base imports
│   │
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts # NextAuth handler
│   │   ├── generate/route.ts           # SSE: AI generation (per-agent)
│   │   ├── projects/
│   │   │   ├── route.ts                # GET (list) / POST (create)
│   │   │   └── [id]/route.ts           # GET (detail) / PATCH (update) / DELETE
│   │   ├── messages/route.ts           # GET (by project) / POST (save)
│   │   └── versions/
│   │       ├── route.ts                # GET (by project) / POST (create)
│   │       └── [id]/
│   │           └── restore/route.ts    # POST (restore version)
│   │
│   └── project/
│       └── [id]/
│           └── page.tsx                # Workspace: Agent panel + Chat + Preview
│
├── components/
│   ├── ui/                             # shadcn/ui components (auto-generated)
│   │
│   ├── layout/
│   │   ├── header.tsx                  # Top nav: logo, user avatar, sign out
│   │   ├── auth-guard.tsx              # Redirect to login if not authed
│   │   ├── demo-banner.tsx             # Demo mode indicator (amber bg, read-only notice)
│   │   ├── demo-login-button.tsx       # Quick-login for demo viewer account
│   │   └── email-login-form.tsx        # Email Magic Link form (unified sign-in/sign-up)
│   │
│   ├── home/
│   │   ├── project-card.tsx            # Project list card
│   │   └── create-project-dialog.tsx   # New project modal
│   │
│   ├── workspace/
│   │   ├── workspace.tsx               # Main 3-column layout
│   │   ├── chat-input.tsx              # Bottom input bar
│   │   └── chat-area.tsx               # Message list with auto-scroll
│   │
│   ├── sidebar/
│   │   ├── conversation-sidebar.tsx    # Left sidebar: project list + new project button
│   │   └── project-item.tsx            # Individual project row (name, preview, time)
│   │
│   ├── agent/
│   │   ├── agent-status-bar.tsx        # Top horizontal agent status cards (inline in chat)
│   │   ├── agent-card.tsx              # Individual agent status card (horizontal)
│   │   ├── agent-message.tsx           # Chat bubble with avatar + role
│   │   └── thinking-indicator.tsx      # Typing dots animation
│   │
│   ├── preview/
│   │   ├── preview-panel.tsx           # Right panel: toolbar + tabs
│   │   ├── preview-frame.tsx           # iframe with srcdoc
│   │   ├── code-editor.tsx             # Monaco Editor (editable, triggers preview refresh)
│   │   └── device-selector.tsx         # Desktop/Tablet/Mobile toggle
│   │
│   └── timeline/
│       ├── version-timeline.tsx        # Horizontal timeline at bottom
│       ├── version-node.tsx            # Individual version dot
│       └── version-detail-popover.tsx  # Click-to-show version info
│
├── hooks/
│   ├── use-agent-stream.ts             # SSE streaming + agent orchestration
│   ├── use-versions.ts                 # Version CRUD + timeline state
│   └── use-project.ts                  # Project data fetching
│
├── lib/
│   ├── api-client.ts                   # fetchAPI() / fetchSSE() — CRITICAL abstraction
│   ├── ai-provider.ts                  # Gemini/Groq abstraction + streaming
│   ├── agents.ts                       # Agent definitions (roles, prompts, colors)
│   ├── code-renderer.ts               # CodeRenderer interface + HtmlRenderer
│   ├── auth.ts                         # NextAuth configuration (GitHub, Email, Demo)
│   ├── resend.ts                       # Resend email service singleton
│   ├── demo-bootstrap.ts               # Auto-create demo viewer account on startup
│   ├── prisma.ts                       # Prisma client singleton
│   └── types.ts                        # Shared TypeScript types
│
├── prisma/
│   └── schema.prisma                   # Database schema
│
├── public/
│   └── favicon.ico
│
├── .env.local                          # Local env vars (git-ignored)
├── .env.example                        # Template for env vars
├── .gitignore
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Directory Rules

| Directory | Rule |
|-----------|------|
| `app/api/` | API routes only. No UI logic. Each route file < 100 lines. |
| `components/` | Organized by feature domain, not by component type. |
| `components/ui/` | shadcn/ui only. Never manually edit these files. |
| `hooks/` | Custom React hooks. One hook per file. Must start with `use`. |
| `lib/` | Pure utility functions and configurations. No React imports. |
| `prisma/` | Schema only. No seed files needed for demo. |

## File Size Limits

| Type | Max Lines | If exceeded |
|------|-----------|-------------|
| Component | 200 | Extract sub-components |
| API route | 100 | Extract logic to `lib/` |
| Hook | 150 | Split into smaller hooks |
| Lib utility | 200 | Split by concern |
