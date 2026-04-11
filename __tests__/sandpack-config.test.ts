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
    // /utils/helpers.js should come from userFiles, not be replaced by a stub
    expect(config.files["/utils/helpers.js"].code).toContain(`export const foo = () => null;`);
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

  it("injects supabase.auth mock into supabaseClient.js", () => {
    const files = {
      "/App.js": `import { supabase } from '/supabaseClient.js'\nexport default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    const clientCode = config.files["/supabaseClient.js"].code;
    expect(clientCode).toContain("supabase.auth");
    expect(clientCode).toContain("signInWithPassword");
    expect(clientCode).toContain("signOut");
    expect(clientCode).toContain("getSession");
    expect(clientCode).toContain("onAuthStateChange");
  });

  it("supabase.auth mock does not overwrite supabase data methods", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    const clientCode = config.files["/supabaseClient.js"].code;
    // Real Supabase client is still created via createClient — data methods intact
    expect(clientCode).toContain("createClient");
    // Auth mock is added after client creation, not replacing it
    const createClientIdx = clientCode.indexOf("createClient");
    const authMockIdx = clientCode.indexOf("supabase.auth");
    expect(authMockIdx).toBeGreaterThan(createClientIdx);
  });
});

describe("normalizeExports (via buildSandpackConfig)", () => {
  it("adds named re-export when file has only export default function", () => {
    const files = {
      "/App.js": `import Btn from '/Btn.jsx'\nexport default function App() { return null; }`,
      "/Btn.jsx": `export default function Btn() { return <button />; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toContain("export { default as Btn }");
  });

  it("adds default export when file has only a named export", () => {
    const files = {
      "/App.js": `import Btn from '/Btn.jsx'\nexport default function App() { return null; }`,
      "/Btn.jsx": `export function Btn() { return <button />; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toContain("export default Btn");
  });

  it("does not modify a file that already has both named and default exports", () => {
    const original = `export function Btn() { return <button />; }\nexport default Btn;`;
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/Btn.jsx": original,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toBe(original);
  });

  it("adds named re-export for identifier-style default export (export default X;)", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/Btn.jsx": `const Btn = () => null;\nexport default Btn;`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toContain("export { default as Btn }");
  });

  it("adds default using first named export when multiple named exports exist and no default", () => {
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/utils.js": `export function formatNum(n) { return n; }\nexport function clamp(n) { return n; }`,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/utils.js"].code).toContain("export default formatNum");
  });

  it("does not add named re-export for anonymous default arrow function", () => {
    const original = `export default () => null;`;
    const files = {
      "/App.js": `export default function App() { return null; }`,
      "/Btn.jsx": original,
    };
    const config = buildSandpackConfig(files, "proj-1");
    expect(config.files["/Btn.jsx"].code).toBe(original);
  });
});
