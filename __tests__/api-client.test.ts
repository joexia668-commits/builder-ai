/**
 * TDD tests for fetchSSE() — SSE event parsing and dispatch
 *
 * RED: These tests define the expected behavior before implementation.
 */

// Polyfill Web APIs not available in Node 18 test environment
// Node 18 has these in node:stream/web but they need to be wired to global
const { ReadableStream: WebReadableStream, Response: WebResponse } =
  require("node:stream/web") as {
    ReadableStream: typeof ReadableStream;
    Response: typeof Response;
  };
if (typeof (global as Record<string, unknown>).ReadableStream === "undefined") {
  (global as Record<string, unknown>).ReadableStream = WebReadableStream;
}
if (typeof (global as Record<string, unknown>).Response === "undefined") {
  (global as Record<string, unknown>).Response = WebResponse;
}

import { fetchSSE } from "@/lib/api-client";

// Helper: build a ReadableStream from a raw SSE string
function makeSSEStream(raw: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  });
}

// Helper: build a mock Response with a streaming body
function mockResponse(raw: string, status = 200): Response {
  return new Response(makeSSEStream(raw), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("fetchSSE — SSEEventHandlers dispatch", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("calls onMessage for plain data lines (no event: field)", async () => {
    const onMessage = jest.fn();
    global.fetch = jest.fn().mockResolvedValue(mockResponse("data: hello world\n\n"));

    await fetchSSE("/api/generate", {}, { onMessage });

    expect(onMessage).toHaveBeenCalledWith("hello world");
  });

  it("calls onCodeComplete with code when event: code_complete", async () => {
    const onCodeComplete = jest.fn();
    const payload = JSON.stringify({ code: "<div>Hello</div>" });
    const raw = `event: code_complete\ndata: ${payload}\n\n`;
    global.fetch = jest.fn().mockResolvedValue(mockResponse(raw));

    await fetchSSE("/api/generate", {}, { onCodeComplete });

    expect(onCodeComplete).toHaveBeenCalledWith("<div>Hello</div>");
  });

  it("calls onAgentDone with agent name when event: agent_done", async () => {
    const onAgentDone = jest.fn();
    const payload = JSON.stringify({ agent: "engineer" });
    const raw = `event: agent_done\ndata: ${payload}\n\n`;
    global.fetch = jest.fn().mockResolvedValue(mockResponse(raw));

    await fetchSSE("/api/generate", {}, { onAgentDone });

    expect(onAgentDone).toHaveBeenCalledWith("engineer");
  });

  it("calls onError when event: error", async () => {
    const onError = jest.fn();
    const raw = `event: error\ndata: something went wrong\n\n`;
    global.fetch = jest.fn().mockResolvedValue(mockResponse(raw));

    await fetchSSE("/api/generate", {}, { onError });

    expect(onError).toHaveBeenCalledWith("something went wrong");
  });

  it("calls onDone when event: done", async () => {
    const onDone = jest.fn();
    const raw = `event: done\ndata: complete\n\n`;
    global.fetch = jest.fn().mockResolvedValue(mockResponse(raw));

    await fetchSSE("/api/generate", {}, { onDone });

    expect(onDone).toHaveBeenCalled();
  });

  it("calls onDone when data: [DONE] is received", async () => {
    const onDone = jest.fn();
    const raw = `data: [DONE]\n\n`;
    global.fetch = jest.fn().mockResolvedValue(mockResponse(raw));

    await fetchSSE("/api/generate", {}, { onDone });

    expect(onDone).toHaveBeenCalled();
  });

  it("handles multiple events in a single stream", async () => {
    const onMessage = jest.fn();
    const onCodeComplete = jest.fn();
    const onDone = jest.fn();
    const raw = [
      `data: chunk one\n\n`,
      `data: chunk two\n\n`,
      `event: code_complete\ndata: ${JSON.stringify({ code: "<h1>Done</h1>" })}\n\n`,
      `event: done\ndata: complete\n\n`,
    ].join("");
    global.fetch = jest.fn().mockResolvedValue(mockResponse(raw));

    await fetchSSE("/api/generate", {}, { onMessage, onCodeComplete, onDone });

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenNthCalledWith(1, "chunk one");
    expect(onMessage).toHaveBeenNthCalledWith(2, "chunk two");
    expect(onCodeComplete).toHaveBeenCalledWith("<h1>Done</h1>");
    expect(onDone).toHaveBeenCalled();
  });

  it("works without handlers (does not throw)", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse("data: hello\n\n"));
    await expect(fetchSSE("/api/generate")).resolves.toBeUndefined();
  });
});
