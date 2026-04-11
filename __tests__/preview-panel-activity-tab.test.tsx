import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import type { ProjectVersion, LiveFileStream, EngineerProgress } from "@/lib/types";

jest.mock("@/components/preview/preview-frame", () => ({
  PreviewFrame: () => <div data-testid="preview-frame" />,
}));
jest.mock("@/components/preview/file-tree-code-viewer", () => ({
  FileTreeCodeViewer: () => <div data-testid="code-viewer" />,
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

describe("PreviewPanel Activity tab", () => {
  it("renders the Activity tab button", () => {
    render(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("tab-activity")).toBeInTheDocument();
  });

  it("auto-switches to Activity tab when isGenerating becomes true", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    expect(screen.getByTestId("activity-panel")).toBeInTheDocument();
  });

  it("does not auto-switch back if user has manually clicked Preview mid-generation", () => {
    const { rerender } = render(
      <PreviewPanel {...BASE_PROPS} isGenerating={false} />
    );
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={true} />);
    // user overrides by clicking Preview
    fireEvent.click(screen.getByTestId("tab-preview"));
    // generation ends — should NOT auto-switch anywhere since user already chose
    rerender(<PreviewPanel {...BASE_PROPS} isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
  });
});
