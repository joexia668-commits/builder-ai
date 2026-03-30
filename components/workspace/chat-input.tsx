"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    <div className="border-t p-3 bg-white">
      {selectedModel !== undefined && onModelChange && (
        <div className="mb-2 flex items-center gap-1 text-xs text-gray-500">
          <span>模型：</span>
          <ModelSelector
            value={selectedModel}
            onChange={onModelChange}
            availableModelIds={availableModelIds}
            disabled={isGenerating}
          />
        </div>
      )}
      <div className="flex gap-2 items-end">
        <Textarea
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
          className="resize-none text-sm"
        />
        {isGenerating && onStop ? (
          <Button
            data-testid="stop-btn"
            onClick={onStop}
            variant="outline"
            className="shrink-0 border-red-300 text-red-600 hover:bg-red-50"
          >
            停止生成
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="shrink-0"
          >
            {disabled ? "生成中..." : "发送"}
          </Button>
        )}
      </div>
    </div>
  );
}
