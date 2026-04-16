import { extractStructuredExports } from "@/lib/extract-exports";

describe("extractStructuredExports", () => {
  it("EE-01: extracts named function export", () => {
    const files = {
      "/auth/index.js": 'export function login(email, pwd) { return null; }',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "login",
      kind: "function",
      filePath: "/auth/index.js",
    });
  });

  it("EE-02: extracts default function export", () => {
    const files = {
      "/App.js": 'export default function App() { return <div/>; }',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "App",
      kind: "default",
      filePath: "/App.js",
    });
  });

  it("EE-03: extracts const export", () => {
    const files = {
      "/config.js": 'export const API_URL = "https://api.example.com";',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "API_URL",
      kind: "const",
      filePath: "/config.js",
    });
  });

  it("EE-04: extracts interface export", () => {
    const files = {
      "/types.ts": 'export interface User {\n  id: string;\n  name: string;\n}',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "User",
      kind: "interface",
      filePath: "/types.ts",
    });
  });

  it("EE-05: extracts type export", () => {
    const files = {
      "/types.ts": 'export type UserRole = "admin" | "member";',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "UserRole",
      kind: "type",
      filePath: "/types.ts",
    });
  });

  it("EE-06: extracts class export", () => {
    const files = {
      "/service.ts": 'export class AuthService {\n  login() {}\n}',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "AuthService",
      kind: "class",
      filePath: "/service.ts",
    });
  });

  it("EE-07: extracts from multiple files", () => {
    const files = {
      "/a.js": 'export function foo() {}',
      "/b.js": 'export const bar = 1;',
    };
    const result = extractStructuredExports(files);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name).sort()).toEqual(["bar", "foo"]);
  });

  it("EE-08: returns empty array for no exports", () => {
    const files = { "/util.js": 'function internal() {}' };
    const result = extractStructuredExports(files);
    expect(result).toEqual([]);
  });

  it("EE-09: extracts async function export", () => {
    const files = {
      "/api.js": 'export async function fetchData() { return []; }',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "fetchData",
      kind: "function",
      filePath: "/api.js",
    });
  });

  it("EE-10: extracts arrow const export", () => {
    const files = {
      "/hooks.js": 'export const useAuth = () => { return {}; };',
    };
    const result = extractStructuredExports(files);
    expect(result).toContainEqual({
      name: "useAuth",
      kind: "const",
      filePath: "/hooks.js",
    });
  });
});
