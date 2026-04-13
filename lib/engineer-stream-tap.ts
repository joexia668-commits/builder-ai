export interface StreamTapEvent {
  readonly type: "file_start" | "file_chunk" | "file_end";
  readonly path?: string;
  readonly delta?: string;
}

export interface EngineerStreamTap {
  feed(delta: string): StreamTapEvent[];
  finalize(): StreamTapEvent[];
  reset(): void;
}

const FILE_HEADER_RE = /\/\/ === FILE: (\/[^\s=]+)[^\n]*(\n)?/;
const SAFE_TAIL = 256;

export function createEngineerStreamTap(): EngineerStreamTap {
  let buffer = "";
  let currentPath: string | null = null;

  return {
    feed(delta: string): StreamTapEvent[] {
      buffer += delta;
      const events: StreamTapEvent[] = [];

      while (true) {
        const match = FILE_HEADER_RE.exec(buffer);
        if (!match) {
          if (currentPath && buffer.length > SAFE_TAIL) {
            const safe = buffer.slice(0, buffer.length - SAFE_TAIL);
            events.push({ type: "file_chunk", path: currentPath, delta: safe });
            buffer = buffer.slice(-SAFE_TAIL);
          }
          break;
        }
        // If newline not yet received and match ends at buffer boundary, defer consumption
        // until we confirm the header is complete (avoids consuming a partial match)
        if (!match[2] && match.index + match[0].length === buffer.length) {
          break;
        }
        if (currentPath && match.index > 0) {
          events.push({
            type: "file_chunk",
            path: currentPath,
            delta: buffer.slice(0, match.index),
          });
        }
        if (currentPath) {
          events.push({ type: "file_end", path: currentPath });
        }
        currentPath = match[1];
        events.push({ type: "file_start", path: currentPath });
        buffer = buffer.slice(match.index + match[0].length);
      }
      return events;
    },

    finalize(): StreamTapEvent[] {
      const events: StreamTapEvent[] = [];
      if (currentPath && buffer.length > 0) {
        events.push({ type: "file_chunk", path: currentPath, delta: buffer });
      }
      if (currentPath) {
        events.push({ type: "file_end", path: currentPath });
      }
      buffer = "";
      currentPath = null;
      return events;
    },

    reset(): void {
      buffer = "";
      currentPath = null;
    },
  };
}
