# Rename Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to rename a project from the Home page card dropdown and the Workspace sidebar dropdown.

**Architecture:** Add a shared `RenameProjectDialog` component (mirroring `DeleteProjectDialog`), wire a "重命名" menu item into `ProjectCard`'s existing dropdown, replace `ProjectItem`'s delete button with a `DropdownMenu` containing both rename and delete, and add `handleRename` to the two parent list components. The API (`PATCH /api/projects/[id]`) already supports `name` updates — no backend changes needed.

**Tech Stack:** React (functional components, hooks), TypeScript strict, shadcn/ui (`DropdownMenu`, `Button`, `Input`), lucide-react (`Pencil`, `MoreHorizontal`), sonner (`toast`), Jest + Testing Library.

---

## File Map

| Action | File |
|--------|------|
| **Create** | `components/ui/rename-project-dialog.tsx` |
| **Create** | `__tests__/rename-project-dialog.test.tsx` |
| **Modify** | `components/home/project-card.tsx` |
| **Modify** | `components/home/project-list.tsx` |
| **Modify** | `__tests__/project-card.test.tsx` |
| **Modify** | `components/sidebar/project-item.tsx` |
| **Modify** | `components/sidebar/conversation-sidebar.tsx` |
| **Modify** | `__tests__/project-item.test.tsx` |

---

### Task 1: RenameProjectDialog — write failing tests

**Files:**
- Create: `__tests__/rename-project-dialog.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// __tests__/rename-project-dialog.test.tsx
/**
 * TDD unit tests for RenameProjectDialog component
 *
 * RPD-01: renders dialog title and pre-fills input with current name
 * RPD-02: confirm button disabled when name is unchanged
 * RPD-03: confirm button enabled when name is changed
 * RPD-04: calls onConfirm with trimmed new name on button click
 * RPD-05: calls onConfirm on Enter key
 * RPD-06: cancel button calls onCancel
 * RPD-07: shows '保存中...' and disables button when isLoading=true
 * RPD-08: cancel button disabled when isLoading=true
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { RenameProjectDialog } from "@/components/ui/rename-project-dialog";

describe("RenameProjectDialog", () => {
  const defaultProps = {
    projectName: "My Test App",
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("RPD-01a: renders dialog title '重命名项目'", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    expect(screen.getByText("重命名项目")).toBeInTheDocument();
  });

  it("RPD-01b: pre-fills input with current project name", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    expect(screen.getByRole("textbox")).toHaveValue("My Test App");
  });

  it("RPD-02: confirm button disabled when name is unchanged", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("RPD-03: confirm button enabled when name is changed", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New Name" },
    });
    expect(screen.getByRole("button", { name: "保存" })).not.toBeDisabled();
  });

  it("RPD-04: calls onConfirm with trimmed new name on button click", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  New Name  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(defaultProps.onConfirm).toHaveBeenCalledWith("New Name");
  });

  it("RPD-05: calls onConfirm on Enter key", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New Name" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(defaultProps.onConfirm).toHaveBeenCalledWith("New Name");
  });

  it("RPD-06: cancel button calls onCancel", () => {
    render(<RenameProjectDialog {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("RPD-07: shows '保存中...' and disables confirm when isLoading=true", () => {
    render(<RenameProjectDialog {...defaultProps} isLoading={true} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New Name" },
    });
    expect(screen.getByRole("button", { name: "保存中..." })).toBeDisabled();
  });

  it("RPD-08: cancel button disabled when isLoading=true", () => {
    render(<RenameProjectDialog {...defaultProps} isLoading={true} />);
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="rename-project-dialog"
```

Expected: FAIL — "Cannot find module '@/components/ui/rename-project-dialog'"

---

### Task 2: RenameProjectDialog — implement component

