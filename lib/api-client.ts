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
