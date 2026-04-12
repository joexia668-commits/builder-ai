"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { buildFileTree } from "@/lib/file-tree";
import type { TreeNode } from "@/lib/file-tree";
import { useAutoScrollToBottom } from "@/hooks/use-auto-scroll-to-bottom";
import { WalkingCat } from "@/components/preview/walking-cat";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

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
  liveStreams?: Record<string, LiveFileStream>;
  engineerProgress?: EngineerProgress | null;
  isGenerating?: boolean;
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
  liveStreams: Record<string, LiveFileStream>;
  onFileClick: (path: string) => void;
  onDirClick: (path: string) => void;
  depth?: number;
}

function StatusIndicator({ stream }: { stream: LiveFileStream }) {
  if (stream.status === "streaming") {
    return (
      <span
        data-testid={`status-indicator-${stream.path}`}
        className="ml-auto shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse"
      />
    );
  }
  if (stream.status === "done") {
    return (
      <span
        data-testid={`status-indicator-${stream.path}`}
        className="ml-auto shrink-0 text-[10px] text-gray-400"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      data-testid={`status-indicator-${stream.path}`}
      className="ml-auto shrink-0 text-[10px] text-red-400"
    >
      ✗
    </span>
  );
}

function FileTree({
  nodes,
  activePath,
  collapsedDirs,
  liveStreams,
  onFileClick,
  onDirClick,
  depth = 0,
}: FileTreeProps) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          const isActive = node.path === activePath;
          const stream = liveStreams[node.path];
          return (
            <button
              key={node.path}
              data-testid={`tree-file-${node.path}`}
              onClick={() => onFileClick(node.path)}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className={`w-full text-left py-[3px] pr-2 text-xs font-mono truncate transition-colors flex items-center gap-1 ${
                isActive
                  ? "bg-[#1e1e1e] text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a2a]"
              }`}
            >
              <span className="flex-1 truncate">{node.name}</span>
              {stream !== undefined && <StatusIndicator stream={stream} />}
            </button>
          );
        }

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
                liveStreams={liveStreams}
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

function StreamingView({ content }: { content: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  useAutoScrollToBottom(preRef, [content]);

  return (
    <div className="flex-1 overflow-hidden bg-[#1e1e1e]">
      <pre
        ref={preRef}
        data-testid="streaming-pre"
        className="h-full overflow-auto p-4 text-xs font-mono text-green-300 whitespace-pre-wrap"
      >
        {content}
        <span
          data-testid="streaming-cursor"
          className="inline-block w-2 h-3 bg-green-300 animate-pulse ml-0.5"
        />
      </pre>
    </div>
  );
}

export function FileTreeCodeViewer({
  files,
  liveStreams: liveStreamsProp,
  isGenerating,
}: FileTreeCodeViewerProps) {
  const liveStreams: Record<string, LiveFileStream> = useMemo(
    () => liveStreamsProp ?? {},
    [liveStreamsProp]
  );

  const mergedPaths = useMemo(() => {
    return Array.from(new Set([...Object.keys(files), ...Object.keys(liveStreams)]));
  }, [files, liveStreams]);

  const tree = useMemo(() => buildFileTree(mergedPaths), [mergedPaths]);

  const defaultPath = useMemo(
    () => mergedPaths.find((p) => p === "/App.js") ?? mergedPaths[0] ?? "",
    [mergedPaths]
  );

  const [activePath, setActivePath] = useState(defaultPath);
  const userClickedRef = useRef(false);
  const resolvedActive = mergedPaths.includes(activePath) ? activePath : defaultPath;
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const prevStreamKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentKeys = new Set(Object.keys(liveStreams));

    // Reset user override when liveStreams is cleared (generation ended)
    if (currentKeys.size === 0 && prevStreamKeysRef.current.size > 0) {
      userClickedRef.current = false;
      prevStreamKeysRef.current = currentKeys;
      return;
    }

    // Find newly added paths
    const newPaths: string[] = [];
    currentKeys.forEach((k) => {
      if (!prevStreamKeysRef.current.has(k)) newPaths.push(k);
    });

    if (newPaths.length > 0 && !userClickedRef.current) {
      setActivePath(newPaths[newPaths.length - 1]);
    }

    prevStreamKeysRef.current = currentKeys;
  }, [liveStreams]);

  function handleFileClick(path: string) {
    userClickedRef.current = true;
    setActivePath(path);
  }

  function handleDirClick(dirPath: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }

  // Generating, no files streaming yet, AND no existing files to show —
  // only show the walking cat for new projects (feature_add keeps the current code visible).
  if (isGenerating && Object.keys(liveStreams).length === 0 && Object.keys(files).length === 0) {
    return <WalkingCat />;
  }

  if (mergedPaths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
        选择文件以查看代码
      </div>
    );
  }

  // Show the streaming <pre> whenever the active file is mid-stream.
  // Self-heal still works: when files_complete arrives the stream status flips to
  // "done", showStreamingPre becomes false, and Monaco takes over with final content.
  const activeStream = liveStreams[resolvedActive];
  const showStreamingPre =
    activeStream !== undefined &&
    activeStream.status === "streaming";

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-[200px] shrink-0 bg-[#252526] border-r border-[#1e1e1e] overflow-y-auto">
        <FileTree
          nodes={tree}
          activePath={resolvedActive}
          collapsedDirs={collapsedDirs}
          liveStreams={liveStreams}
          onFileClick={handleFileClick}
          onDirClick={handleDirClick}
        />
      </div>

      {showStreamingPre ? (
        <StreamingView content={activeStream.content} />
      ) : (
        <div className="flex-1 overflow-hidden">
          <MonacoEditor
            height="100%"
            language={inferLanguage(resolvedActive)}
            theme="vs-dark"
            value={files[resolvedActive] ?? activeStream?.content ?? ""}
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
      )}
    </div>
  );
}
