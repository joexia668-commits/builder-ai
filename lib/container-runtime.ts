"use client";

import type { FileSystemTree } from "@webcontainer/api";

// Re-export FileSystemTree for consumers
export type { FileSystemTree };

/** Cached WebContainer instance */
let containerInstance: import("@webcontainer/api").WebContainer | null = null;
/** In-flight boot promise to prevent concurrent boots */
let bootPromise: Promise<import("@webcontainer/api").WebContainer> | null = null;

/**
 * Boots WebContainer once, caches the instance.
 * Concurrent calls await the same boot promise.
 */
export async function getContainer(): Promise<
  import("@webcontainer/api").WebContainer
> {
  if (containerInstance) return containerInstance;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const { WebContainer } = await import("@webcontainer/api");
    containerInstance = await WebContainer.boot();
    return containerInstance;
  })();

  try {
    containerInstance = await bootPromise;
    return containerInstance;
  } finally {
    bootPromise = null;
  }
}

/**
 * Tears down the container instance and resets the cache.
 */
export async function teardownContainer(): Promise<void> {
  if (containerInstance) {
    containerInstance.teardown();
    containerInstance = null;
  }
  bootPromise = null;
}

/**
 * Converts a flat file map to WebContainer's nested FileSystemTree format.
 * Paths start with `/`, which is stripped before building the tree.
 */
export function filesToWebContainerTree(
  files: Record<string, string>
): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const [rawPath, contents] of Object.entries(files)) {
    // Strip leading slash
    const path = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
    const parts = path.split("/");

    let current = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!current[dir]) {
        current[dir] = { directory: {} };
      }
      current = (current[dir] as { directory: FileSystemTree }).directory;
    }

    const fileName = parts[parts.length - 1];
    current[fileName] = { file: { contents } };
  }

  return tree;
}

/**
 * Returns a package.json JSON string with base React deps merged with
 * scaffoldDependencies.
 */
export function createPackageJson(
  scaffoldDependencies: Record<string, string>
): string {
  const pkg = {
    name: "generated-app",
    version: "0.0.1",
    private: true,
    scripts: {
      dev: "vite",
      build: "vite build",
    },
    dependencies: {
      react: "^18.2.0",
      "react-dom": "^18.2.0",
      "lucide-react": "^0.300.0",
      ...scaffoldDependencies,
    },
    devDependencies: {
      "@vitejs/plugin-react": "^4.2.0",
      vite: "^5.0.0",
    },
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * Returns a Vite config with React plugin and dev server on port 3111.
 */
export function createViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3111,
  },
});
`;
}

/**
 * Returns a basic index.html with Tailwind CDN and module entry point.
 */
export function createIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated App</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"><\/script>
  </body>
</html>
`;
}

/**
 * Returns a React 18 createRoot entry that imports App from the given entry file.
 */
export function createMainJsx(entryFile: string): string {
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '${entryFile}';

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(React.StrictMode, null, React.createElement(App)));
`;
}

/**
 * Renames .js files to .jsx and rewrites import paths to match.
 * Vite's import-analysis plugin cannot parse JSX in .js files, so this
 * ensures all JSX-containing files have the correct extension.
 */
function renameJsToJsx(
  files: Record<string, string>
): Record<string, string> {
  // Build a set of .js paths that will be renamed
  const jsFiles = new Set(
    Object.keys(files).filter((p) => p.endsWith(".js"))
  );
  if (jsFiles.size === 0) return files;

  const result: Record<string, string> = {};
  for (const [path, contents] of Object.entries(files)) {
    const newPath = path.endsWith(".js")
      ? path.replace(/\.js$/, ".jsx")
      : path;

    // Rewrite import/export paths: from './Foo.js' → from './Foo.jsx'
    const newContents = contents.replace(
      /(from\s+['"])(\.[^'"]+)\.js(['"])/g,
      (_match, prefix, modPath, suffix) => {
        // Only rewrite if the target .js file exists in our file set
        const originalImport = `${modPath}.js`;
        // Resolve relative to current file's directory
        const dir = path.substring(0, path.lastIndexOf("/"));
        const resolved = originalImport.startsWith("./") || originalImport.startsWith("../")
          ? `${dir}/${originalImport}`.replace(/\/\.\//g, "/")
          : originalImport;
        // Normalize: simple check if the resolved path (or something close) is a .js file
        if (jsFiles.has(resolved) || jsFiles.has(originalImport)) {
          return `${prefix}${modPath}.jsx${suffix}`;
        }
        return `${prefix}${modPath}.js${suffix}`;
      }
    );

    result[newPath] = newContents;
  }
  return result;
}

/**
 * Builds full file tree, mounts to container, runs npm install and dev server.
 * Calls onServerReady(url) when the server is ready, onError on failures.
 */
export async function mountAndStart(
  files: Record<string, string>,
  dependencies: Record<string, string>,
  onServerReady: (url: string) => void,
  onError: (error: Error) => void
): Promise<void> {
  try {
    const container = await getContainer();

    // Rename .js → .jsx so Vite can parse JSX syntax
    const renamedFiles = renameJsToJsx(files);

    // Detect entry file — prefer App.jsx, App.js, App.tsx
    const entryFile = Object.keys(renamedFiles).find((p) =>
      /^\/App\.(jsx?|tsx?)$/.test(p)
    ) ?? "/App.jsx";
    const entryImport = entryFile.replace(/^\//, "./");

    // Build src/ files from app files
    const srcFiles: Record<string, string> = {};
    for (const [path, contents] of Object.entries(renamedFiles)) {
      // Mount app files under src/
      srcFiles[`/src${path}`] = contents;
    }

    // Build full file tree
    const allFiles: Record<string, string> = {
      ...srcFiles,
      "/package.json": createPackageJson(dependencies),
      "/vite.config.js": createViteConfig(),
      "/index.html": createIndexHtml(),
      "/src/main.jsx": createMainJsx(entryImport),
    };

    const tree = filesToWebContainerTree(allFiles);
    await container.mount(tree);

    // npm install
    const installProcess = await container.spawn("npm", ["install"]);
    const installExit = await installProcess.exit;
    if (installExit !== 0) {
      onError(new Error(`npm install failed with exit code ${installExit}`));
      return;
    }

    // npm run dev
    const devProcess = await container.spawn("npm", ["run", "dev"]);

    container.on("server-ready", (_port, url) => {
      onServerReady(url);
    });

    devProcess.exit.then((code) => {
      if (code !== 0) {
        onError(new Error(`Dev server exited with code ${code}`));
      }
    });
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Mounts new/changed files under src/ directory.
 * Vite HMR auto-detects the changes.
 */
export async function mountIncremental(
  files: Record<string, string>
): Promise<void> {
  const container = await getContainer();

  const renamedFiles = renameJsToJsx(files);
  const srcFiles: Record<string, string> = {};
  for (const [path, contents] of Object.entries(renamedFiles)) {
    srcFiles[`/src${path}`] = contents;
  }

  const tree = filesToWebContainerTree(srcFiles);
  await container.mount(tree);
}
