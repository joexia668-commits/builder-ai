import { getVersionFiles, computeChangedFiles } from "@/lib/version-files";

describe("getVersionFiles", () => {
  it("returns files field when present", () => {
    const version = {
      code: "old code",
      files: { "/App.js": "new code", "/components/Header.js": "header" },
    };
    expect(getVersionFiles(version)).toEqual({
      "/App.js": "new code",
      "/components/Header.js": "header",
    });
  });

  it("wraps legacy code string as /App.js when files is null", () => {
    const version = { code: "export default function App() {}", files: null };
    expect(getVersionFiles(version)).toEqual({
      "/App.js": "export default function App() {}",
    });
  });

  it("wraps legacy code string as /App.js when files is undefined", () => {
    const version = { code: "legacy code" };
    expect(getVersionFiles(version)).toEqual({
      "/App.js": "legacy code",
    });
  });

  it("prefers files over code even if both present", () => {
    const version = {
      code: "fallback",
      files: { "/App.js": "primary", "/utils.js": "util" },
    };
    const result = getVersionFiles(version);
    expect(result["/App.js"]).toBe("primary");
    expect(result["/utils.js"]).toBe("util");
  });
});

describe("computeChangedFiles", () => {
  it("treats all files as added when prevFiles is null", () => {
    const newFiles = { "/App.js": "app code", "/utils.js": "util code" };
    const result = computeChangedFiles(null, newFiles);
    expect(result.added).toEqual(newFiles);
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });

  it("detects added files", () => {
    const prev = { "/App.js": "app" };
    const next = { "/App.js": "app", "/Header.js": "header" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({ "/Header.js": "header" });
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });

  it("detects modified files", () => {
    const prev = { "/App.js": "old code" };
    const next = { "/App.js": "new code" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({ "/App.js": "new code" });
    expect(result.removed).toEqual([]);
  });

  it("detects removed files", () => {
    const prev = { "/App.js": "app", "/Old.js": "old" };
    const next = { "/App.js": "app" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual(["/Old.js"]);
  });

  it("handles mixed add/modify/remove", () => {
    const prev = { "/App.js": "v1", "/Remove.js": "remove me" };
    const next = { "/App.js": "v2", "/New.js": "new file" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({ "/New.js": "new file" });
    expect(result.modified).toEqual({ "/App.js": "v2" });
    expect(result.removed).toEqual(["/Remove.js"]);
  });

  it("returns empty diff when files are identical", () => {
    const files = { "/App.js": "same", "/utils.js": "same" };
    const result = computeChangedFiles(files, files);
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });
});
