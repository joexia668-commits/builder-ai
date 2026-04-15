"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { findMissingLocalImportsWithNames } from "@/lib/extract-code";

type ContainerStatus = "booting" | "installing" | "starting" | "ready" | "error";

const STATUS_LABELS: Record<ContainerStatus, string> = {
  booting: "启动预览环境...",
  installing: "安装依赖...",
  starting: "启动开发服务器...",
  ready: "",
  error: "",
};

interface PreviewFrameProps {
  readonly files: Record<string, string>;
  readonly projectId: string;
  readonly scaffoldDependencies?: Record<string, string>;
}

/**
 * Deduplicates import declarations from the same module within each file.
 * Prevents "Identifier 'X' has already been declared" errors from LLM output.
 */
function deduplicateImports(
  files: Record<string, string>
): Record<string, string> {
  const result = { ...files };

  for (const [path, code] of Object.entries(files)) {
    const moduleMap = new Map<
      string,
      { named: Set<string>; defaultName: string | null; firstIndex: number }
    >();
    const importLines: { line: string; module: string; index: number }[] = [];

    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(
        /^import\s+(?:(?:(\w+)\s*,?\s*)?\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/
      );
      if (!m) continue;

      const defaultImport = m[1] || m[3] || null;
      const namedRaw = m[2] || "";
      const mod = m[4];

      const namedTokens = namedRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (!moduleMap.has(mod)) {
        moduleMap.set(mod, { named: new Set(), defaultName: null, firstIndex: i });
      }
      const entry = moduleMap.get(mod)!;
      for (const t of namedTokens) entry.named.add(t);
      if (defaultImport && !entry.defaultName) entry.defaultName = defaultImport;

      importLines.push({ line, module: mod, index: i });
    }

    const duplicatedModules = new Set<string>();
    const seenModules = new Set<string>();
    for (const { module } of importLines) {
      if (seenModules.has(module)) duplicatedModules.add(module);
      seenModules.add(module);
    }
    if (duplicatedModules.size === 0) continue;

    const linesToRemove = new Set<number>();
    for (const { module, index } of importLines) {
      if (duplicatedModules.has(module)) linesToRemove.add(index);
    }

    const newLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (linesToRemove.has(i)) {
        const found = Array.from(moduleMap.entries()).find(
          ([mod, e]) => e.firstIndex === i && duplicatedModules.has(mod)
        );
        if (found) {
          const [mod, e] = found;
          const namedPart = e.named.size > 0 ? `{ ${Array.from(e.named).join(", ")} }` : "";
          const defaultPart = e.defaultName || "";
          const importParts = [defaultPart, namedPart].filter(Boolean).join(", ");
          newLines.push(`import ${importParts} from '${mod}';`);
        }
      } else {
        newLines.push(lines[i]);
      }
    }

    result[path] = newLines.join("\n");
  }

  return result;
}

/**
 * Builds the Supabase client code injected as /supabaseClient.js.
 */
function buildSupabaseClientCode(projectId: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return `import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('${url}', '${key}', {
  global: { headers: { 'x-app-id': '${projectId}' } },
});
const _authState = { session: null };
supabase.auth = {
  signInWithPassword: async ({ email }) => {
    _authState.session = { access_token: "demo" };
    return { data: { user: { email }, session: _authState.session }, error: null };
  },
  signUp: async ({ email }) =>
    ({ data: { user: { email }, session: null }, error: null }),
  signOut: async () => {
    _authState.session = null;
    return { error: null };
  },
  getSession: async () =>
    ({ data: { session: _authState.session }, error: null }),
  onAuthStateChange: () =>
    ({ data: { subscription: { id: "mock", callback: () => {}, unsubscribe: () => {} } } }),
};`;
}

const PLACEHOLDER_APP = `export default function App() {
  return (
    <div className="flex items-center justify-center h-screen text-gray-400">
      <p>等待 AI 生成代码...</p>
    </div>
  );
}`;

/**
 * Prepares files for WebContainer preview:
 * 1. Deduplicates import statements
 * 2. Stubs missing local imports
 * 3. Injects Supabase client
 * 4. Ensures /App.js exists
 */
