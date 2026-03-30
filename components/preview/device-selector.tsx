"use client";

import { cn } from "@/lib/utils";

type Device = "desktop" | "tablet" | "mobile";

const DEVICES: { value: Device; label: string; icon: string }[] = [
  { value: "desktop", label: "桌面", icon: "🖥" },
  { value: "tablet", label: "平板", icon: "📱" },
  { value: "mobile", label: "手机", icon: "📲" },
];

interface DeviceSelectorProps {
  value: Device;
  onChange: (device: Device) => void;
}

export function DeviceSelector({ value, onChange }: DeviceSelectorProps) {
  return (
    <div className="flex gap-0.5 bg-gray-100 rounded p-0.5">
      {DEVICES.map((device) => (
        <button
          key={device.value}
          onClick={() => onChange(device.value)}
          title={device.label}
          className={cn(
            "px-2 py-0.5 rounded text-xs transition-colors",
            value === device.value
              ? "bg-white shadow-sm text-gray-800"
              : "text-gray-400 hover:text-gray-600"
          )}
        >
          {device.icon}
        </button>
      ))}
    </div>
  );
}
