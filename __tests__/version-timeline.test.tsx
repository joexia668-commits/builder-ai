/**
 * TDD tests for VersionTimeline — EPIC 3
 *
 * Covers:
 * VT-01: Nodes display version number, description, and formatted time
 * VT-02: Clicking a history node calls onPreviewVersion (not mutating currentCode)
 * VT-03: Banner shows version number when previewingVersion is set
 * VT-04: Restore calls POST /api/versions/:id/restore and calls onRestoreVersion
 * VT-05: "Return" button calls onPreviewVersion(null)
 * VT-06: Current version node has distinct highlight class
 * VT-08: AC-8 — Timeline container has overflow-x-auto + min-w-max (horizontal scroll)
 * VT-09: AC-4 — After restore completes, banner is cleared (onPreviewVersion(null) called)
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ProjectVersion } from "@/lib/types";

// Mock API client
jest.mock("@/lib/api-client", () => ({
  fetchAPI: jest.fn(),
}));

// Mock toast
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { fetchAPI } from "@/lib/api-client";
import { VersionTimeline } from "@/components/timeline/version-timeline";

const makeVersion = (n: number, overrides: Partial<ProjectVersion> = {}): ProjectVersion => ({
  id: `v${n}`,
  projectId: "proj-1",
  versionNumber: n,
  code: `code-v${n}`,
  description: `描述版本${n}`,
  agentMessages: null,
  createdAt: new Date("2026-03-29T10:00:00Z"),
  parentVersionId: null,
  changedFiles: null,
  iterationSnapshot: null,
  ...overrides,
});

const v1 = makeVersion(1);
const v2 = makeVersion(2);
const v3 = makeVersion(3);
const versions = [v1, v2, v3];

describe("VersionTimeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // VT-01: Nodes show version number, description, and time
  it("VT-01: renders version number label for each version", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("VT-01b: renders description text on each node", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.getByText("描述版本1")).toBeInTheDocument();
    expect(screen.getByText("描述版本2")).toBeInTheDocument();
  });

  it("VT-01c: renders formatted time (HH:MM) on each node after mount", async () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    // Time is deferred via useMounted to avoid SSR hydration mismatch;
    // wait for client-side mount to update the DOM.
    await waitFor(() => {
      const timeEls = screen.getAllByText(/^\d{2}:\d{2}$/);
      expect(timeEls.length).toBeGreaterThan(0);
    });
  });

  // VT-02: Clicking history node calls onPreviewVersion (not mutating code directly)
  it("VT-02: clicking history node calls onPreviewVersion with the version", () => {
    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
      />
    );
    // Click v1 node (history, not current)
    fireEvent.click(screen.getByTestId("version-node-v1"));
    expect(onPreviewVersion).toHaveBeenCalledWith(v1);
  });

  it("VT-02b: clicking current version node (v3) calls onPreviewVersion(null) to clear", () => {
    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("version-node-v3"));
    expect(onPreviewVersion).toHaveBeenCalledWith(null);
  });

  // VT-03: Banner shows version number when previewingVersion is set
  it("VT-03: banner is hidden when previewingVersion is null", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.queryByText(/正在预览/)).not.toBeInTheDocument();
  });

  it("VT-03b: banner shows version number when previewingVersion is set", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.getByText(/正在预览 v2/)).toBeInTheDocument();
  });

  // VT-04: Restore calls API and onRestoreVersion with new version
  it("VT-04: clicking '恢复此版本' calls POST restore API and onRestoreVersion", async () => {
    const newVersion = makeVersion(4, { description: "从 v2 恢复" });
    (fetchAPI as jest.Mock).mockResolvedValue({
      json: jest.fn().mockResolvedValue(newVersion),
    });

    const onRestoreVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={onRestoreVersion}
      />
    );

    fireEvent.click(screen.getByText("恢复此版本"));

    await waitFor(() => {
      expect(fetchAPI).toHaveBeenCalledWith(
        `/api/versions/${v2.id}/restore`,
        { method: "POST" }
      );
      expect(onRestoreVersion).toHaveBeenCalledWith(newVersion);
    });
  });

  // VT-05: "Return" button calls onPreviewVersion(null)
  it("VT-05: clicking '返回当前' calls onPreviewVersion(null)", () => {
    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText("返回当前"));
    expect(onPreviewVersion).toHaveBeenCalledWith(null);
  });

  // VT-06: Current version node has distinct highlight
  it("VT-06: current version node (last) has indigo style class", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    const currentNode = screen.getByTestId("version-node-v3");
    // The dot inside current node should have indigo class
    expect(currentNode.querySelector(".bg-indigo-500")).toBeInTheDocument();
  });

  // VT-07: Previewing node gets amber highlight
  it("VT-07: previewing version node gets amber style", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v1}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    const previewNode = screen.getByTestId("version-node-v1");
    expect(previewNode.querySelector(".bg-amber-400")).toBeInTheDocument();
  });

  // VT-08: AC-8 — Horizontal scroll: timeline-scroll class present
  it("VT-08: scroll container has timeline-scroll class (AC-8)", () => {
    const manyVersions = Array.from({ length: 12 }, (_, i) =>
      makeVersion(i + 1)
    );
    const { container } = render(
      <VersionTimeline
        versions={manyVersions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    const scrollContainer = container.querySelector(".timeline-scroll");
    expect(scrollContainer).toBeInTheDocument();
  });

  it("VT-08b: inner track has min-w-max so nodes are never clipped (AC-8)", () => {
    const manyVersions = Array.from({ length: 12 }, (_, i) =>
      makeVersion(i + 1)
    );
    const { container } = render(
      <VersionTimeline
        versions={manyVersions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    const track = container.querySelector(".min-w-max");
    expect(track).toBeInTheDocument();
    // All 12 version nodes are rendered (not hidden/clipped)
    const nodes = container.querySelectorAll("[data-testid^='version-node-']");
    expect(nodes.length).toBe(12);
  });

  // VT-09: AC-4 — After successful restore, onPreviewVersion(null) is called to clear banner
  it("VT-09: after restore succeeds, onPreviewVersion(null) is called to clear banner (AC-4)", async () => {
    const newVersion = makeVersion(4, { description: "从 v2 恢复" });
    (fetchAPI as jest.Mock).mockResolvedValue({
      json: jest.fn().mockResolvedValue(newVersion),
    });

    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText("恢复此版本"));

    await waitFor(() => {
      expect(onPreviewVersion).toHaveBeenCalledWith(null);
    });
  });

  // ─── EPIC 5 Step 5: Global Generation Lock ──────────────────────────────

  // VT-E5-01: isGenerating=true → all version node buttons disabled
  it("VT-E5-01: isGenerating=true 时所有版本节点按钮 disabled", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
        isGenerating={true}
      />
    );
    const buttons = screen.getAllByRole("button");
    // Every version node button must be disabled
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  // VT-E5-02: isGenerating=true → version node has opacity-40 class
  it("VT-E5-02: isGenerating=true 时版本节点有 opacity-40 样式类", () => {
    const { container } = render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
        isGenerating={true}
      />
    );
    const opacityEls = container.querySelectorAll(".opacity-40");
    expect(opacityEls.length).toBeGreaterThan(0);
  });

  // VT-E5-03: isGenerating=true → click does NOT fire onPreviewVersion
  it("VT-E5-03: isGenerating=true 时点击版本节点不触发 onPreviewVersion", () => {
    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
        isGenerating={true}
      />
    );
    const btn = screen.getByTestId("version-node-v1").querySelector("button");
    if (btn) fireEvent.click(btn);
    expect(onPreviewVersion).not.toHaveBeenCalled();
  });

  // VT-E5-04: isGenerating=false → buttons are enabled (normal)
  it("VT-E5-04: isGenerating=false 时版本节点按钮正常可点击", () => {
    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
        isGenerating={false}
      />
    );
    fireEvent.click(screen.getByTestId("version-node-v1"));
    expect(onPreviewVersion).toHaveBeenCalledWith(v1);
  });

  // VT-E5-05: isGenerating 默认为 false（可选 prop，向后兼容）
  // VT-E5-05: isGenerating 默认为 false（可选 prop）
  it("VT-E5-05: 不传 isGenerating 时按钮默认可用（向后兼容）", () => {
    const onPreviewVersion = jest.fn();
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={onPreviewVersion}
        onRestoreVersion={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("version-node-v1"));
    expect(onPreviewVersion).toHaveBeenCalledWith(v1);
  });

  // VT-10: AC-4 — Restore description format "从 v{n} 恢复" is correct
  it("VT-10: restore button is disabled while API call is in-flight (AC-4)", async () => {
    let resolveRestore!: (v: unknown) => void;
    const pendingPromise = new Promise((res) => { resolveRestore = res; });
    (fetchAPI as jest.Mock).mockReturnValue(pendingPromise);

    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );

    const restoreBtn = screen.getByText("恢复此版本");
    fireEvent.click(restoreBtn);

    // Button should be disabled while restoring
    expect(restoreBtn).toBeDisabled();

    // Cleanup: resolve the pending promise to avoid hanging
    resolveRestore({ json: jest.fn().mockResolvedValue(makeVersion(4)) });
  });

  // VT-11: Restored version shows restore label
  it("VT-11: restored version shows '← vN' label when parentVersionId is set", () => {
    const v4 = makeVersion(4, { parentVersionId: "v2", description: "从 v2 恢复" });
    const versionsWithRestore = [v1, v2, v3, v4];
    render(
      <VersionTimeline
        versions={versionsWithRestore}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.getByText("← v2")).toBeInTheDocument();
  });

  it("VT-11b: normal version does not show restore label", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.queryByText(/← v/)).not.toBeInTheDocument();
  });

  // VT-12: Restored version node has distinct visual style
  it("VT-12: restored version node has restore icon indicator", () => {
    const v4 = makeVersion(4, { parentVersionId: "v2", description: "从 v2 恢复" });
    const versionsWithRestore = [v1, v2, v3, v4];
    render(
      <VersionTimeline
        versions={versionsWithRestore}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    const v4Node = screen.getByTestId("version-node-v4");
    expect(v4Node.querySelector("[data-restore-icon]")).toBeInTheDocument();
  });

  // VT-13: Preview banner shows changedFiles summary
  it("VT-13: preview banner shows changed files count when changedFiles is present", () => {
    const v2WithChanges = makeVersion(2, {
      changedFiles: {
        added: { "/New.js": "new" },
        modified: { "/App.js": "updated" },
        removed: ["/Old.js"],
      },
    });
    render(
      <VersionTimeline
        versions={[v1, v2WithChanges, v3]}
        previewingVersion={v2WithChanges}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.getByText(/修改了 3 个文件/)).toBeInTheDocument();
  });

  it("VT-13b: preview banner does not show file count when changedFiles is null", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.queryByText(/修改了/)).not.toBeInTheDocument();
  });
});
