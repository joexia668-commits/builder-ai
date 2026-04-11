import { coalesceChunks } from "@/lib/coalesce-chunks";
import type { StreamTapEvent } from "@/lib/engineer-stream-tap";

describe("coalesceChunks", () => {
  it("merges consecutive file_chunk events for the same path", () => {
    const input: StreamTapEvent[] = [
      { type: "file_chunk", path: "/a.js", delta: "ab" },
      { type: "file_chunk", path: "/a.js", delta: "cd" },
      { type: "file_chunk", path: "/a.js", delta: "ef" },
    ];
    expect(coalesceChunks(input)).toEqual([
      { type: "file_chunk", path: "/a.js", delta: "abcdef" },
    ]);
  });

  it("does not merge chunks for different paths", () => {
    const input: StreamTapEvent[] = [
      { type: "file_chunk", path: "/a.js", delta: "a" },
      { type: "file_chunk", path: "/b.js", delta: "b" },
      { type: "file_chunk", path: "/a.js", delta: "a2" },
    ];
    const out = coalesceChunks(input);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: "file_chunk", path: "/a.js", delta: "a" });
  });

  it("passes file_start and file_end events through unchanged", () => {
    const input: StreamTapEvent[] = [
      { type: "file_start", path: "/a.js" },
      { type: "file_chunk", path: "/a.js", delta: "x" },
      { type: "file_chunk", path: "/a.js", delta: "y" },
      { type: "file_end", path: "/a.js" },
    ];
    expect(coalesceChunks(input)).toEqual([
      { type: "file_start", path: "/a.js" },
      { type: "file_chunk", path: "/a.js", delta: "xy" },
      { type: "file_end", path: "/a.js" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(coalesceChunks([])).toEqual([]);
  });
});
