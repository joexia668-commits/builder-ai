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
import { ProjectItem, type ProjectItemData } from "@/components/sidebar/project-item";
import { fetchAPI } from "@/lib/api-client";
import { toast } from "sonner";

interface ConversationSidebarProps {
  currentProjectId: string;
  projects: ProjectItemData[];
}

export function ConversationSidebar({
  currentProjectId,
  projects: initialProjects,
}: ConversationSidebarProps) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetchAPI("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      const project = await res.json();
      setOpen(false);
      setName("");
      // Hard navigation so COOP/COEP headers are applied (required by WebContainer)
      window.location.href = `/project/${project.id}`;
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setLoading(false);
    }
  }

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

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetchAPI(`/api/projects/${id}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (id === currentProjectId) {
        router.push("/");
      }
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="w-12 lg:w-[220px] border-r bg-white flex flex-col shrink-0 overflow-hidden">
      {/* New project button */}
      <div className="p-[10px] border-b flex justify-center lg:block">
        <Button
          size="sm"
          className="w-8 lg:w-full px-0 lg:px-3"
          onClick={() => setOpen(true)}
          title="新建项目"
        >
          <span className="lg:hidden">+</span>
          <span className="hidden lg:inline">+ 新建项目</span>
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        <div className="hidden lg:block text-[10px] font-semibold text-[#9ca3af] uppercase tracking-[0.07em] px-2 pt-2 pb-1">
          最近项目
        </div>
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={project.id === currentProjectId}
            onDelete={handleDelete}
            isDeleting={deletingId === project.id}
            onRename={handleRename}
            isRenaming={renamingId === project.id}
          />
        ))}
      </nav>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="项目名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
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
    </aside>
  );
}
