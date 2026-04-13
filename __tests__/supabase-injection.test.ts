/**
 * TDD tests for Supabase injection (Epic 2 — AC-5)
 *
 * Verifies the full chain: sandpack config injects supabaseClient.js,
 * and engineer prompt instructs AI to use dynamic_app_data table.
 *
 *   SB-01: Engineer prompt references dynamic_app_data table
 *   SB-02: Sandpack config injects /supabaseClient.js with createClient call
 *   SB-03: Engineer prompt references appId field for row isolation
 *   SB-04: /supabaseClient.js is marked hidden (user never sees credentials)
 *   SB-05: supabaseClient.js exports `supabase` symbol
 *   SB-06: Engineer prompt instructs import from '/supabaseClient.js'
 */

import { buildSandpackConfig } from "@/lib/sandpack-config";
import { getSystemPrompt } from "@/lib/generate-prompts";

const PROJECT_ID = "proj-supabase-test-123";

describe("Supabase injection — sandpack config (SB-02, SB-04, SB-05)", () => {
  const config = buildSandpackConfig("export default function App() {}", PROJECT_ID);
  const supabaseFile = config.files["/supabaseClient.js"];

  // SB-02: The file exists and calls createClient
  it("SB-02: /supabaseClient.js contains createClient invocation", () => {
    expect(supabaseFile).toBeDefined();
    expect(supabaseFile.code).toContain("createClient");
  });

  // SB-04: File is hidden so users don't see raw credentials
  it("SB-04: /supabaseClient.js is marked as hidden", () => {
    expect(supabaseFile.hidden).toBe(true);
  });

  // SB-05: File exports the supabase client symbol
  it("SB-05: /supabaseClient.js exports `supabase` named export", () => {
    expect(supabaseFile.code).toContain("export");
    expect(supabaseFile.code).toContain("supabase");
  });

  it("SB-05b: supabase export uses const declaration", () => {
    expect(supabaseFile.code).toMatch(/export\s+const\s+supabase/);
  });

  // RLS: x-app-id header must be set so RLS policies can isolate rows by project
  it("SB-07: /supabaseClient.js sets x-app-id global header with projectId", () => {
    expect(supabaseFile.code).toContain("x-app-id");
    expect(supabaseFile.code).toContain(PROJECT_ID);
  });
});

describe("Supabase injection — engineer prompt (SB-01, SB-03, SB-06)", () => {
  const prompt = getSystemPrompt("engineer", PROJECT_ID);

  // SB-01: AI is told to use the correct table
  it("SB-01: engineer prompt references dynamic_app_data table", () => {
    expect(prompt).toContain("DynamicAppData");
  });

  // SB-03: AI is told to use appId for per-project row isolation
  it("SB-03: engineer prompt references appId field for data isolation", () => {
    expect(prompt).toContain("appId");
  });

  // SB-06: AI is told to import from the pre-injected file, not create client inline
  it("SB-06: engineer prompt instructs import from '/supabaseClient.js'", () => {
    expect(prompt).toContain("from '/supabaseClient.js'");
  });

  // Guard: AI must NOT be instructed to call createClient with raw credentials
  it("SB-06b: engineer prompt does NOT embed raw supabase credentials", () => {
    // No instruction to call createClient('url', 'key') inline
    expect(prompt).not.toMatch(/createClient\s*\(\s*['"][^'"]{10,}/);
  });
});

describe("buildSandpackConfig — multi-file input", () => {
  const files = {
    "/App.js": "export default function App() { return <div/>; }",
    "/components/Header.js": "export function Header() { return <h1/>; }",
  };
  const config = buildSandpackConfig(files, "proj-multi");

  it("includes all user files in config", () => {
    expect(config.files["/App.js"].code).toContain("App");
    expect(config.files["/components/Header.js"].code).toContain("Header");
  });

  it("still includes hidden supabaseClient.js", () => {
    expect(config.files["/supabaseClient.js"]).toBeDefined();
    expect(config.files["/supabaseClient.js"].hidden).toBe(true);
  });

  it("user files are not hidden", () => {
    expect(config.files["/App.js"].hidden).toBeUndefined();
    expect(config.files["/components/Header.js"].hidden).toBeUndefined();
  });
});
