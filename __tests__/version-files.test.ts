import { getVersionFiles } from "@/lib/version-files";

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
