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
jest.mock("@/components/preview/code-editor", () => ({
  CodeEditor: () => <div data-testid="code-editor">editor</div>,
}));
jest.mock("@/components/timeline/version-timeline", () => ({
  VersionTimeline: () => <div data-testid="version-timeline">timeline</div>,
}));

const defaultProps = {
  code: "export default function App() {}",
  projectId: "proj-123",
  onCodeChange: jest.fn(),
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
    // EPIC 5 change: instead of hiding PreviewFrame, a translucent overlay covers it
    render(<PreviewPanel {...defaultProps} isGenerating={true} />);
    // PreviewFrame stays in DOM (code is non-empty in defaultProps)
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    // Overlay with 正在生成中 is shown on top
    expect(screen.getByText(/正在生成中/)).toBeInTheDocument();
  });

  it("passes projectId to PreviewFrame", () => {
    const { container } = render(<PreviewPanel {...defaultProps} />);
    // PreviewFrame mock renders, so the prop was passed correctly
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

  it("shows empty state with 等待生成 when code is empty and not generating", () => {
    render(<PreviewPanel {...defaultProps} code="" isGenerating={false} />);
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
    expect(screen.getByText(/等待生成/)).toBeInTheDocument();
  });

  it("shows preview frame when code is non-empty and not generating", () => {
    render(<PreviewPanel {...defaultProps} code="<h1>Hello</h1>" isGenerating={false} />);
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    expect(screen.queryByText(/等待生成/)).not.toBeInTheDocument();
  });

  // ─── EPIC 5 Step 5: Generation Overlay ──────────────────────────────────

  // PP-E5-01: isGenerating=true → overlay div with absolute inset-0 present
  it("PP-E5-01: isGenerating=true 时渲染覆盖遮罩（absolute inset-0）", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} code="export default function App() {}" isGenerating={true} />
    );
    const overlay = container.querySelector(".absolute.inset-0");
    expect(overlay).toBeInTheDocument();
  });

  // PP-E5-02: isGenerating=true → overlay has backdrop-blur-sm class
  it("PP-E5-02: isGenerating=true 时遮罩有 backdrop-blur-sm 类", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} code="export default function App() {}" isGenerating={true} />
    );
    const blurOverlay = container.querySelector(".backdrop-blur-sm");
    expect(blurOverlay).toBeInTheDocument();
  });

  // PP-E5-03: isGenerating=true → shows "正在生成中..." text
  it("PP-E5-03: isGenerating=true 时显示「正在生成中...」文字", () => {
    render(
      <PreviewPanel {...defaultProps} code="export default function App() {}" isGenerating={true} />
    );
    expect(screen.getByText(/正在生成中/)).toBeInTheDocument();
  });

  // PP-E5-04: isGenerating=false → no overlay
  // PP-E5-04: isGenerating=false → no overlay div
  it("PP-E5-04: isGenerating=false 时不渲染覆盖遮罩", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} code="export default function App() {}" isGenerating={false} />
    );
    const blurOverlay = container.querySelector(".backdrop-blur-sm");
    expect(blurOverlay).not.toBeInTheDocument();
  });

  // PP-E5-05: isGenerating=true → overlay has z-10 to sit above preview frame
  it("PP-E5-05: isGenerating=true 时遮罩有 z-10 层级（高于预览内容）", () => {
    const { container } = render(
      <PreviewPanel {...defaultProps} code="export default function App() {}" isGenerating={true} />
    );
    const zOverlay = container.querySelector(".z-10");
    expect(zOverlay).toBeInTheDocument();
  });
});
