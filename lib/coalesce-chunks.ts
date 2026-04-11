import type { StreamTapEvent } from "@/lib/engineer-stream-tap";

export function coalesceChunks(events: readonly StreamTapEvent[]): StreamTapEvent[] {
  const out: StreamTapEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (
      ev.type === "file_chunk" &&
      last !== undefined &&
      last.type === "file_chunk" &&
      last.path === ev.path
    ) {
      out[out.length - 1] = {
        type: "file_chunk",
        path: last.path,
        delta: (last.delta ?? "") + (ev.delta ?? ""),
      };
    } else {
      out.push(ev);
    }
  }
  return out;
}
