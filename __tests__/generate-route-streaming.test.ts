import { createHandler } from "@/app/api/generate/handler";
import type { AIProvider } from "@/lib/ai-providers";
import type { NextRequest } from "next/server";

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(async () => ({ sub: "test-user", isDemo: false })),
}));

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

async function readSSEEvents(
  response: Response
): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const block of lines) {
      const line = block.replace(/^data: /, "").trim();
      if (line) events.push(JSON.parse(line));
    }
  }
  return events;
}

function makeFakeProvider(chunks: string[]): AIProvider {
  return {
    streamCompletion: async (_messages: unknown, onChunk: (text: string) => void) => {
      for (const c of chunks) {
        onChunk(c);
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  } as unknown as AIProvider;
}

describe("/api/generate — engineer streaming tap", () => {
  it("emits file_start → file_chunk → file_end in order for a multi-file engineer response", async () => {
    const chunks = [
      "// === FILE: /a.js ===\n",
      "const a = 1;\n",
      "// === FILE: /b.js ===\n",
      "const b = 2;\n",
    ];
    const handler = createHandler({
      createProvider: () => makeFakeProvider(chunks),
    });
    const req = makeRequest({
      projectId: "p1",
      prompt: "x",
      agent: "engineer",
      context: "ctx",
      targetFiles: [
        { path: "/a.js", description: "", exports: [], deps: [], hints: "" },
        { path: "/b.js", description: "", exports: [], deps: [], hints: "" },
      ],
    });
    const res = await handler(req);
    const events = await readSSEEvents(res);

    const tapEvents = events.filter((e) =>
      ["file_start", "file_chunk", "file_end"].includes(e.type as string)
    );
    const paths = tapEvents.map((e) => `${e.type}:${e.path}`);
    expect(paths[0]).toBe("file_start:/a.js");
    expect(paths.indexOf("file_end:/a.js")).toBeLessThan(
      paths.indexOf("file_start:/b.js")
    );
    expect(paths[paths.length - 1]).toBe("file_end:/b.js");

    // Authoritative path still present
    expect(events.some((e) => e.type === "files_complete")).toBe(true);
  });

  it("coalesces rapid chunks within the 80ms throttle window", async () => {
    const chunks = [
      "// === FILE: /a.js ===\n",
      ...Array(50).fill(0).map((_: unknown, i: number) => `x${i};`),
    ];
    const handler = createHandler({
      createProvider: () => makeFakeProvider(chunks),
    });
    const req = makeRequest({
      projectId: "p1",
      prompt: "x",
      agent: "engineer",
      context: "ctx",
      targetFiles: [
        { path: "/a.js", description: "", exports: [], deps: [], hints: "" },
      ],
    });
    const res = await handler(req);
    const events = await readSSEEvents(res);

    const fileChunks = events.filter(
      (e) => e.type === "file_chunk" && e.path === "/a.js"
    );
    expect(fileChunks.length).toBeLessThan(15);
  });

  it("skips tap for non-engineer agents", async () => {
    const handler = createHandler({
      createProvider: () => makeFakeProvider(['{"intent":"x","features":[],"persistence":"none","modules":[]}']),
    });
    const req = makeRequest({
      projectId: "p1",
      prompt: "x",
      agent: "pm",
    });
    const res = await handler(req);
    const events = await readSSEEvents(res);
    expect(events.some((e) => e.type === "file_start")).toBe(false);
  });
});
