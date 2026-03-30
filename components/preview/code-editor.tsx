"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useDebounce } from "@/lib/use-debounce";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-[#1e1e1e]">
      加载编辑器...
    </div>
  ),
});

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
}

export function CodeEditor({ code, onChange }: CodeEditorProps) {
  const [localValue, setLocalValue] = useState(code);
  const debouncedValue = useDebounce(localValue, 500);
  const isMounted = useRef(false);
  // Track latest local value and dirty state via refs so the unmount
  // cleanup can flush without stale closures.
  const pendingRef = useRef<{ value: string; dirty: boolean }>({ value: code, dirty: false });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sync external code changes (e.g. version restore) into local state
  useEffect(() => {
    setLocalValue(code);
    pendingRef.current = { value: code, dirty: false };
  }, [code]);

  // Propagate debounced value to parent — skip initial mount to avoid
  // calling onChange with the same value that was just passed in as a prop
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    pendingRef.current.dirty = false;
    onChange(debouncedValue);
  }, [debouncedValue, onChange]);

  // Flush pending edits immediately if the tab is switched before the
  // debounce fires — otherwise the unmount cleanup cancels the timer.
  useEffect(() => {
    return () => {
      if (pendingRef.current.dirty) {
        onChangeRef.current(pendingRef.current.value);
      }
    };
  }, []);

  return (
    <div className="flex-1 overflow-hidden">
      <MonacoEditor
        height="100%"
        language="javascript"
        theme="vs-dark"
        value={localValue}
        onChange={(value) => {
          const newValue = value ?? "";
          pendingRef.current = { value: newValue, dirty: true };
          setLocalValue(newValue);
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          wordWrap: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          formatOnPaste: true,
        }}
      />
    </div>
  );
}
