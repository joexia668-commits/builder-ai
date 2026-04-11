// __tests__/preview-panel-activity-tab.test.tsx

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import type { ProjectVersion, LiveFileStream, EngineerProgress } from "@/lib/types";

jest.mock("@/components/preview/preview-frame", () => ({
  PreviewFrame: () => <div data-testid="preview-frame" />,
}));
jest.mock("@/components/preview/file-tree-code-viewer", () => ({
  FileTreeCodeViewer: (props: {
    files: Record<string, string>;
    liveStreams?: Record<string, LiveFileStream>;
    engineerProgress?: EngineerProgress | null;
  }) => (
    <div
      data-testid="code-viewer"
      data-has-live-streams={
        props.liveStreams !== undefined && Object.keys(props.liveStreams).length > 0
          ? "true"
          : "false"
      }
    />
  ),
}));
jest.mock("@/components/timeline/version-timeline", () => ({
  VersionTimeline: () => null,
}));
jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn(),
}));

const BASE_PROPS = {
  files: { "/App.js": "x" },
  projectId: "p1",
  versions: [] as ProjectVersion[],
  previewingVersion: null,
  onPreviewVersion: jest.fn(),
  onVersionRestore: jest.fn(),
  latestVersionId: "v1",
  liveStreams: {} as Record<string, LiveFileStream>,
  engineerProgress: null as EngineerProgress | null,
};

describe("PreviewPanel — code tab auto-switch (activity tab removed)", () => {
  it("PP-CT-01: does NOT render an activity tab button", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.queryByTestId("tab-activity")).not.toBeInTheDocument();
  });

  it("PP-CT-02: renders preview and code tab buttons", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("tab-preview")).toBeInTheDocument();
    expect(screen.getByTestId("tab-code")).toBeInTheDocument();
  });

  it("PP-CT-03: auto-switches to code tab when isGenerating becomes true", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("code-viewer")).toBeInTheDocument();
  });

  it("PP-CT-04: does not auto-switch to code if user overrode tab before generation", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    fireEvent.click(screen.getByTestId("tab-preview"));
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.queryByTestId("code-viewer")).not.toBeInTheDocument();
  });

  it("PP-CT-05: does not auto-switch back if user clicked Preview mid-generation", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("code-viewer")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-preview"));
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
  });

  it("PP-CT-06: passes liveStreams to FileTreeCodeViewer when on code tab", () => {
    const liveStreams: Record<string, LiveFileStream> = {
      "/App.js": {
        path: "/App.js",
        content: "x",
        status: "streaming",
        attempt: 1,
        failedAttempts: [],
      },
    };
    render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} liveStreams={liveStreams} />
    );
    fireEvent.click(screen.getByTestId("tab-code"));
    expect(screen.getByTestId("code-viewer")).toHaveAttribute(
      "data-has-live-streams",
      "true"
    );
  });

  it("PP-CT-07: does not render activity-panel anywhere in the tree", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.queryByTestId("activity-panel")).not.toBeInTheDocument();
  });
});
