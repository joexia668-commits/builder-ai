"use client";

import { useState, useCallback } from "react";
import { CodeEditor } from "@/components/preview/code-editor";

interface MultiFileEditorProps {
  files: Record<string, string>;
  onFilesChange: (files: Record<string, string>) => void;
}

function sortFilePaths(paths: string[]): string[] {
  return paths.sort((a, b) => {
    if (a === "/App.js") return -1;
    if (b === "/App.js") return 1;
    return a.localeCompare(b);
  });
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function MultiFileEditor({ files, onFilesChange }: MultiFileEditorProps) {
  const paths = sortFilePaths(Object.keys(files));
  const [activePath, setActivePath] = useState(paths[0] ?? "/App.js");

  // If the active file was removed (e.g. new generation), reset to first
  const effectivePath = paths.includes(activePath) ? activePath : paths[0] ?? "/App.js";

  const handleCodeChange = useCallback(
    (newCode: string) => {
      onFilesChange({ ...files, [effectivePath]: newCode });
    },
    [files, effectivePath, onFilesChange]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* File tab bar */}
      <div className="flex border-b bg-[#252526] overflow-x-auto shrink-0">
        {paths.map((path) => (
          <button
            key={path}
            data-testid={`file-tab-${path}`}
            onClick={() => setActivePath(path)}
            className={`px-3 py-1.5 text-xs font-mono whitespace-nowrap border-r border-[#1e1e1e] transition-colors ${
              path === effectivePath
                ? "bg-[#1e1e1e] text-white"
                : "bg-[#2d2d2d] text-gray-400 hover:text-gray-200"
            }`}
          >
            {getFileName(path)}
          </button>
        ))}
      </div>

      {/* Monaco editor for active file */}
      <CodeEditor
        code={files[effectivePath] ?? ""}
        onChange={handleCodeChange}
      />
    </div>
  );
}
