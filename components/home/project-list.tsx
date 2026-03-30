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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">我的项目</h1>
          <p className="text-gray-500 text-sm mt-1">
            {projects.length > 0
              ? `共 ${projects.length} 个项目`
              : "还没有项目，创建第一个吧"}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ 新建项目</Button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🚀</div>
          <p className="text-lg font-medium text-gray-600">开始构建你的第一个 AI 应用</p>
          <p className="text-sm mt-1">告诉 AI 你想要什么，多个 Agent 协作为你生成</p>
          <Button onClick={() => setOpen(true)} className="mt-4">
            创建第一个项目
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={handleDelete}
              isDeleting={deletingId === project.id}
            />
          ))}
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