**Files:**
- Create: `components/ui/rename-project-dialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/ui/rename-project-dialog.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RenameProjectDialogProps {
  readonly projectName: string;
  readonly onConfirm: (newName: string) => void;
  readonly onCancel: () => void;
  readonly isLoading?: boolean;
}

export function RenameProjectDialog({
  projectName,
  onConfirm,
  onCancel,
  isLoading = false,
}: RenameProjectDialogProps) {
  const [name, setName] = useState(projectName);

  function handleConfirm() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === projectName) return;
    onConfirm(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={!isLoading ? onCancel : undefined}
      />
      <div className="relative z-10 bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4">
        <h2
          id="rename-dialog-title"
          className="text-lg font-semibold text-gray-900 mb-4"
        >
          重命名项目
        </h2>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          autoFocus
          className="mb-4"
        />
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!name.trim() || name.trim() === projectName || isLoading}
          >
            {isLoading ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="rename-project-dialog"
```

Expected: PASS — 8 tests pass

- [ ] **Step 3: Commit**

```bash
git add components/ui/rename-project-dialog.tsx __tests__/rename-project-dialog.test.tsx
git commit -m "feat: add RenameProjectDialog component"
```

---

### Task 3: ProjectCard — add rename support

**Files:**
- Modify: `components/home/project-card.tsx`
- Modify: `__tests__/project-card.test.tsx`

- [ ] **Step 1: Add rename tests to `__tests__/project-card.test.tsx`**

Add these cases to the existing `describe("ProjectCard", ...)` block. Also update PC-03 and add the `onRename` prop to all existing `render` calls.

First, add `onRename` to the existing renders — find every `render(<ProjectCard project={project} onDelete={onDelete} />)` and add `onRename={jest.fn()}`:

```tsx
// At top of describe block, add:
const onRename = jest.fn();

// In beforeEach, add:
onRename.mockClear();

// Every existing render call becomes:
render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
```

Then add these new test cases at the end of the describe block:

```tsx
  // PC-04b: dropdown shows rename option
  it("PC-04b: clicking dropdown shows '重命名' menu item", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    expect(screen.getByText("重命名")).toBeInTheDocument();
  });

  // PC-08: clicking '重命名' opens RenameProjectDialog
  it("PC-08: clicking '重命名' opens rename dialog", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("重命名"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("My App");
  });

  // PC-09: cancel in rename dialog closes it without calling onRename
  it("PC-09: cancel in rename dialog closes it without calling onRename", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  // PC-10: confirm in rename dialog calls onRename with project id and new name
  it("PC-10: confirm in rename dialog calls onRename with id and new name", () => {
    render(<ProjectCard project={project} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed App" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRename).toHaveBeenCalledWith("proj-1", "Renamed App");
  });
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
npm test -- --testPathPatterns="project-card"
```

Expected: FAIL — type error on missing `onRename` prop and new test cases fail

- [ ] **Step 3: Implement changes to `components/home/project-card.tsx`**

Replace the entire file:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";
import { RenameProjectDialog } from "@/components/ui/rename-project-dialog";

export interface ProjectCardData {
  id: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  _count: { versions: number; messages: number };
  messages: { content: string; role: string }[];
}

interface ProjectCardProps {
  readonly project: ProjectCardData;
  readonly onDelete: (id: string) => void;
  readonly isDeleting?: boolean;
  readonly onRename: (id: string, newName: string) => void;
  readonly isRenaming?: boolean;
}

