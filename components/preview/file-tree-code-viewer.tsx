"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { buildFileTree } from "@/lib/file-tree";
import type { TreeNode } from "@/lib/file-tree";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
      加载编辑器...
    </div>
  ),
});

interface FileTreeCodeViewerProps {
  files: Record<string, string>;
}

function inferLanguage(path: string): string {
  const ext = path.split(".").pop() ?? "";
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    css: "css",
    json: "json",
  };
  return map[ext] ?? "plaintext";
}

interface FileTreeProps {
  nodes: TreeNode[];
  activePath: string;
  collapsedDirs: Set<string>;
  onFileClick: (path: string) => void;
  onDirClick: (path: string) => void;
  depth?: number;
}

function FileTree({
  nodes,
  activePath,
  collapsedDirs,
  onFileClick,
  onDirClick,
  depth = 0,
}: FileTreeProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          const isActive = node.path === activePath;
          return (
            <button
              key={node.path}
              data-testid={`tree-file-${node.path}`}
              onClick={() => onFileClick(node.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className={`w-full text-left py-[3px] pr-2 text-xs font-mono truncate transition-colors ${
                isActive
                  ? "bg-[#1e1e1e] text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              }`}
            >
              {node.name}
            </button>
          );
        }

        // dir node
        const isCollapsed = collapsedDirs.has(node.path);
        return (
          <div key={node.path}>
            <button
              data-testid={`tree-dir-${node.path}`}
              onClick={() => onDirClick(node.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className="w-full text-left py-[3px] pr-2 text-xs font-mono text-gray-300 hover:text-white flex items-center gap-1 truncate"
            >
              <span className="text-[10px]">{isCollapsed ? "▶" : "▼"}</span>
              {node.name}
            </button>
            {!isCollapsed && (
              <FileTree
                nodes={node.children}
                activePath={activePath}
                collapsedDirs={collapsedDirs}
                onFileClick={onFileClick}
                onDirClick={onDirClick}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export function FileTreeCodeViewer({ files }: FileTreeCodeViewerProps) {
  const paths = useMemo(() => Object.keys(files), [files]);
  const tree = useMemo(() => buildFileTree(paths), [paths]);

  // Default to App.js or first file
  const defaultPath = useMemo(
    () => paths.find((p) => p === "/App.js") ?? paths[0] ?? "",
    [paths]
  );

  const [activePath, setActivePath] = useState(defaultPath);

  // Clamp activePath to current file set — handles files prop replacement
  const resolvedActive = paths.includes(activePath) ? activePath : defaultPath;
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  function handleDirClick(dirPath: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }

  if (paths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
        选择文件以查看代码
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: File Tree */}
      <div className="w-[200px] shrink-0 bg-[#252526] border-r border-[#1e1e1e] overflow-y-auto">
        <FileTree
          nodes={tree}
          activePath={resolvedActive}
          collapsedDirs={collapsedDirs}
          onFileClick={setActivePath}
          onDirClick={handleDirClick}
        />
      </div>

      {/* Right: Read-only Monaco editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          height="100%"
          language={inferLanguage(resolvedActive)}
          theme="vs-dark"
          value={files[resolvedActive] ?? ""}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
