"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelSelector } from "@/components/workspace/model-selector";
import { fetchAPI } from "@/lib/api-client";
import { DEFAULT_MODEL_ID, getAvailableModels } from "@/lib/model-registry";

export function Header() {
  const { data: session } = useSession();
  const [prefOpen, setPrefOpen] = useState(false);
  const [globalModel, setGlobalModel] = useState<string>(DEFAULT_MODEL_ID);
  const [saving, setSaving] = useState(false);

  const availableModelIds = getAvailableModels({
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.NEXT_PUBLIC_GEMINI_CONFIGURED ?? "",
    DEEPSEEK_API_KEY: process.env.NEXT_PUBLIC_DEEPSEEK_CONFIGURED ?? "",
    GROQ_API_KEY: process.env.NEXT_PUBLIC_GROQ_CONFIGURED ?? "",
  }).map((m) => m.id);

  // Load current preference when dialog opens
  useEffect(() => {
    if (!prefOpen || !session) return;
    fetchAPI("/api/user/preferences")
      .then((r) => r.json())
      .then((data: { preferredModel: string | null }) => {
        if (data.preferredModel) setGlobalModel(data.preferredModel);
      })
      .catch(() => {});
  }, [prefOpen, session]);

  async function handleSavePreference(modelId: string) {
    setGlobalModel(modelId);
    setSaving(true);
    try {
      await fetchAPI("/api/user/preferences", {
        method: "PATCH",
        body: JSON.stringify({ preferredModel: modelId }),
      });
      toast.success("模型偏好已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="h-12 border-b bg-white flex items-center justify-between px-4 shrink-0 z-10">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold text-gray-900">
            Builder<span className="text-indigo-600">AI</span>
          </span>
        </Link>

        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 hover:opacity-80 transition-opacity outline-none">
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700">
                  {session.user.name?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}
              <span className="text-sm text-gray-700 hidden sm:block">
                {session.user.name}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => setPrefOpen(true)}
              >
                偏好设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-red-600 cursor-pointer"
              >
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <Dialog open={prefOpen} onOpenChange={setPrefOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>AI 模型偏好</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-500">
              选择默认 AI 模型，新项目将继承此偏好。
            </p>
            <ModelSelector
              value={globalModel}
              onChange={handleSavePreference}
              availableModelIds={availableModelIds}
              disabled={saving}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
