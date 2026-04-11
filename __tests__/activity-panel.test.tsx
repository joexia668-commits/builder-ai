import React from "react";
import { render, screen } from "@testing-library/react";
import { ActivityPanel } from "@/components/preview/activity-panel";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

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

const EMPTY_PROGRESS: EngineerProgress = {
  totalLayers: 2,
  currentLayer: 1,
  totalFiles: 3,
  currentFiles: ["App.js"],
  completedFiles: [],
  failedFiles: [],
  retryInfo: null,
};

describe("ActivityPanel", () => {
  it("renders nothing but header when liveStreams is empty", () => {
    const { container } = render(
      <ActivityPanel liveStreams={{}} engineerProgress={EMPTY_PROGRESS} />
    );
    expect(container.textContent).toContain("Layer 1/2");
    expect(container.querySelectorAll("pre")).toHaveLength(0);
  });

  it("renders a <pre> block for each streaming file", () => {
    const streams: Record<string, LiveFileStream> = {
      "/App.js": makeStream({ content: "const x = 1;" }),
      "/Foo.tsx": makeStream({ path: "/Foo.tsx", content: "export const Foo = () => null;" }),
    };
    render(<ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />);
    expect(screen.getByText(/\/App\.js/)).toBeInTheDocument();
    expect(screen.getByText(/\/Foo\.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/const x = 1;/)).toBeInTheDocument();
  });

  it("shows a done marker when status is done", () => {
    const streams = {
      "/App.js": makeStream({ content: "done code", status: "done" as const }),
    };
    render(<ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />);
    expect(screen.getByText(/✓/)).toBeInTheDocument();
  });

  it("shows collapsed failed-attempts block when failedAttempts is non-empty", () => {
    const streams = {
      "/App.js": makeStream({
        content: "new attempt",
        attempt: 2,
        failedAttempts: [{ content: "bad content", reason: "parse_failed" }],
      }),
    };
    render(<ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />);
    const details = screen.getByText(/1 次失败/);
    expect(details).toBeInTheDocument();
    expect(screen.getByText(/retry 2/)).toBeInTheDocument();
  });

  it("applies different classes for streaming/done/failed status", () => {
    const streams = {
      "/a.js": makeStream({ path: "/a.js", status: "streaming", content: "s" }),
      "/b.js": makeStream({ path: "/b.js", status: "done", content: "d" }),
      "/c.js": makeStream({ path: "/c.js", status: "failed", content: "f" }),
    };
    const { container } = render(
      <ActivityPanel liveStreams={streams} engineerProgress={EMPTY_PROGRESS} />
    );
    const pres = container.querySelectorAll("pre");
    expect(pres).toHaveLength(3);
    const classLists = Array.from(pres).map((p) => p.className);
    expect(new Set(classLists).size).toBe(3);
  });
});
