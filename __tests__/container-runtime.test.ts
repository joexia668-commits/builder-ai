import {
  filesToWebContainerTree,
  createPackageJson,
  createViteConfig,
} from "@/lib/container-runtime";

describe("filesToWebContainerTree", () => {
  it("converts flat file map to nested directory tree", () => {
    const files = {
      "/App.js": "export default function App() {}",
      "/components/Header.js": "export function Header() {}",
    };
    const tree = filesToWebContainerTree(files);
    expect(tree["App.js"]).toEqual({ file: { contents: files["/App.js"] } });
    expect((tree["components"] as any).directory["Header.js"]).toEqual({
      file: { contents: files["/components/Header.js"] },
    });
  });

  it("handles deeply nested paths", () => {
    const tree = filesToWebContainerTree({ "/a/b/c/deep.js": "x" });
    expect(
      (tree["a"] as any).directory["b"].directory["c"].directory["deep.js"]
    ).toBeDefined();
  });

  it("strips leading slash from paths", () => {
    const tree = filesToWebContainerTree({ "/index.js": "content" });
    expect(tree["index.js"]).toBeDefined();
    expect(tree["/index.js"]).toBeUndefined();
  });

  it("handles multiple files in same directory", () => {
    const tree = filesToWebContainerTree({
      "/utils/a.js": "a",
      "/utils/b.js": "b",
    });
    const utils = (tree["utils"] as any).directory;
    expect(utils["a.js"]).toEqual({ file: { contents: "a" } });
    expect(utils["b.js"]).toEqual({ file: { contents: "b" } });
  });

  it("handles root-level files with no directory", () => {
    const tree = filesToWebContainerTree({ "/App.js": "app" });
    expect(tree["App.js"]).toEqual({ file: { contents: "app" } });
  });
});

describe("createPackageJson", () => {
  it("includes base React dependencies", () => {
    const parsed = JSON.parse(createPackageJson({}));
    expect(parsed.dependencies.react).toBeDefined();
    expect(parsed.dependencies["react-dom"]).toBeDefined();
  });

  it("merges scaffold dependencies", () => {
    const parsed = JSON.parse(createPackageJson({ phaser: "^3.60.0" }));
    expect(parsed.dependencies.phaser).toBe("^3.60.0");
  });

  it("includes lucide-react in base deps", () => {
    const parsed = JSON.parse(createPackageJson({}));
    expect(parsed.dependencies["lucide-react"]).toBeDefined();
  });

  it("includes vite dev dependencies", () => {
    const parsed = JSON.parse(createPackageJson({}));
    expect(parsed.devDependencies["vite"]).toBeDefined();
    expect(parsed.devDependencies["@vitejs/plugin-react"]).toBeDefined();
  });

  it("includes dev and build scripts", () => {
    const parsed = JSON.parse(createPackageJson({}));
    expect(parsed.scripts.dev).toBe("vite");
    expect(parsed.scripts.build).toBe("vite build");
  });

  it("scaffold deps override base deps when conflicting", () => {
    const parsed = JSON.parse(createPackageJson({ react: "^17.0.0" }));
    expect(parsed.dependencies.react).toBe("^17.0.0");
  });
});

describe("createViteConfig", () => {
  it("returns a non-empty string", () => {
    expect(typeof createViteConfig()).toBe("string");
    expect(createViteConfig().length).toBeGreaterThan(0);
  });

  it("includes react plugin import", () => {
    expect(createViteConfig()).toContain("@vitejs/plugin-react");
  });

  it("sets server port to 3111", () => {
    expect(createViteConfig()).toContain("3111");
  });

  it("enables server host", () => {
    expect(createViteConfig()).toContain("host: true");
  });
});
