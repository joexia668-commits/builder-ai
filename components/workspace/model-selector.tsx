"use client";

import { MODEL_REGISTRY } from "@/lib/model-registry";

const BADGE_LABELS: Record<string, string> = {
  Fast: "⚡",
  Best: "★",
  Balanced: "◆",
};

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  /** IDs of models that have their API key configured */
  availableModelIds: string[];
  disabled?: boolean;
}

export function ModelSelector({
  value,
  onChange,
  availableModelIds,
  disabled = false,
}: ModelSelectorProps) {
  const current = MODEL_REGISTRY.find((m) => m.id === value);

  return (
    <div className="flex items-center gap-1.5">
      <select
        data-testid="model-selector-trigger"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed outline-none cursor-pointer"
        aria-label="选择 AI 模型"
      >
        {MODEL_REGISTRY.map((model) => {
          const available = availableModelIds.includes(model.id);
          return (
            <option
              key={model.id}
              value={model.id}
              disabled={!available}
              data-testid={`model-option-${model.id}`}
              data-disabled={!available}
            >
              {available ? "" : "🔒 "}
              {model.name}
              {model.badge ? ` ${BADGE_LABELS[model.badge] ?? ""}` : ""}
              {!available ? " (未配置)" : ""}
            </option>
          );
        })}
      </select>
      {current?.badge && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium select-none ${
            current.badge === "Fast"
              ? "bg-green-100 text-green-700"
              : current.badge === "Best"
                ? "bg-purple-100 text-purple-700"
                : "bg-gray-100 text-gray-600"
          }`}
        >
          {current.badge}
        </span>
      )}
    </div>
  );
}
