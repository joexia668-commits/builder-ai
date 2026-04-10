# UI/UX Refined Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the "Refined Tool" visual redesign across Home page and Workspace — cleaner typography, shadow system, colored agent bubbles, sidebar active indicator, and polished input/toolbar.

**Architecture:** Pure style changes — only Tailwind class adjustments plus one small behavioral addition (Tab filter on Home page). No new dependencies, no API changes, no component restructuring beyond inline additions.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS 3, shadcn/ui

---

## Files Changed

| File | Change |
|---|---|
| `app/page.tsx` | Page max-width + padding |
| `components/layout/header.tsx` | Height, padding, logo typography, avatar size |
| `components/home/project-list.tsx` | Title typography, Tab filter, empty state, dashed new-project card |
| `components/home/project-card.tsx` | Shadow system, hover border, badge color |
| `components/sidebar/conversation-sidebar.tsx` | Width, background, section label |
| `components/sidebar/project-item.tsx` | Active left-bar indicator, dot, relative time |
| `components/agent/agent-message.tsx` | Colored bg bubbles, avatar bg, rounded corners |
| `components/agent/pm-output-card.tsx` | Title color, ✦ bullet |
| `components/workspace/chat-input.tsx` | Wrapped input with focus-within, embedded send button |
| `components/preview/preview-panel.tsx` | Pill tabs, button styles, empty state |

---

## Task 0: Create branch

- [ ] **Create and switch to feature branch**

```bash
git checkout -b feat/ui-refined-tool
```

Expected output: `Switched to a new branch 'feat/ui-refined-tool'`

---

## Task 1: Header — height, padding, logo, avatar

**Files:**
- Modify: `components/layout/header.tsx`

- [ ] **Step 1: Apply changes**

Replace the `<header>` opening tag and logo/avatar classes:

```tsx
// components/layout/header.tsx
// Change 1: header height h-12 → h-14, padding px-4 → px-6
<header className="h-14 border-b bg-white flex items-center justify-between px-6 shrink-0 z-10">

// Change 2: logo — add tracking
<span className="text-lg font-bold text-[#030712] tracking-[-0.4px]">
  Builder<span className="text-indigo-600">AI</span>
</span>

// Change 3: image avatar — w-7 h-7 → w-[30px] h-[30px]
<Image
  src={session.user.image}
  alt={session.user.name ?? "User"}
  width={30}
  height={30}
  className="rounded-full"
/>

// Change 4: fallback avatar — w-7 h-7 → w-[30px] h-[30px]
<div className="w-[30px] h-[30px] rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700">
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully` (or similar, no errors)

- [ ] **Step 3: Commit**

```bash
git add components/layout/header.tsx
git commit -m "style: refine header height, padding, and logo typography"
```

---

## Task 2: Project Card — shadow system, hover border, badge

**Files:**
- Modify: `components/home/project-card.tsx`

- [ ] **Step 1: Apply changes**

Replace the full component render with:

```tsx
// components/home/project-card.tsx — only the JSX return, imports/state unchanged
return (
  <>
    <div className="relative group" data-testid="project-card" data-projectid={project.id}>
      <Link
        href={`/project/${project.id}`}
        className="bg-white rounded-xl border border-[#e5e7eb] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:border-[#a5b4fc] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all duration-150 p-4 block"
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-[#030712] truncate pr-8 tracking-[-0.2px]">
            {project.name}
          </h3>
          <span className="shrink-0 bg-[#eef2ff] text-[#4f46e5] text-[11px] font-medium rounded-full px-[7px] py-[2px]">
            v{project._count.versions}
          </span>
        </div>
        {project.description && (
          <p className="text-[12px] text-[#6b7280] truncate mb-2">
            {project.description}
          </p>
        )}
        {project.messages[0] && (
          <p className="text-[11px] text-[#9ca3af] truncate mb-3">
            {project.messages[0].content.slice(0, 60)}...
          </p>
        )}
        <p className="text-[11px] text-[#9ca3af]">
          {new Date(project.updatedAt).toLocaleDateString("zh-CN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </Link>

      <div className="absolute top-3 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            className="inline-flex items-center justify-center rounded-md w-7 h-7 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label="项目操作"
          >
            <MoreHorizontal className="w-4 h-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
              onClick={handleDeleteClick}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              删除项目
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    {showConfirm && (
      <DeleteProjectDialog
        projectName={project.name}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        isLoading={isDeleting}
      />
    )}
  </>
);
```

