import type { PmOutput } from "@/lib/types";

interface PmOutputCardProps {
  data: PmOutput;
}

const PERSISTENCE_LABELS: Record<PmOutput["persistence"], string> = {
  none: "无持久化",
  localStorage: "本地存储",
  supabase: "云端数据库",
};

const PERSISTENCE_COLORS: Record<PmOutput["persistence"], string> = {
  none: "bg-gray-100 text-gray-600",
  localStorage: "bg-blue-100 text-blue-700",
  supabase: "bg-green-100 text-green-700",
};

export function PmOutputCard({ data }: PmOutputCardProps) {
  return (
    <div className="space-y-3 text-sm" data-testid="pm-output-card">
      <p className="font-semibold text-gray-800">{data.intent}</p>

      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">核心功能</p>
        <ul className="space-y-0.5">
          {data.features.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 text-gray-700">
              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERSISTENCE_COLORS[data.persistence]}`}
        >
          {PERSISTENCE_LABELS[data.persistence]}
        </span>
        {data.modules.map((m, i) => (
          <span
            key={i}
            className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium"
          >
            {m}
          </span>
        ))}
      </div>

      {data.dataModel && data.dataModel.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">数据模型</p>
          <p className="text-gray-600 text-xs">{data.dataModel.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
