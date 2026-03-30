"use client";

interface ThinkingIndicatorProps {
  color?: string;
}

export function ThinkingIndicator({ color = "#6366f1" }: ThinkingIndicatorProps) {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-1 h-1 rounded-full animate-bounce"
          style={{
            backgroundColor: color,
            animationDelay: `${i * 0.15}s`,
            animationDuration: "0.8s",
          }}
        />
      ))}
    </span>
  );
}