Also remove the `Badge` import since it's no longer used:
```tsx
// Remove this line:
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/home/project-card.tsx
git commit -m "style: refine project card shadow, hover border, and badge color"
```

---

## Task 3: Page layout + Project List — typography, tabs, empty state, dashed card

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/home/project-list.tsx`

- [ ] **Step 1: Update page max-width and padding (`app/page.tsx`)**

```tsx
// app/page.tsx — change only the <main> className
<main className="flex-1 max-w-[860px] mx-auto w-full px-6 py-9">
```

- [ ] **Step 2: Rewrite `project-list.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProjectCard } from "@/components/home/project-card";
import { fetchAPI } from "@/lib/api-client";
import { toast } from "sonner";

export interface ProjectWithMeta {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  _count: { versions: number; messages: number };
  messages: { content: string; role: string }[];
}

type TabFilter = "all" | "recent";

interface ProjectListProps {
  projects: ProjectWithMeta[];
}

export function ProjectList({ projects: initialProjects }: ProjectListProps) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const visibleProjects =
    tab === "recent"
      ? projects.filter((p) => new Date(p.updatedAt) >= sevenDaysAgo)
      : projects;

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetchAPI("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const project = await res.json();
      toast.success("项目创建成功");
      router.push(`/project/${project.id}`);
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetchAPI(`/api/projects/${id}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#030712] tracking-[-0.5px]">我的项目</h1>
          <p className="text-[13px] text-[#6b7280] mt-1">
            {projects.length > 0
              ? `共 ${projects.length} 个项目`
              : "还没有项目，创建第一个吧"}
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="h-[34px] px-[14px] rounded-lg transition-all duration-150 hover:shadow-[0_2px_8px_rgba(79,70,229,0.25)]"
        >
          + 新建项目
        </Button>
      </div>

      {/* Tab filter */}
      {projects.length > 0 && (
        <div className="flex gap-[2px] bg-[#f3f4f6] p-[2px] rounded-lg w-fit mb-5">
          {(["all", "recent"] as TabFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                tab === t
                  ? "bg-white text-[#111827] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "text-[#6b7280] hover:text-[#374151]"
              }`}
            >
              {t === "all" ? "全部" : "最近 7 天"}
            </button>
          ))}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-[52px] h-[52px] rounded-[14px] bg-gradient-to-br from-[#eef2ff] to-[#ede9fe] border border-[#e0e7ff] inline-flex items-center justify-center text-2xl mb-4">
            🚀
          </div>
          <p className="text-base font-semibold text-[#111827] mb-1">开始构建你的第一个 AI 应用</p>
          <p className="text-[13px] text-[#6b7280] leading-relaxed mb-5">
            告诉 AI 你想要什么，多个 Agent 协作为你生成
          </p>
          <Button
            onClick={() => setOpen(true)}
            className="h-[34px] px-[14px] rounded-lg"
          >
            创建第一个项目
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={handleDelete}
              isDeleting={deletingId === project.id}
            />
          ))}
          {/* Dashed new-project card */}
          <button
            onClick={() => setOpen(true)}
            className="border-[1.5px] border-dashed border-[#d1d5db] rounded-xl min-h-[108px] flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 hover:border-[#a5b4fc] hover:bg-[#f5f3ff]"
          >
            <div className="w-7 h-7 rounded-[8px] bg-[#eef2ff] flex items-center justify-center text-[#4f46e5] text-base font-medium">
              +
            </div>
            <span className="text-[13px] font-medium text-[#6b7280]">新建项目</span>
          </button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="项目名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <Textarea
              placeholder="项目描述（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || loading}>
              {loading ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx components/home/project-list.tsx
git commit -m "style: refine home page layout, add tab filter, dashed new-project card"
```

---

## Task 4: Conversation Sidebar — width, background, section label

**Files:**
- Modify: `components/sidebar/conversation-sidebar.tsx`

- [ ] **Step 1: Apply changes**

Three targeted edits in `conversation-sidebar.tsx`:

```tsx
// Change 1: <aside> — width and background
<aside className="w-12 lg:w-[220px] border-r bg-white flex flex-col shrink-0 overflow-hidden">

// Change 2: new project button area padding
<div className="p-[10px] border-b flex justify-center lg:block">

// Change 3: add section label before the <nav> map (inside <nav>):
<nav className="flex-1 overflow-y-auto py-1">
  <div className="hidden lg:block text-[10px] font-semibold text-[#9ca3af] uppercase tracking-[0.07em] px-2 pt-2 pb-1">
    最近项目
  </div>
  {projects.map((project) => (
    // ... unchanged
  ))}
</nav>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/sidebar/conversation-sidebar.tsx
git commit -m "style: refine sidebar width, background, add section label"
```

---

## Task 5: Project Item — left-bar active indicator, dot, relative time

**Files:**
- Modify: `components/sidebar/project-item.tsx`

- [ ] **Step 1: Add relative time helper and rewrite component**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";

export interface ProjectItemData {
  id: string;
  name: string;
  updatedAt: Date;
}

interface ProjectItemProps {
  readonly project: ProjectItemData;
  readonly isActive: boolean;
  readonly onDelete: (id: string) => void;
  readonly isDeleting?: boolean;
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const d = new Date(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function ProjectItem({
  project,
  isActive,
  onDelete,
  isDeleting = false,
}: ProjectItemProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirm(true);
  }

  function handleConfirm() {
    onDelete(project.id);
    setShowConfirm(false);
  }

  function handleCancel() {
    setShowConfirm(false);
  }

  return (
    <>
      <div
        className="group/item relative mx-1"
        data-active={isActive ? "true" : undefined}
        data-testid="project-item"
        data-projectid={project.id}
      >
        <Link
          href={`/project/${project.id}`}
          title={project.name}
          className={cn(
            "relative flex flex-col items-center lg:flex-row lg:items-center gap-2 px-2 lg:px-2 py-2.5 lg:py-[7px] rounded-lg transition-all duration-150 pr-8",
            isActive
              ? "bg-[#eef2ff] hover:bg-[#eef2ff]"
              : "hover:bg-[#f9fafb]"
          )}
        >
          {/* Left-bar active indicator (desktop only) */}
          {isActive && (
            <span className="hidden lg:block absolute left-0 top-1 bottom-1 w-[3px] bg-[#4f46e5] rounded-r-sm" />
          )}

          {/* Tablet: first letter circle */}
          <span
            className={cn(
              "lg:hidden w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
              isActive
                ? "bg-indigo-200 text-indigo-700"
                : "bg-gray-200 text-gray-600"
            )}
          >
            {project.name.charAt(0).toUpperCase()}
          </span>

          {/* Desktop: dot + name + time */}
          <span
            className={cn(
              "hidden lg:block w-1.5 h-1.5 rounded-full flex-shrink-0",
              isActive ? "bg-[#4f46e5]" : "bg-[#d1d5db]"
            )}
          />
          <div className="hidden lg:block flex-1 min-w-0">
            <span
              className={cn(
                "block text-[13px] font-medium truncate",
                isActive ? "text-[#3730a3] font-semibold" : "text-[#374151]"
              )}
            >
              {project.name}
            </span>
            <span className="block text-[11px] text-[#9ca3af] mt-0.5">
              {relativeTime(project.updatedAt)}
            </span>
          </div>
        </Link>

        <button
          onClick={handleDeleteClick}
          aria-label={`删除 ${project.name}`}
          className={cn(
            "absolute right-1 top-1/2 -translate-y-1/2",
            "w-6 h-6 flex items-center justify-center rounded",
            "text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors",
            "opacity-0 group-hover/item:opacity-100 focus:opacity-100"
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {showConfirm && (
        <DeleteProjectDialog
          projectName={project.name}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isLoading={isDeleting}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/sidebar/project-item.tsx
git commit -m "style: add active left-bar indicator and relative time to project item"
```

---

## Task 6: Agent Message — colored bubbles, avatar, rounded corners

**Files:**
- Modify: `components/agent/agent-message.tsx`

- [ ] **Step 1: Rewrite component**

```tsx
"use client";

import { AGENTS } from "@/lib/types";
import { ThinkingIndicator } from "@/components/agent/thinking-indicator";
import { PmOutputCard } from "@/components/agent/pm-output-card";
import { cn } from "@/lib/utils";
import type { ProjectMessage } from "@/lib/types";
import { extractPmOutput } from "@/lib/extract-json";

interface AgentMessageProps {
  message: ProjectMessage;
  isStreaming?: boolean;
  isThinking?: boolean;
}

function getBubbleClasses(role: string): string {
  switch (role) {
    case "pm": return "bg-[#eef2ff] border border-[#e0e7ff]";
    case "architect": return "bg-[#f5f3ff] border border-[#ede9fe]";
    case "engineer": return "bg-[#f0fdf4] border border-[#dcfce7]";
    default: return "bg-[#f9fafb] border border-[#f3f4f6]";
  }
}

function getAvatarBg(role: string): string {
  switch (role) {
    case "pm": return "#eef2ff";
    case "architect": return "#f5f3ff";
    case "engineer": return "#f0fdf4";
    default: return "#f3f4f6";
  }
}

export function AgentMessage({
  message,
  isStreaming,
  isThinking,
}: AgentMessageProps) {
  const isUser = message.role === "user";
  const agent = !isUser ? AGENTS[message.role as keyof typeof AGENTS] : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-[#4f46e5] text-white rounded-[16px_16px_4px_16px] px-4 py-2.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 max-w-[90%]">
      {/* Avatar */}
      <div
        className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 text-base shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
        style={{ background: getAvatarBg(message.role) }}
      >
        {agent?.avatar}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[11px] font-semibold"
            style={{ color: agent?.color }}
          >
            {agent?.role}
          </span>
          {isThinking && (
            <span className="text-[11px] text-[#9ca3af]">正在思考...</span>
          )}
          {isStreaming && !isThinking && (
            <span className="text-[11px] text-[#9ca3af]">生成中</span>
          )}
        </div>

        <div
          className={cn(
            "rounded-[4px_16px_16px_16px] px-4 py-3 text-sm",
            getBubbleClasses(message.role)
          )}
        >
          {isThinking ? (
            <ThinkingIndicator color={agent?.color} />
          ) : (() => {
            const pmData =
              message.role === "pm" && !isStreaming
                ? extractPmOutput(message.content)
                : null;
            return pmData ? (
              <PmOutputCard data={pmData} />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-gray-800 text-sm leading-relaxed">
                {message.content}
                {isStreaming && (
                  <span className="inline-block w-0.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-middle" />
                )}
              </pre>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/agent/agent-message.tsx
git commit -m "style: use colored bg bubbles and cleaner avatar for agent messages"
```

---

## Task 7: PM Output Card — title color, ✦ bullet

**Files:**
- Modify: `components/agent/pm-output-card.tsx`

- [ ] **Step 1: Apply two targeted changes**

```tsx
// Change 1: intent title — text-gray-800 → text-[#3730a3] + add tracking
<p className="text-[13px] font-semibold text-[#3730a3] tracking-[-0.1px]">{data.intent}</p>

// Change 2: feature bullet — replace <span> dot with ✦ character
<li key={i} className="flex items-start gap-1.5 text-gray-700">
  <span className="text-[#a5b4fc] text-[10px] mt-[3px] shrink-0">✦</span>
  {f}
</li>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/agent/pm-output-card.tsx
git commit -m "style: update PM card title color and feature bullet to ✦"
```

---

## Task 8: Chat Input — wrapped input with focus-within, embedded send button

**Files:**
- Modify: `components/workspace/chat-input.tsx`

- [ ] **Step 1: Rewrite component**

```tsx
"use client";

import { useState, useRef } from "react";
import { ModelSelector } from "@/components/workspace/model-selector";

interface ChatInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  isPreviewingHistory?: boolean;
  isGenerating?: boolean;
  onStop?: () => void;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  availableModelIds?: string[];
}

export function ChatInput({
  onSubmit,
  disabled,
  isPreviewingHistory = false,
  isGenerating = false,
  onStop,
  selectedModel,
  onModelChange,
  availableModelIds = [],
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-[#f3f4f6] px-4 py-3 bg-white">
      {selectedModel !== undefined && onModelChange && (
        <div className="mb-2 flex items-center gap-1 text-xs text-[#6b7280]">
          <span>模型：</span>
          <ModelSelector
            value={selectedModel}
            onChange={onModelChange}
            availableModelIds={availableModelIds}
            disabled={isGenerating}
          />
        </div>
      )}

      <div className="flex items-end gap-2 bg-[#f9fafb] border-[1.5px] border-[#e5e7eb] rounded-xl px-3 py-2.5 transition-all duration-150 focus-within:border-[#a5b4fc] focus-within:bg-white">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isPreviewingHistory
              ? "正在预览历史版本，请返回当前版本后再发送"
              : disabled
              ? "AI 正在生成中..."
              : "描述你想要的应用（Enter 发送，Shift+Enter 换行）"
          }
          disabled={disabled}
          rows={2}
          className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-[#111827] placeholder:text-[#9ca3af] font-sans leading-relaxed"
        />

        {isGenerating && onStop ? (
          <button
            data-testid="stop-btn"
            onClick={onStop}
            className="shrink-0 h-[30px] px-3 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 text-xs font-medium transition-all duration-150"
          >
            停止
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="shrink-0 w-[30px] h-[30px] rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-150"
            aria-label="发送"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
```

Note: `Button` and `Textarea` shadcn imports are removed; raw `<textarea>` and `<button>` are used for full style control.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors. Also confirm `data-testid="stop-btn"` is preserved for E2E tests.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/chat-input.tsx
git commit -m "style: redesign chat input with wrapped focus-within and embedded send button"
```

---

## Task 9: Preview Panel — pill tabs, button styles, empty state

**Files:**
- Modify: `components/preview/preview-panel.tsx`

- [ ] **Step 1: Replace toolbar tabs** (lines 114–129 in current file)

```tsx
{/* Toolbar */}
<div className="border-b bg-white px-3 py-2 flex items-center justify-between gap-2 shrink-0">
  {/* Pill tabs */}
  <div className="flex gap-[1px] bg-[#f3f4f6] p-[2px] rounded-lg">
    {(["preview", "code"] as Tab[]).map((t) => (
      <button
        key={t}
        data-testid={`tab-${t}`}
        onClick={() => setTab(t)}
        className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
          tab === t
            ? "bg-white text-[#111827] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
            : "text-[#6b7280] hover:text-[#374151]"
        }`}
      >
        {t === "preview" ? "预览" : "代码"}
      </button>
    ))}
  </div>

  <div className="flex items-center gap-2">
    {hasCode && (
      <>
        <button
          data-testid="btn-export"
          disabled={isGenerating || isExporting || !latestVersionId}
          onClick={handleExport}
          className="h-[28px] px-[10px] rounded-md text-[11px] font-medium border border-[#e5e7eb] bg-white text-[#374151] hover:border-[#c7d2fe] hover:bg-[#fafafa] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
        >
          {isExporting ? "导出中..." : "Export ↓"}
        </button>
        <button
          data-testid="btn-deploy"
          disabled={isGenerating || deployState === "building" || !latestVersionId}
          onClick={handleDeploy}
          className={`h-[28px] px-[10px] rounded-md text-[11px] font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
            deployState === "ready"
              ? "bg-green-100 text-green-700 border border-green-200"
              : deployState === "error"
              ? "bg-red-100 text-red-700 border border-red-200"
              : "bg-[#4f46e5] text-white hover:bg-[#4338ca]"
          }`}
        >
          {deployState === "building"
            ? "部署中..."
            : deployState === "ready"
            ? "已部署 ↗"
            : deployState === "error"
            ? "部署失败"
            : "Deploy ↗"}
        </button>
        {deployUrl && (
          <a
            data-testid="deploy-url"
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-600 hover:underline truncate max-w-[160px]"
          >
            {deployUrl.replace("https://", "")}
          </a>
        )}
      </>
    )}
    <span className="text-xs text-gray-400">⚡ Sandpack</span>
  </div>
</div>
```

- [ ] **Step 2: Replace empty state** (the `!hasCode` block inside the preview tab)

```tsx
<div className="flex flex-col items-center justify-center h-full gap-3 bg-[#f9fafb] text-center px-8">
  <div className="w-[44px] h-[44px] rounded-[12px] bg-gradient-to-br from-[#eef2ff] to-[#ede9fe] border border-[#e0e7ff] flex items-center justify-center text-xl">
    🏗️
  </div>
  <p className="font-semibold text-[#374151]">BuilderAI</p>
  <p className="text-sm text-[#9ca3af]">等待生成 — 在左侧输入需求，AI 将为你生成应用</p>
</div>
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/preview/preview-panel.tsx
git commit -m "style: pill tabs, refined button styles, and new empty state in preview panel"
```

---

## Task 10: E2E verification

- [ ] **Step 1: Start dev server and run E2E tests**

```bash
npm run test:e2e 2>&1 | tail -20
```

Expected: all existing E2E tests pass. There are no new E2E tests required since no functional behavior changed (the Tab filter is purely client-side and the `stop-btn` / `tab-preview` / `tab-code` / `btn-export` / `btn-deploy` test IDs are all preserved).

- [ ] **Step 2: If any test fails, check for `data-testid` regressions**

The following `data-testid` attributes must be present and unchanged:
- `stop-btn` — `chat-input.tsx` ✓ preserved
- `tab-preview` / `tab-code` — `preview-panel.tsx` ✓ preserved
- `btn-export` / `btn-deploy` / `deploy-url` — `preview-panel.tsx` ✓ preserved
- `project-card` / `project-item` — ✓ unchanged
- `mobile-tab-chat` / `mobile-tab-preview` — `workspace.tsx` (not touched) ✓

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "fix: resolve E2E regressions from UI redesign"
```
