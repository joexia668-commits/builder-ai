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
