import { createErrorCollector } from "@/lib/error-collector";

describe("createErrorCollector", () => {
  it("EC-01: collects a single error", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "SyntaxError: Unexpected token" });
    expect(collector.getErrors()).toHaveLength(1);
  });

  it("EC-02: deduplicates identical messages", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "SyntaxError: Unexpected token" });
    collector.collect({ source: "vite", message: "SyntaxError: Unexpected token" });
    expect(collector.getErrors()).toHaveLength(1);
  });

  it("EC-03: caps at 5 unique errors", () => {
    const collector = createErrorCollector();
    for (let i = 0; i < 10; i++) {
      collector.collect({ source: "vite", message: `Error ${i}` });
    }
    expect(collector.getErrors()).toHaveLength(5);
  });

  it("EC-04: truncates long messages to 300 chars", () => {
    const collector = createErrorCollector();
    const longMsg = "x".repeat(500);
    collector.collect({ source: "runtime", message: longMsg });
    expect(collector.getErrors()[0].message.length).toBeLessThanOrEqual(303); // 300 + "..."
  });

  it("EC-05: filters ResizeObserver noise", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "runtime", message: "ResizeObserver loop completed with undelivered notifications." });
    expect(collector.getErrors()).toHaveLength(0);
  });

  it("EC-06: filters Supabase network errors", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "runtime", message: "FetchError: request to https://xxx.supabase.co/rest/v1/ failed" });
    expect(collector.getErrors()).toHaveLength(0);
  });

  it("EC-07: reset clears all errors", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "Error 1" });
    collector.reset();
    expect(collector.getErrors()).toHaveLength(0);
  });

  it("EC-08: hasErrors returns correct boolean", () => {
    const collector = createErrorCollector();
    expect(collector.hasErrors()).toBe(false);
    collector.collect({ source: "vite", message: "Error 1" });
    expect(collector.hasErrors()).toBe(true);
  });

  it("EC-09: formats errors for LLM context", () => {
    const collector = createErrorCollector();
    collector.collect({ source: "vite", message: "SyntaxError at /App.jsx:10" });
    collector.collect({ source: "runtime", message: "TypeError: x is not a function" });
    const formatted = collector.formatForContext();
    expect(formatted).toContain("错误 1 (编译)");
    expect(formatted).toContain("错误 2 (运行时)");
  });
});
