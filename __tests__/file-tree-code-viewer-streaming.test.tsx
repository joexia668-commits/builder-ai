// __tests__/file-tree-code-viewer-streaming.test.tsx

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTreeCodeViewer } from "@/components/preview/file-tree-code-viewer";
import type { LiveFileStream, EngineerProgress } from "@/lib/types";

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor" data-language={language}>
      {value}
    </div>
  ),
}));

jest.mock("@/hooks/use-auto-scroll-to-bottom", () => ({
  useAutoScrollToBottom: jest.fn(),
}));

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
  totalLayers: 1,
  currentLayer: 1,
  totalFiles: 1,
  currentFiles: ["/App.js"],
  completedFiles: [],
  failedFiles: [],
  retryInfo: null,
};

const BASE_FILES: Record<string, string> = {
  "/App.js": "export default function App() {}",
  "/components/Button.js": "export function Button() {}",
};

describe("FileTreeCodeViewer — static mode (no liveStreams)", () => {
  it("renders Monaco when liveStreams is undefined", () => {
    render(<FileTreeCodeViewer files={BASE_FILES} />);
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("renders Monaco when liveStreams is empty object", () => {
    render(
      <FileTreeCodeViewer
        files={BASE_FILES}
        liveStreams={{}}
        engineerProgress={null}
      />
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });
});

describe("FileTreeCodeViewer — streaming mode", () => {
  it("FTCV-S-01: shows a streaming path in the tree even when not yet in files", () => {
    const liveStreams = {
      "/NewFile.js": makeStream({ path: "/NewFile.js", content: "const x = 1" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("tree-file-/NewFile.js")).toBeInTheDocument();
  });

  it("FTCV-S-02: merges streaming paths alongside existing files paths", () => {
    const liveStreams = {
      "/components/Button.js": makeStream({
        path: "/components/Button.js",
        content: "streaming...",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{ "/App.js": "done content" }}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("tree-file-/App.js")).toBeInTheDocument();
    expect(screen.getByTestId("tree-file-/components/Button.js")).toBeInTheDocument();
  });

  it("FTCV-S-03: renders <pre data-testid='streaming-pre'> instead of Monaco when active file is streaming", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "const x = 1" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("streaming-pre")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
  });

  it("FTCV-S-04: streaming <pre> displays the current content", () => {
    const liveStreams = {
      "/App.js": makeStream({
        path: "/App.js",
        content: "export default function App",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("streaming-pre")).toHaveTextContent(
      "export default function App"
    );
  });

  it("FTCV-S-05: streaming <pre> includes a blinking cursor element", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x" }),
    };
    const { container } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const cursor = container.querySelector("[data-testid='streaming-cursor']");
    expect(cursor).toBeInTheDocument();
  });

  it("FTCV-S-06: renders Monaco (not <pre>) when active file status is 'done'", () => {
    const liveStreams = {
      "/App.js": makeStream({
        path: "/App.js",
        content: "done content",
        status: "done",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("streaming-pre")).not.toBeInTheDocument();
  });

  it("FTCV-S-07: renders Monaco when active file is in authoritative files (self-heal priority)", () => {
    const liveStreams = {
      "/App.js": makeStream({
        path: "/App.js",
        content: "partial content",
        status: "streaming",
      }),
    };
    render(
      <FileTreeCodeViewer
        files={{ "/App.js": "final content" }}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("streaming-pre")).not.toBeInTheDocument();
  });

  it("FTCV-S-08: auto-follows the first streaming path (activates it in tree)", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const btn = screen.getByTestId("tree-file-/App.js");
    expect(btn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-09: auto-follows when a new path appears in liveStreams", () => {
    const { rerender } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    rerender(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x", status: "done" }),
          "/components/Button.js": makeStream({
            path: "/components/Button.js",
            content: "new file",
          }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const btn = screen.getByTestId("tree-file-/components/Button.js");
    expect(btn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-10: does NOT auto-follow when user has manually clicked a file", () => {
    const { rerender } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    fireEvent.click(screen.getByTestId("tree-file-/App.js"));
    rerender(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
          "/NewFile.js": makeStream({ path: "/NewFile.js", content: "y" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const appBtn = screen.getByTestId("tree-file-/App.js");
    expect(appBtn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-11: resets user override and resumes auto-follow when liveStreams is cleared", () => {
    const { rerender } = render(
      <FileTreeCodeViewer
        files={{ "/App.js": "done" }}
        liveStreams={{
          "/App.js": makeStream({ path: "/App.js", content: "x" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    fireEvent.click(screen.getByTestId("tree-file-/App.js"));
    rerender(
      <FileTreeCodeViewer
        files={{ "/App.js": "done", "/Other.js": "other" }}
        liveStreams={{}}
        engineerProgress={null}
      />
    );
    rerender(
      <FileTreeCodeViewer
        files={{ "/App.js": "done", "/Other.js": "other" }}
        liveStreams={{
          "/Other.js": makeStream({ path: "/Other.js", content: "new" }),
        }}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const otherBtn = screen.getByTestId("tree-file-/Other.js");
    expect(otherBtn).toHaveClass("bg-[#1e1e1e]");
  });

  it("FTCV-S-12: shows green pulsing dot indicator for streaming file in tree", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x", status: "streaming" }),
    };
    const { container } = render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const indicator = container.querySelector("[data-testid='status-indicator-/App.js']");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass("bg-green-400");
    expect(indicator).toHaveClass("animate-pulse");
  });

  it("FTCV-S-13: shows grey checkmark indicator for done file in tree", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "x", status: "done" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const indicator = screen.getByTestId("status-indicator-/App.js");
    expect(indicator).toHaveTextContent("✓");
  });

  it("FTCV-S-14: shows red ✗ indicator for failed file in tree", () => {
    const liveStreams = {
      "/App.js": makeStream({ path: "/App.js", content: "", status: "failed" }),
    };
    render(
      <FileTreeCodeViewer
        files={{}}
        liveStreams={liveStreams}
        engineerProgress={EMPTY_PROGRESS}
      />
    );
    const indicator = screen.getByTestId("status-indicator-/App.js");
    expect(indicator).toHaveTextContent("✗");
  });

  it("FTCV-S-15: no indicator for files that only appear in authoritative files", () => {
    render(
      <FileTreeCodeViewer
        files={{ "/App.js": "settled content" }}
        liveStreams={{}}
        engineerProgress={null}
      />
    );
    expect(screen.queryByTestId("status-indicator-/App.js")).not.toBeInTheDocument();
  });
});
