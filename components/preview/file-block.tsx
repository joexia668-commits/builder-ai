"use client";

import { useMemo, useState } from "react";
import type { LiveFileStream } from "@/lib/types";

interface FileBlockProps {
  readonly stream: LiveFileStream;
}

function inferLanguage(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "typescript";
}

export function FileBlock({ stream }: FileBlockProps) {
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Trigger highlight only when status flips to done (not during streaming)
  useMemo(() => {
    if (stream.status !== "done") {
      setHighlighted(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const hljs = (await import("highlight.js/lib/core")).default;
        const lang = inferLanguage(stream.path);
        if (lang === "typescript" || lang === "javascript") {
          const ts = (await import("highlight.js/lib/languages/typescript")).default;
          hljs.registerLanguage("typescript", ts);
          hljs.registerLanguage("javascript", ts);
        } else if (lang === "css") {
          const css = (await import("highlight.js/lib/languages/css")).default;
          hljs.registerLanguage("css", css);
        } else if (lang === "json") {
          const json = (await import("highlight.js/lib/languages/json")).default;
          hljs.registerLanguage("json", json);
        }
        const result = hljs.highlight(stream.content, { language: lang });
        if (!cancelled) setHighlighted(result.value);
      } catch {
        // fallback to plain text
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stream.status, stream.content, stream.path]);

  const statusClass =
    stream.status === "streaming"
      ? "text-green-300"
      : stream.status === "done"
        ? "text-zinc-300"
        : "text-red-300";

  return (
    <section className="mb-4">
      {stream.failedAttempts.length > 0 && (
        <details className="mb-2">
          <summary className="text-red-400 cursor-pointer text-[11px]">
            ✗ {stream.failedAttempts.length} 次失败 (点击展开)
          </summary>
          {stream.failedAttempts.map((f, i) => (
            <pre
              key={i}
              className="text-zinc-500 whitespace-pre-wrap text-[11px] mt-1"
            >
              {`── ${stream.path} (attempt ${i + 1}) ──\n${f.content}\n✗ ${f.reason}`}
            </pre>
          ))}
        </details>
      )}

      <pre className={`whitespace-pre-wrap text-[11px] ${statusClass}`}>
        {`── ${stream.path}${stream.attempt > 1 ? ` (retry ${stream.attempt}/3)` : ""} ──\n`}
        {highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          stream.content
        )}
        {stream.status === "streaming" && (
          <span className="inline-block w-2 h-3 bg-green-300 animate-pulse ml-0.5" />
        )}
        {stream.status === "done" && "\n✓ 完成"}
      </pre>
    </section>
  );
}
