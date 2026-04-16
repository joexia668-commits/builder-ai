import { fixJsxWithTypeScript } from "@/lib/extract-code";

describe("fixJsxWithTypeScript", () => {
  it("renames .jsx file with export interface to .tsx", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'export interface User { id: string; }\nexport default function App() { return <div/>; }',
      "/utils.js": 'export function helper() {}',
    };
    const renamed = fixJsxWithTypeScript(files);
    expect(renamed).toHaveLength(1);
    expect(files["/App.tsx"]).toBeDefined();
    expect(files["/App.jsx"]).toBeUndefined();
    expect(files["/utils.js"]).toBeDefined();
  });

  it("renames .jsx file with export type to .tsx", () => {
    const files: Record<string, string> = {
      "/types.jsx": 'export type UserRole = "admin" | "member";\nexport function RoleTag() {}',
    };
    fixJsxWithTypeScript(files);
    expect(files["/types.tsx"]).toBeDefined();
    expect(files["/types.jsx"]).toBeUndefined();
  });

  it("does not rename .jsx without TypeScript syntax", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'export default function App() { return <div/>; }',
    };
    const renamed = fixJsxWithTypeScript(files);
    expect(renamed).toHaveLength(0);
    expect(files["/App.jsx"]).toBeDefined();
  });

  it("does not rename .js or .ts files", () => {
    const files: Record<string, string> = {
      "/types.ts": 'export interface User { id: string; }',
      "/utils.js": 'export function helper() {}',
    };
    const renamed = fixJsxWithTypeScript(files);
    expect(renamed).toHaveLength(0);
  });

  it("updates import references in other files", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'export interface User { id: string; }\nexport default function App() {}',
      "/Main.jsx": 'import App from "/App.jsx";\nexport default function Main() { return <App/>; }',
    };
    fixJsxWithTypeScript(files);
    expect(files["/Main.jsx"]).toContain("/App.tsx");
    expect(files["/Main.jsx"]).not.toContain("/App.jsx");
  });

  it("returns list of renamed files", () => {
    const files: Record<string, string> = {
      "/A.jsx": 'export interface Foo {}',
      "/B.jsx": 'export type Bar = string;',
      "/C.jsx": 'export function baz() {}',
    };
    const renamed = fixJsxWithTypeScript(files);
    expect(renamed).toHaveLength(2);
    expect(renamed.sort()).toEqual(["/A.jsx → /A.tsx", "/B.jsx → /B.tsx"]);
  });
});
