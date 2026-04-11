import { createEngineerStreamTap } from "@/lib/engineer-stream-tap";

describe("engineer-stream-tap", () => {
  describe("single file", () => {
    it("emits file_start then file_chunk then file_end for a complete input", () => {
      const tap = createEngineerStreamTap();
      const events = tap.feed("// === FILE: /App.js ===\nconsole.log(1);\n");
      const final = tap.finalize();
      const all = [...events, ...final];

      expect(all[0]).toEqual({ type: "file_start", path: "/App.js" });
      expect(all.filter((e) => e.type === "file_chunk").map((e) => e.delta).join("")).toBe(
        "console.log(1);\n"
      );
      expect(all[all.length - 1]).toEqual({ type: "file_end", path: "/App.js" });
    });

    it("holds short tail buffer until completion via finalize", () => {
      const tap = createEngineerStreamTap();
      const events = tap.feed("// === FILE: /a.js ===\nshort");
      // "short" (5 chars) is under SAFE_TAIL (256), so no file_chunk emitted yet
      expect(events.filter((e) => e.type === "file_chunk")).toHaveLength(0);
      const final = tap.finalize();
      const chunks = final.filter((e) => e.type === "file_chunk");
      expect(chunks.map((e) => e.delta).join("")).toBe("short");
    });
  });

  describe("multi-file", () => {
    it("splits two sequential files correctly", () => {
      const tap = createEngineerStreamTap();
      const input =
        "// === FILE: /a.js ===\n" +
        "A".repeat(300) + "\n" +
        "// === FILE: /b.js ===\n" +
        "B".repeat(300) + "\n";
      const events = [...tap.feed(input), ...tap.finalize()];

      const starts = events.filter((e) => e.type === "file_start");
      const ends = events.filter((e) => e.type === "file_end");
      expect(starts.map((e) => e.path)).toEqual(["/a.js", "/b.js"]);
      expect(ends.map((e) => e.path)).toEqual(["/a.js", "/b.js"]);

      const aContent = events
        .filter((e) => e.type === "file_chunk" && e.path === "/a.js")
        .map((e) => e.delta)
        .join("");
      const bContent = events
        .filter((e) => e.type === "file_chunk" && e.path === "/b.js")
        .map((e) => e.delta)
        .join("");
      expect(aContent).toBe("A".repeat(300) + "\n");
      expect(bContent).toBe("B".repeat(300) + "\n");
    });
  });

  describe("boundary splits", () => {
    it("does not mis-emit header when cut across delta boundaries", () => {
      const tap = createEngineerStreamTap();
      const part1 = tap.feed("// === FI");
      const part2 = tap.feed("LE: /a.js ===\n" + "x".repeat(300));
      const all = [...part1, ...part2];

      const chunkDeltas = all
        .filter((e) => e.type === "file_chunk")
        .map((e) => e.delta ?? "");
      for (const d of chunkDeltas) {
        expect(d).not.toContain("// === FI");
        expect(d).not.toContain("FILE:");
      }

      const starts = all.filter((e) => e.type === "file_start");
      expect(starts).toHaveLength(1);
      expect(starts[0].path).toBe("/a.js");
    });

    it("preserves exact byte sequence over 1000 one-char feeds", () => {
      const tap = createEngineerStreamTap();
      const input = "// === FILE: /a.js ===\n" + "0123456789".repeat(100);
      const events: Array<{ type: string; path?: string; delta?: string }> = [];
      for (const ch of input) {
        events.push(...tap.feed(ch));
      }
      events.push(...tap.finalize());
      const reassembled = events
        .filter((e) => e.type === "file_chunk")
        .map((e) => e.delta)
        .join("");
      expect(reassembled).toBe("0123456789".repeat(100));
    });
  });

  describe("non-standard input", () => {
    it("emits nothing when input has no FILE marker", () => {
      const tap = createEngineerStreamTap();
      const events = tap.feed("just some text without a marker\n".repeat(20));
      const final = tap.finalize();
      expect([...events, ...final]).toEqual([]);
    });

    it("self-heals when content contains a fake marker then a real one", () => {
      const tap = createEngineerStreamTap();
      const input =
        "// === FILE: /real.js ===\n" +
        "const s = '// === FILE: /fake.js ===';\n" +
        "// === FILE: /next.js ===\n" +
        "const n = 1;\n";
      const events = [...tap.feed(input), ...tap.finalize()];
      const starts = events.filter((e) => e.type === "file_start").map((e) => e.path);
      // Best-effort detector WILL see the fake marker mid-content and split there;
      // the authoritative files_complete event heals this client-side. This test
      // documents the behavior — not the "ideal" behavior.
      expect(starts).toEqual(["/real.js", "/fake.js", "/next.js"]);
    });
  });

  describe("reset", () => {
    it("clears internal state and currentPath", () => {
      const tap = createEngineerStreamTap();
      tap.feed("// === FILE: /a.js ===\nabc");
      tap.reset();
      const events = [...tap.feed("// === FILE: /b.js ===\nxyz"), ...tap.finalize()];
      const starts = events.filter((e) => e.type === "file_start").map((e) => e.path);
      expect(starts).toEqual(["/b.js"]);
      // /a.js should NOT appear
      expect(starts).not.toContain("/a.js");
    });
  });
});
