const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function fetchAPI(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text().catch(() => response.statusText);
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response;
}

export interface SSEEventHandlers {
  onMessage?: (data: string) => void;
  onCodeComplete?: (code: string) => void;
  onAgentDone?: (agent: string) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

// Parse SSE stream and dispatch to handlers.
// Supports named events: code_complete, agent_done, error, done.
// Unnamed data lines go to onMessage.
export async function fetchSSE(
  path: string,
  options?: RequestInit,
  handlers?: SSEEventHandlers
): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        dispatchSSEData(currentEvent, data, handlers);
        currentEvent = "message";
      } else if (line === "") {
        currentEvent = "message";
      }
    }
  }

  // Flush any remaining buffered data
  if (buffer.startsWith("data: ")) {
    const data = buffer.slice(6).trim();
    dispatchSSEData(currentEvent, data, handlers);
  }
}

function randomId(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len).padEnd(len, "0");
}

export interface ReadSSEBodyOptions {
  /** Milliseconds of silence before calling onStall. Default: 30_000 */
  stallMs?: number;
  /** Called once when stall is detected. Does not abort the stream. */
  onStall?: () => void;
  /** Tag to include in log prefix (e.g. agent name or file path) */
  tag?: string;
}

/**
 * Reads a ReadableStream of SSE-formatted data, parses each `data:` line as
 * JSON, and calls onEvent with the parsed object.
 *
 * Logs structured events to console.info with a `[sse:<id>]` prefix.
 * Calls opts.onStall if no events are received for opts.stallMs ms.
 */
export async function readSSEBody<T = Record<string, unknown>>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  opts: ReadSSEBodyOptions = {}
): Promise<void> {
  const { stallMs = 30_000, onStall, tag } = opts;
  const reqId = randomId(4);
  const prefix = tag ? `[sse:${reqId}] (${tag})` : `[sse:${reqId}]`;

  console.info(`${prefix} open`);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let lastEventAt = Date.now();
  let stallFired = false;

  const stallInterval = setInterval(() => {
    if (Date.now() - lastEventAt >= stallMs && !stallFired) {
      stallFired = true;
      console.error(`${prefix} stall_detected silent=${stallMs}ms`);
      onStall?.();
    }
  }, Math.min(stallMs, 1000));

  const startedAt = Date.now();

  try {
    while (true) {
      const { done, value } = await reader.read();
      const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data) as T;
          lastEventAt = Date.now();
          stallFired = false;
          eventCount++;
          if (eventCount === 1 || eventCount % 10 === 0 || isMilestone(event)) {
            console.info(`${prefix} event #${eventCount}`, event);
          }
          onEvent(event);
        } catch {
          // malformed JSON — skip line
        }
      }

      if (done) break;
    }

    if (buffer.trim() && buffer.startsWith("data: ")) {
      try {
        const event = JSON.parse(buffer.slice(6).trim()) as T;
        onEvent(event);
      } catch { /* ignore */ }
    }

    console.info(
      `${prefix} close reason=normal duration=${Date.now() - startedAt}ms events=${eventCount}`
    );
  } catch (err) {
    const reason = err instanceof DOMException && err.name === "AbortError" ? "aborted" : "error";
    console.error(`${prefix} close reason=${reason} duration=${Date.now() - startedAt}ms`, err);
    throw err;
  } finally {
    clearInterval(stallInterval);
  }
}

function isMilestone(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const type = (event as { type?: string }).type;
  return (
    type === "code_complete" ||
    type === "files_complete" ||
    type === "error" ||
    type === "done"
  );
}

function dispatchSSEData(
  event: string,
  data: string,
  handlers?: SSEEventHandlers
): void {
  if (!handlers) return;

  if (data === "[DONE]") {
    handlers.onDone?.();
    return;
  }

  switch (event) {
    case "code_complete": {
      try {
        const parsed = JSON.parse(data) as { code: string };
        handlers.onCodeComplete?.(parsed.code);
      } catch {
        handlers.onCodeComplete?.(data);
      }
      break;
    }
    case "agent_done": {
      try {
        const parsed = JSON.parse(data) as { agent: string };
        handlers.onAgentDone?.(parsed.agent);
      } catch {
        handlers.onAgentDone?.(data);
      }
      break;
    }
    case "error":
      handlers.onError?.(data);
      break;
    case "done":
      handlers.onDone?.();
      break;
    default:
      handlers.onMessage?.(data);
  }
}
