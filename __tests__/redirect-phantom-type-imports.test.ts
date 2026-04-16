import { redirectPhantomTypeImports } from "@/lib/extract-code";

describe("redirectPhantomTypeImports", () => {
  it("rewrites /utils/types to /types.ts when /types.ts exists", () => {
    const files: Record<string, string> = {
      "/types.ts": "export interface User { id: string; }",
      "/App.jsx": 'import { User } from "/utils/types";\nexport default function App() {}',
    };
    const rewrites = redirectPhantomTypeImports(files);
    expect(rewrites).toHaveLength(1);
    expect(files["/App.jsx"]).toContain('from "/types.ts"');
    expect(files["/App.jsx"]).not.toContain("/utils/types");
  });

  it("rewrites /utils/types.ts to /types.ts", () => {
    const files: Record<string, string> = {
      "/types.ts": "export interface User {}",
      "/Card.tsx": 'import { User } from "/utils/types.ts";\nexport function Card() {}',
    };
    redirectPhantomTypeImports(files);
    expect(files["/Card.tsx"]).toContain('from "/types.ts"');
  });

  it("rewrites /components/types.ts to /types.ts", () => {
    const files: Record<string, string> = {
      "/types.ts": "export type Role = 'admin';",
      "/Page.jsx": 'import { Role } from "/components/types.ts";\nexport default function Page() {}',
    };
    redirectPhantomTypeImports(files);
    expect(files["/Page.jsx"]).toContain('from "/types.ts"');
  });

  it("does NOT rewrite if the target file actually exists", () => {
    const files: Record<string, string> = {
      "/types.ts": "export interface User {}",
      "/utils/types.ts": "export interface UtilType {}",
      "/App.jsx": 'import { UtilType } from "/utils/types.ts";\nexport default function App() {}',
    };
    const rewrites = redirectPhantomTypeImports(files);
    expect(rewrites).toHaveLength(0);
    expect(files["/App.jsx"]).toContain("/utils/types.ts");
  });

  it("does NOT rewrite if /types.ts does not exist", () => {
    const files: Record<string, string> = {
      "/App.jsx": 'import { User } from "/utils/types";\nexport default function App() {}',
    };
    const rewrites = redirectPhantomTypeImports(files);
    expect(rewrites).toHaveLength(0);
    expect(files["/App.jsx"]).toContain("/utils/types");
  });

  it("handles multiple phantom imports in one file", () => {
    const files: Record<string, string> = {
      "/types.ts": "export interface User {}\nexport type Role = 'admin';",
      "/App.jsx": [
        'import { User } from "/utils/types";',
        'import { Role } from "/components/types.ts";',
        "export default function App() {}",
      ].join("\n"),
    };
    const rewrites = redirectPhantomTypeImports(files);
    expect(rewrites).toHaveLength(2);
    expect(files["/App.jsx"]).not.toContain("/utils/types");
    expect(files["/App.jsx"]).not.toContain("/components/types");
  });

  it("rewrites /lib/types and /shared/types variants", () => {
    const files: Record<string, string> = {
      "/types.ts": "export interface Data {}",
      "/A.jsx": 'import { Data } from "/lib/types";\nexport function A() {}',
      "/B.jsx": 'import { Data } from "/shared/types.ts";\nexport function B() {}',
    };
    redirectPhantomTypeImports(files);
    expect(files["/A.jsx"]).toContain('from "/types.ts"');
    expect(files["/B.jsx"]).toContain('from "/types.ts"');
  });
});
