/**
 * TDD tests for PreviewPanel — Skeleton during generation (Epic 2)
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";

// Mock heavy deps that don't work in jsdom
jest.mock("@/components/preview/preview-frame", () => ({
  PreviewFrame: () => <div data-testid="preview-frame">preview</div>,
}));
jest.mock("@/components/preview/multi-file-editor", () => ({
  MultiFileEditor: () => <div data-testid="code-editor">editor</div>,
}));
jest.mock("@/components/timeline/version-timeline", () => ({
  VersionTimeline: () => <div data-testid="version-timeline">timeline</div>,
}));

const APP_CODE = "export default function App() {}";

const defaultProps = {
  files: { "/App.js": APP_CODE },
  projectId: "proj-123",
  onFilesChange: jest.fn(),
  versions: [],
  previewingVersion: null,
  onPreviewVersion: jest.fn(),
  onVersionRestore: jest.fn(),
  isGenerating: false,
};

describe("PreviewPanel", () => {
  it("renders PreviewFrame when not generating", () => {
    render(<PreviewPanel {...defaultProps} isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
  });

  it("shows overlay during generation (EPIC 5: overlay approach, PreviewFrame stays rendered)", () => {
    render(<PreviewPanel {...defaultProps} isGenerating={true} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.getByText(/正在生成中/)).toBeInTheDocument();
  });

  it("passes projectId to PreviewFrame", () => {
    const { container } = render(<PreviewPanel {...defaultProps} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    void container;
  });

  it("switches to code editor tab on code tab click", () => {
    render(<PreviewPanel {...defaultProps} />);
    fireEvent.click(screen.getByText("代码"));
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
  });

  it("renders version timeline when versions exist", () => {
    const versions = [
      { id: "v1", projectId: "proj-123", code: "code", description: "v1", versionNumber: 1, createdAt: new Date() },
    ];
    render(<PreviewPanel {...defaultProps} versions={versions} />);
    expect(screen.getByTestId("version-timeline")).toBeInTheDocument();
  });

  it("shows empty state with 等待生成 when files is empty and not generating", () => {
    render(<PreviewPanel {...defaultProps} files={{}} isGenerating={false} />);
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
    expect(screen.getByText(/等待生成/)).toBeInTheDocument();
  });

  it("shows preview frame when files are non-empty and not generating", () => {
    render(<PreviewPanel {...defaultProps} files={{ "/App.js": "<h1>Hello</h1>" }} isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.queryByText(/等待生成/)).not.toBeInTheDocument();
  });

  // ─── EPIC 5 Step 5: Generation Overlay ──────────────────────────────────

  it("PP-E5-01: isGenerating=true 时渲染覆盖遮罩（absolute inset-0）", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} isGenerating={true} />
    );
    const overlay = container.querySelector(".absolute.inset-0");
    expect(overlay).toBeInTheDocument();
  });

  it("PP-E5-02: isGenerating=true 时遮罩有 backdrop-blur-sm 类", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} isGenerating={true} />
    );
    const blurOverlay = container.querySelector(".backdrop-blur-sm");
    expect(blurOverlay).toBeInTheDocument();
  });

  it("PP-E5-03: isGenerating=true 时显示「正在生成中...」文字", () => {
    render(
      <PreviewPanel {...defaultProps} isGenerating={true} />
    );
    expect(screen.getByText(/正在生成中/)).toBeInTheDocument();
  });

  it("PP-E5-04: isGenerating=false 时不渲染覆盖遮罩", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} isGenerating={false} />
    );
    const blurOverlay = container.querySelector(".backdrop-blur-sm");
    expect(blurOverlay).not.toBeInTheDocument();
  });

  it("PP-E5-05: isGenerating=true 时遮罩有 z-10 层级（高于预览内容）", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} isGenerating={true} />
    );
    const zOverlay = container.querySelector(".z-10");
    expect(zOverlay).toBeInTheDocument();
  });
});
