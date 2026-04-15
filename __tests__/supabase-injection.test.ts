/**
 * TDD tests for Supabase injection (Epic 2 — AC-5)
 *
 * Verifies the engineer prompt instructs AI to use dynamic_app_data table
 * and import from the pre-injected /supabaseClient.js file.
 *
 *   SB-01: Engineer prompt references dynamic_app_data table
 *   SB-03: Engineer prompt references appId field for row isolation
 *   SB-06: Engineer prompt instructs import from '/supabaseClient.js'
 */

import { getSystemPrompt } from "@/lib/generate-prompts";

describe("Supabase injection — engineer prompt (SB-01, SB-03, SB-06)", () => {
  const prompt = getSystemPrompt("engineer", "proj-supabase-test-123");

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
    expect(prompt).not.toMatch(/createClient\s*\(\s*['"][^'"]{10,}/);
  });
});