export function ProjectCard({
  project,
  onDelete,
  isDeleting = false,
  onRename,
  isRenaming = false,
}: ProjectCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirm(true);
  }

  function handleRenameClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowRename(true);
  }

  function handleConfirmDelete() {
    onDelete(project.id);
    setShowConfirm(false);
  }

  function handleConfirmRename(newName: string) {
    onRename(project.id, newName);
    setShowRename(false);
  }

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
                className="cursor-pointer"
                onClick={handleRenameClick}
              >
                <Pencil className="w-4 h-4 mr-2" />
                重命名
              </DropdownMenuItem>
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
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowConfirm(false)}
          isLoading={isDeleting}
        />
      )}

      {showRename && (
        <RenameProjectDialog
          projectName={project.name}
          onConfirm={handleConfirmRename}
          onCancel={() => setShowRename(false)}
          isLoading={isRenaming}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="project-card"
```

Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add components/home/project-card.tsx __tests__/project-card.test.tsx
git commit -m "feat: add rename option to ProjectCard dropdown"
```

---

### Task 4: ProjectList — wire handleRename

**Files:**
- Modify: `components/home/project-list.tsx`

- [ ] **Step 1: Add `renamingId` state and `handleRename` function**

In `components/home/project-list.tsx`, add after the `deletingId` state declaration:

```tsx
const [renamingId, setRenamingId] = useState<string | null>(null);
```

Add `handleRename` after `handleDelete`:

```tsx
async function handleRename(id: string, newName: string) {
  setRenamingId(id);
  try {
    await fetchAPI(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: newName }),
    });
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: newName } : p))
    );
    toast.success("项目已重命名");
  } catch {
    toast.error("重命名失败，请重试");
  } finally {
    setRenamingId(null);
  }
}
```

Update the `ProjectCard` render call to pass rename props:

```tsx
<ProjectCard
  key={project.id}
  project={project}
  onDelete={handleDelete}
  isDeleting={deletingId === project.id}
  onRename={handleRename}
  isRenaming={renamingId === project.id}
/>
```

- [ ] **Step 2: Run the full test suite to catch regressions**

```bash
npm test -- --testPathPatterns="project-list"
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/home/project-list.tsx
git commit -m "feat: add handleRename to ProjectList"
```

---

### Task 5: ProjectItem — replace delete button with dropdown

**Files:**
- Modify: `components/sidebar/project-item.tsx`
- Modify: `__tests__/project-item.test.tsx`

- [ ] **Step 1: Update `__tests__/project-item.test.tsx`**

The existing PI-04 through PI-07 tests reference the old direct delete button. Update them to use the new dropdown flow, and add rename tests. Also add `onRename={jest.fn()}` to all existing render calls.

Replace the full file with:

```tsx
/**
 * TDD unit tests for ProjectItem component
 *
 * PI-01: renders project name and date
 * PI-02: links to /project/:id
 * PI-03: applies active styles when isActive=true
 * PI-04: more-options dropdown trigger is present in DOM
 * PI-05: opening dropdown and clicking delete opens confirmation dialog
 * PI-06: cancel in delete dialog closes it without calling onDelete
 * PI-07: confirm in delete dialog calls onDelete with project id
 * PI-08: opening dropdown and clicking rename opens rename dialog
 * PI-09: cancel in rename dialog closes it without calling onRename
 * PI-10: confirm in rename dialog calls onRename with id and new name
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ProjectItem } from "@/components/sidebar/project-item";

const project = {
  id: "proj-1",
  name: "My Sidebar App",
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

describe("ProjectItem", () => {
  const onDelete = jest.fn();
  const onRename = jest.fn();

  beforeEach(() => {
    onDelete.mockClear();
    onRename.mockClear();
  });

  // PI-01: content
  it("PI-01a: renders project name", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    expect(screen.getByText("My Sidebar App")).toBeInTheDocument();
  });

  // PI-02: link
  it("PI-02: links to /project/:id", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/project/proj-1");
  });

  // PI-03: active styles
  it("PI-03a: active item has data-active attribute", () => {
    const { container } = render(
      <ProjectItem project={project} isActive={true} onDelete={onDelete} onRename={onRename} />
    );
    expect(container.querySelector("[data-active='true']")).toBeInTheDocument();
  });

  it("PI-03b: inactive item does not have data-active='true'", () => {
    const { container } = render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    expect(container.querySelector("[data-active='true']")).not.toBeInTheDocument();
  });

  // PI-04: more-options trigger
  it("PI-04: more-options dropdown trigger is present in DOM", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    expect(
      screen.getByRole("button", { name: "My Sidebar App 操作" })
    ).toBeInTheDocument();
  });

  // PI-05: delete flow
  it("PI-05: opening dropdown and clicking delete opens confirmation dialog", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/「My Sidebar App」/)).toBeInTheDocument();
  });

  // PI-06: cancel closes delete dialog
  it("PI-06: cancel closes delete dialog without calling onDelete", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  // PI-07: confirm calls onDelete
  it("PI-07: confirm calls onDelete with project id", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("删除项目"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("proj-1");
  });

  // PI-08: rename dialog opens
  it("PI-08: opening dropdown and clicking rename opens rename dialog", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("重命名"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("My Sidebar App");
  });

  // PI-09: cancel closes rename dialog
  it("PI-09: cancel closes rename dialog without calling onRename", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  // PI-10: confirm calls onRename
  it("PI-10: confirm calls onRename with project id and new name", () => {
    render(
      <ProjectItem project={project} isActive={false} onDelete={onDelete} onRename={onRename} />
    );
    fireEvent.click(screen.getByRole("button", { name: "My Sidebar App 操作" }));
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Renamed Sidebar App" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onRename).toHaveBeenCalledWith("proj-1", "Renamed Sidebar App");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns="project-item"
```

Expected: FAIL — missing `onRename` prop and new dropdown tests fail

- [ ] **Step 3: Implement changes to `components/sidebar/project-item.tsx`**

Replace the entire file:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteProjectDialog } from "@/components/ui/delete-project-dialog";
import { RenameProjectDialog } from "@/components/ui/rename-project-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  readonly onRename: (id: string, newName: string) => void;
  readonly isRenaming?: boolean;
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
  onRename,
  isRenaming = false,
}: ProjectItemProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);

  function handleConfirmDelete() {
    onDelete(project.id);
    setShowConfirm(false);
  }

  function handleConfirmRename(newName: string) {
    onRename(project.id, newName);
    setShowRename(false);
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
          {isActive && (
            <span className="hidden lg:block absolute left-0 top-1 bottom-1 w-[3px] bg-[#4f46e5] rounded-r-sm" />
          )}

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

        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label={`${project.name} 操作`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRename(true); }}
              >
                <Pencil className="w-4 h-4 mr-2" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowConfirm(true); }}
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
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowConfirm(false)}
          isLoading={isDeleting}
        />
      )}

      {showRename && (
        <RenameProjectDialog
          projectName={project.name}
          onConfirm={handleConfirmRename}
          onCancel={() => setShowRename(false)}
          isLoading={isRenaming}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns="project-item"
```

Expected: PASS — all 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/sidebar/project-item.tsx __tests__/project-item.test.tsx
git commit -m "feat: replace ProjectItem delete button with options dropdown (rename + delete)"
```

---

### Task 6: ConversationSidebar — wire handleRename

**Files:**
- Modify: `components/sidebar/conversation-sidebar.tsx`

- [ ] **Step 1: Add `renamingId` state and `handleRename` function**

In `components/sidebar/conversation-sidebar.tsx`, add after the `deletingId` state:

```tsx
const [renamingId, setRenamingId] = useState<string | null>(null);
```

Add `handleRename` after `handleDelete`:

```tsx
async function handleRename(id: string, newName: string) {
  setRenamingId(id);
  try {
    await fetchAPI(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: newName }),
    });
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: newName } : p))
    );
    toast.success("项目已重命名");
  } catch {
    toast.error("重命名失败，请重试");
  } finally {
    setRenamingId(null);
  }
}
```

Update the `ProjectItem` render call:

```tsx
<ProjectItem
  key={project.id}
  project={project}
  isActive={project.id === currentProjectId}
  onDelete={handleDelete}
  isDeleting={deletingId === project.id}
  onRename={handleRename}
  isRenaming={renamingId === project.id}
/>
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: PASS — all tests pass, no regressions

- [ ] **Step 3: Commit**

```bash
git add components/sidebar/conversation-sidebar.tsx
git commit -m "feat: add handleRename to ConversationSidebar"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full test suite one more time**

```bash
npm test
```

Expected: PASS — all tests pass

- [ ] **Step 2: Run the build**

```bash
npm run build
```

Expected: PASS — no TypeScript errors

- [ ] **Step 3: Manual smoke test**

Start dev server: `npm run dev`

Home page:
1. Hover a project card → click `⋯` → click "重命名"
2. Dialog opens with current name pre-filled
3. Clear + type new name → press Enter (or click 保存)
4. Dialog closes, card shows new name, toast "项目已重命名" appears

Workspace page (sidebar):
1. Hover a project in the left sidebar → click `⋯` → click "重命名"
2. Dialog opens with current name pre-filled
3. Type new name → click 保存
4. Sidebar item updates to new name, toast appears

Edge cases:
- Click 保存 without changing the name → button stays disabled
- Click 取消 → dialog closes, name unchanged
- Click delete from the new dropdown → DeleteProjectDialog opens as before
