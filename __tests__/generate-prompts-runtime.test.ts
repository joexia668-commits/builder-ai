import { buildRuntimeErrorFixPrompt } from "@/lib/generate-prompts";
import type { SandpackRuntimeError } from "@/lib/types";

describe("buildRuntimeErrorFixPrompt", () => {
  const files: Record<string, string> = {
    "/App.js": `import { useAudio } from "./hooks/useAudio";\nexport default function App() { return <div />; }`,
    "/hooks/useAudio.js": `import { useState } from "react";\nexport function useAudio() { const [v, setV] = useState(); return v.volume; }`,
    "/components/Header.js": `export function Header() { return <h1>Header</h1>; }`,
  };

  const error: SandpackRuntimeError = {
    message: "TypeError: Cannot read properties of undefined (reading 'volume')",
    path: "/hooks/useAudio.js",
    line: 2,
    column: 72,
  };

  it("includes error message in prompt", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("Cannot read properties of undefined");
  });

  it("includes error file path and location", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("/hooks/useAudio.js");
    expect(prompt).toContain("第 2 行");
  });

  it("includes the error file code", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("// === EXISTING FILE: /hooks/useAudio.js ===");
    expect(prompt).toContain("export function useAudio()");
  });

  it("includes output format instructions", () => {
    const prompt = buildRuntimeErrorFixPrompt(error, files, "proj-1");
    expect(prompt).toContain("// === FILE:");
  });

  it("limits dependency files to 5", () => {
    const manyImportFiles: Record<string, string> = {
      "/App.js": `import {A} from "/a";\nimport {B} from "/b";\nimport {C} from "/c";\nimport {D} from "/d";\nimport {E} from "/e";\nimport {F} from "/f";\nimport {G} from "/g";\nexport default function App() {}`,
      "/a.js": "export const A = 1;",
      "/b.js": "export const B = 2;",
      "/c.js": "export const C = 3;",
      "/d.js": "export const D = 4;",
      "/e.js": "export const E = 5;",
      "/f.js": "export const F = 6;",
      "/g.js": "export const G = 7;",
    };
    const err: SandpackRuntimeError = { message: "err", path: "/App.js", line: 1, column: 1 };
    const prompt = buildRuntimeErrorFixPrompt(err, manyImportFiles, "proj-1");
    const existingFileCount = (prompt.match(/\/\/ === EXISTING FILE:/g) || []).length;
    expect(existingFileCount).toBeLessThanOrEqual(6);
  });

  it("handles error file with no local imports", () => {
    const simpleFiles: Record<string, string> = {
      "/App.js": `import React from "react";\nexport default function App() { return null; }`,
    };
    const err: SandpackRuntimeError = { message: "err", path: "/App.js", line: 1, column: 1 };
    const prompt = buildRuntimeErrorFixPrompt(err, simpleFiles, "proj-1");
    const existingFileCount = (prompt.match(/\/\/ === EXISTING FILE:/g) || []).length;
    expect(existingFileCount).toBe(1);
  });
});
