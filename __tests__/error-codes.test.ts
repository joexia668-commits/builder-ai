import { inferErrorCode, ERROR_DISPLAY } from "@/lib/error-codes";
import type { ErrorCode } from "@/lib/types";

describe("inferErrorCode", () => {
  it("returns rate_limited for 429 message", () => {
    expect(inferErrorCode(new Error("HTTP 429 Too Many Requests"))).toBe("rate_limited");
  });

  it("returns rate_limited for 'rate limit' message", () => {
    expect(inferErrorCode(new Error("rate limit exceeded"))).toBe("rate_limited");
  });

  it("returns context_overflow for 'context length' message", () => {
    expect(inferErrorCode(new Error("context length exceeded"))).toBe("context_overflow");
  });

  it("returns context_overflow for 'too long' message", () => {
    expect(inferErrorCode(new Error("prompt is too long"))).toBe("context_overflow");
  });

  it("returns generation_timeout for 'timeout' message", () => {
    expect(inferErrorCode(new Error("Request timed out"))).toBe("generation_timeout");
  });

  it("returns provider_unavailable for 'api key' message", () => {
    expect(inferErrorCode(new Error("Invalid api key"))).toBe("provider_unavailable");
  });

  it("returns provider_unavailable for '503' message", () => {
    expect(inferErrorCode(new Error("HTTP 503 Service Unavailable"))).toBe("provider_unavailable");
  });

  it("returns parse_failed when error has errorCode property", () => {
    const err = Object.assign(new Error("parse failed"), { errorCode: "parse_failed" as const });
    expect(inferErrorCode(err)).toBe("parse_failed");
  });

  it("returns unknown for unrecognized error", () => {
    expect(inferErrorCode(new Error("something completely different"))).toBe("unknown");
  });

  it("returns unknown for non-Error values", () => {
    expect(inferErrorCode("a string")).toBe("unknown");
    expect(inferErrorCode(null)).toBe("unknown");
    expect(inferErrorCode(42)).toBe("unknown");
  });
});

describe("ERROR_DISPLAY", () => {
  const ALL_CODES: ErrorCode[] = [
    "rate_limited",
    "context_overflow",
    "provider_unavailable",
    "generation_timeout",
    "parse_failed",
    "unknown",
  ];

  it("has an entry for every ErrorCode", () => {
    for (const code of ALL_CODES) {
      expect(ERROR_DISPLAY[code]).toBeDefined();
    }
  });

  it("every entry has icon, title, description", () => {
    for (const code of ALL_CODES) {
      const entry = ERROR_DISPLAY[code];
      expect(typeof entry.icon).toBe("string");
      expect(entry.icon.length).toBeGreaterThan(0);
      expect(typeof entry.title).toBe("string");
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("only context_overflow has an action", () => {
    expect(ERROR_DISPLAY.context_overflow.action).toBeDefined();
    expect(ERROR_DISPLAY.context_overflow.action?.type).toBe("new_project");

    const otherCodes = ALL_CODES.filter((c) => c !== "context_overflow");
    for (const code of otherCodes) {
      expect(ERROR_DISPLAY[code].action).toBeUndefined();
    }
  });
});
