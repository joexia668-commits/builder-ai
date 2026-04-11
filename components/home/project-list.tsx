"use client";

import { useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabFilter>("all");
  const mounted = useMounted();

  const visibleProjects =
    tab === "recent" && mounted
      ? (() => {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          return projects.filter((p) => new Date(p.updatedAt) >= sevenDaysAgo);
        })()
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
          data-testid="btn-new-project"
          className="h-[34px] px-[14px] rounded-lg transition-all duration-150 hover:shadow-[0_2px_8px_rgba(79,70,229,0.25)]"
        >
          + 新建项目
        </Button>
      </div>

      {/* Tab filter — always visible */}
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleProjects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onDelete={handleDelete}
            isDeleting={deletingId === project.id}
            onRename={handleRename}
            isRenaming={renamingId === project.id}
          />
        ))}
        {/* Dashed new-project card — always visible */}
        <button
          onClick={() => setOpen(true)}
          data-testid="btn-new-project-card"
          className="border-[1.5px] border-dashed border-[#d1d5db] rounded-xl min-h-[108px] flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 hover:border-[#a5b4fc] hover:bg-[#f5f3ff]"
        >
          <div className="w-7 h-7 rounded-[8px] bg-[#eef2ff] flex items-center justify-center text-[#4f46e5] text-base font-medium">
            +
          </div>
          <span className="text-[13px] font-medium text-[#6b7280]">新建项目</span>
        </button>
      </div>

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
