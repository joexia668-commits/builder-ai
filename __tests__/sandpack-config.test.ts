import { buildSandpackConfig } from "@/lib/sandpack-config";

describe("buildSandpackConfig", () => {
  it("injects a stub for a missing local import", () => {
    const files = {
      "/App.js": `import { formatDate } from '/utils/format.js'\nexport default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/utils/format.js"]).toBeDefined();
    expect(config.files["/utils/format.js"].code).toContain("console.warn");
    expect(config.files["/utils/format.js"].hidden).toBe(true);
  });

  it("does not inject a stub when all local imports are present", () => {
    const files = {
      "/App.js": `import { foo } from '/utils/helpers.js'\nexport default function App() { return null; }`,
      "/utils/helpers.js": `export const foo = () => null;`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    // /utils/helpers.js should come from userFiles, not be a stub
    expect(config.files["/utils/helpers.js"].code).toBe(`export const foo = () => null;`);
    expect(config.files["/utils/helpers.js"].hidden).toBeUndefined();
  });

  it("does not inject a stub for /supabaseClient.js", () => {
    const files = {
      "/App.js": `import { supabase } from '/supabaseClient.js'\nexport default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    // supabaseClient.js is always injected by buildSandpackConfig itself
    expect(config.files["/supabaseClient.js"].code).toContain("createClient");
  });

  it("includes named exports in stubs for missing named imports", () => {
    const files = {
      "/App.js": `import { AuthForm, LoginButton } from '/components/auth.js'\nexport default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    const stubCode = config.files["/components/auth.js"].code;
    expect(stubCode).toContain("export const AuthForm");
    expect(stubCode).toContain("export const LoginButton");
  });

  it("injects stubs for multiple missing imports", () => {
    const files = {
      "/App.js": [
        `import { formatDate } from '/utils/format.js'`,
        `import { calcTotal } from '/utils/math.js'`,
        `export default function App() { return null; }`,
      ].join("\n"),
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/utils/format.js"]).toBeDefined();
    expect(config.files["/utils/math.js"]).toBeDefined();
  });
});
