/**
 * TDD tests for PreviewFrame — Sandpack config hardening (Epic 2)
 *
 * Tests verify the Sandpack configuration without mounting the full
 * Sandpack component (which requires a browser environment with WebWorkers).
 * We test the config builder function in isolation.
 */

import React from "react";
import { render } from "@testing-library/react";
import { buildSandpackConfig } from "@/lib/sandpack-config";

// Mock Sandpack — we only care about the wrapper style, not Sandpack internals
jest.mock("@codesandbox/sandpack-react", () => ({
  SandpackProvider: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="sandpack-provider" style={style}>{children}</div>
  ),
  SandpackPreview: () => <div data-testid="sandpack-preview" />,
  SandpackLayout: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="sandpack-layout" style={style}>{children}</div>
  ),
}));

jest.mock("@/components/preview/error-boundary", () => ({
  SandpackErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Lazy import so mocks are in place before the module loads
const { PreviewFrame } = require("@/components/preview/preview-frame") as typeof import("@/components/preview/preview-frame");

describe("buildSandpackConfig", () => {
  const projectId = "proj-abc-123";
  const code = "export default function App() { return <div>Test</div>; }";

  it("includes /App.js with generated code", () => {
    const config = buildSandpackConfig(code, projectId);
    expect(config.files["/App.js"].code).toBe(code);
  });

  it("includes /supabaseClient.js as a hidden file", () => {
    const config = buildSandpackConfig(code, projectId);
    const supabaseFile = config.files["/supabaseClient.js"];
    expect(supabaseFile).toBeDefined();
    expect(supabaseFile.hidden).toBe(true);
  });

  it("/supabaseClient.js exports supabase client", () => {
    const config = buildSandpackConfig(code, projectId);
    const supabaseCode = config.files["/supabaseClient.js"].code;
    expect(supabaseCode).toContain("createClient");
    expect(supabaseCode).toContain("export");
  });

  it("includes @supabase/supabase-js in dependencies", () => {
    const config = buildSandpackConfig(code, projectId);
    expect(config.customSetup?.dependencies?.["@supabase/supabase-js"]).toBeDefined();
  });

  it("includes lucide-react in dependencies", () => {
    const config = buildSandpackConfig(code, projectId);
    expect(config.customSetup?.dependencies?.["lucide-react"]).toBeDefined();
  });

  it("sets recompileDelay to 500ms", () => {
    const config = buildSandpackConfig(code, projectId);
    expect(config.options?.recompileDelay).toBe(500);
  });

  it("uses react template", () => {
    const config = buildSandpackConfig(code, projectId);
    expect(config.template).toBe("react");
  });

  it("shows placeholder when code is empty", () => {
    const config = buildSandpackConfig("", projectId);
    expect(config.files["/App.js"].code).toContain("等待 AI 生成代码");
  });
});

describe("PreviewFrame", () => {
  it("passes layout styles to SandpackProvider", () => {
    const { getByTestId } = render(
      <PreviewFrame files={{ "/App.js": "export default () => <div/>" }} projectId="test" />
    );
    const provider = getByTestId("sandpack-provider");
    expect(provider).toHaveStyle({
      height: "100%",
      display: "flex",
      flexDirection: "column",
    });
  });
});
