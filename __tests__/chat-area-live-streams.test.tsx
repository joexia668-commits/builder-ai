import React from "react";
import { act, waitFor } from "@testing-library/react";
import { getSession, resetSession, updateSession } from "@/lib/generation-session";
import type { LiveFileStream } from "@/lib/types";

const PROJECT_ID = "live-streams-test";

beforeEach(() => resetSession(PROJECT_ID));
afterEach(() => resetSession(PROJECT_ID));

function makeStream(overrides: Partial<LiveFileStream> = {}): LiveFileStream {
  return {
    path: "/App.js",
    content: "",
    status: "streaming",
    attempt: 1,
    failedAttempts: [],
    ...overrides,
  };
}

describe("liveStreams in GenerationSession", () => {
  it("starts as empty object", () => {
    const session = getSession(PROJECT_ID);
    expect(session.liveStreams).toEqual({});
  });

  it("can be populated with a streaming file entry", () => {
    act(() => {
      updateSession(PROJECT_ID, {
        liveStreams: {
          "/App.js": makeStream({ content: "const x = 1;", status: "streaming" }),
        },
      });
    });
    const session = getSession(PROJECT_ID);
    expect(session.liveStreams["/App.js"]).toBeDefined();
    expect(session.liveStreams["/App.js"].content).toBe("const x = 1;");
    expect(session.liveStreams["/App.js"].status).toBe("streaming");
  });

  it("can transition status from streaming to done", () => {
    act(() => {
      updateSession(PROJECT_ID, {
        liveStreams: {
          "/App.js": makeStream({ content: "const x = 1;", status: "streaming" }),
        },
      });
    });
    act(() => {
      const current = getSession(PROJECT_ID);
      updateSession(PROJECT_ID, {
        liveStreams: {
          ...current.liveStreams,
          "/App.js": { ...current.liveStreams["/App.js"], status: "done", content: "const x = 1; // done" },
        },
      });
    });
    expect(getSession(PROJECT_ID).liveStreams["/App.js"].status).toBe("done");
  });

  it("can archive a failed attempt and reset content", () => {
    act(() => {
      updateSession(PROJECT_ID, {
        liveStreams: {
          "/App.js": makeStream({ content: "partial content", status: "streaming" }),
        },
      });
    });
    act(() => {
      const session = getSession(PROJECT_ID);
      const cur = session.liveStreams["/App.js"];
      updateSession(PROJECT_ID, {
        liveStreams: {
          ...session.liveStreams,
          "/App.js": {
            ...cur,
            failedAttempts: [...cur.failedAttempts, { content: cur.content, reason: "parse_failed" }],
            content: "",
            attempt: 2,
            status: "streaming",
          },
        },
      });
    });
    const session = getSession(PROJECT_ID);
    expect(session.liveStreams["/App.js"].failedAttempts).toHaveLength(1);
    expect(session.liveStreams["/App.js"].failedAttempts[0].content).toBe("partial content");
    expect(session.liveStreams["/App.js"].attempt).toBe(2);
    expect(session.liveStreams["/App.js"].content).toBe("");
  });

  it("can be cleared back to empty", () => {
    act(() => {
      updateSession(PROJECT_ID, {
        liveStreams: { "/App.js": makeStream() },
      });
    });
    act(() => {
      updateSession(PROJECT_ID, { liveStreams: {} });
    });
    expect(getSession(PROJECT_ID).liveStreams).toEqual({});
  });
});
