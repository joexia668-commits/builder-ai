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