function prepareFiles(
  files: Record<string, string>,
  projectId: string
): Record<string, string> {
  const prepared = deduplicateImports({ ...files });

  // Ensure /App.js entry exists
  if (!prepared["/App.js"]) {
    prepared["/App.js"] = PLACEHOLDER_APP;
  }

  // Stub missing local imports so the app renders with partial functionality
  const missingImports = findMissingLocalImportsWithNames(prepared);
  for (const [missingPath, namedExports] of Array.from(missingImports.entries())) {
    const namedLines = Array.from(namedExports)
      .map((n) => `export const ${n} = () => null;`)
      .join("\n");
    const stubParts = [
      `// Auto-stub: ${missingPath} was not generated by AI`,
      namedLines,
      `export default new Proxy({}, {\n  get(_, key) {\n    console.warn(\`[Builder AI] Missing module stub: ${missingPath} — "\${String(key)}" called on missing module\`);\n    return () => null;\n  }\n});`,
    ];
    prepared[missingPath] = stubParts.filter(Boolean).join("\n");
  }

  // Inject Supabase client
  prepared["/supabaseClient.js"] = buildSupabaseClientCode(projectId);

  return prepared;
}

export function PreviewFrame({
  files,
  projectId,
  scaffoldDependencies,
}: PreviewFrameProps) {
  const [status, setStatus] = useState<ContainerStatus>("booting");
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isFirstMount = useRef(true);
  const prevFilesRef = useRef<string>("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const startContainer = useCallback(async () => {
    setStatus("booting");
    setErrorMessage(null);
    setServerUrl(null);

    try {
      const { mountAndStart, teardownContainer } = await import(
        "@/lib/container-runtime"
      );

      // Teardown any previous instance before re-booting
      await teardownContainer();

      const prepared = prepareFiles(files, projectId);
      const deps: Record<string, string> = {
        "@supabase/supabase-js": "^2.39.0",
        ...scaffoldDependencies,
      };

      setStatus("installing");

      await mountAndStart(
        prepared,
        deps,
        (url) => {
          setServerUrl(url);
          setStatus("ready");
        },
        (err) => {
          setErrorMessage(err.message);
          setStatus("error");
        }
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "WebContainer 启动失败";
      // Detect unsupported browser (SharedArrayBuffer requirement)
      if (
        message.includes("SharedArrayBuffer") ||
        message.includes("cross-origin")
      ) {
        setErrorMessage(
          "当前浏览器不支持 WebContainer（需要支持 SharedArrayBuffer 的浏览器）"
        );
      } else {
        setErrorMessage(message);
      }
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Boot on mount or projectId change
  useEffect(() => {
    startContainer();

    return () => {
      // Teardown on unmount
      import("@/lib/container-runtime").then(({ teardownContainer }) =>
        teardownContainer()
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Incremental mount on file changes when container is ready
  useEffect(() => {
    const filesKey = JSON.stringify(files);
    if (isFirstMount.current) {
      isFirstMount.current = false;
      prevFilesRef.current = filesKey;
      return;
    }
    if (filesKey === prevFilesRef.current) return;
    prevFilesRef.current = filesKey;

    if (status !== "ready") return;

    const prepared = prepareFiles(files, projectId);
    import("@/lib/container-runtime").then(({ mountIncremental }) =>
      mountIncremental(prepared).catch((err) =>
        console.warn("[PreviewFrame] incremental mount failed:", err)
      )
    );
  }, [files, status, projectId]);

  // Loading state
  if (status === "booting" || status === "installing" || status === "starting") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#f9fafb]">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-sm text-[#6b7280]">{STATUS_LABELS[status]}</p>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    const isBoot =
      errorMessage?.includes("boot") ||
      errorMessage?.includes("WebContainer") ||
      errorMessage?.includes("SharedArrayBuffer") ||
      errorMessage?.includes("cross-origin");
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#f9fafb] px-8 text-center">
        <span className="text-3xl">⚠️</span>
        <p className="text-sm font-medium text-[#374151]">
          {isBoot ? "预览环境不可用" : "预览环境启动失败"}
        </p>
        <p className="text-xs text-[#9ca3af] max-w-sm">
          {isBoot
            ? "WebContainer 需要现代浏览器支持（Chrome 90+, Firefox 90+），且页面需通过 HTTPS 或 localhost 访问"
            : errorMessage}
        </p>
        {!isBoot && (
          <button
            onClick={startContainer}
            className="px-3 py-1.5 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors"
          >
            重试
          </button>
        )}
      </div>
    );
  }

  // Ready — show iframe
  return (
    <div className="absolute inset-0">
      {serverUrl && (
        <iframe
          ref={iframeRef}
          src={serverUrl}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          title="Preview"
        />
      )}
    </div>
  );
}
