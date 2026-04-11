import { readSSEBody } from "@/lib/api-client";

function makeStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + "\n"));
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(c);
      ctrl.close();
    },
  });
}

function sseData(obj: object): string {
  return `data: ${JSON.stringify(obj)}`;
}

describe("readSSEBody", () => {
  beforeEach(() => jest.spyOn(console, "info").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("calls onEvent for each parsed SSE event", async () => {
    const events: object[] = [];
    const stream = makeStream([
      sseData({ type: "chunk", content: "hello" }),
      sseData({ type: "done" }),
    ]);
    await readSSEBody(stream, (e) => events.push(e));
    expect(events).toHaveLength(2);
    expect((events[0] as { type: string }).type).toBe("chunk");
  });

  it("logs [sse:xxxx] open on start and close on finish", async () => {
    const stream = makeStream([sseData({ type: "done" })]);
    await readSSEBody(stream, () => {});
    const calls = (console.info as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.match(/\[sse:[a-z0-9]{4}\] open/))).toBe(true);
    expect(calls.some((c) => c.match(/\[sse:[a-z0-9]{4}\] close/))).toBe(true);
  });

  it("triggers onStall callback after stall timeout", async () => {
    jest.useFakeTimers();
    const onStall = jest.fn();
    // Stream that never closes (simulate stall)
    let ctrlRef: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrlRef = ctrl; },
    });

    const readPromise = readSSEBody(stream, () => {}, { stallMs: 1000, onStall });

    // Advance time past stall threshold
    await jest.advanceTimersByTimeAsync(1100);
    expect(onStall).toHaveBeenCalledTimes(1);

    // Clean up
    ctrlRef!.close();
    await readPromise;
    jest.useRealTimers();
  });

  it("clears stall timer after stream closes normally", async () => {
    jest.useFakeTimers();
    const onStall = jest.fn();
    const stream = makeStream([sseData({ type: "done" })]);

    await readSSEBody(stream, () => {}, { stallMs: 1000, onStall });
    await jest.advanceTimersByTimeAsync(2000);

    expect(onStall).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
