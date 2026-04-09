# Preview Frame Height Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Sandpack preview iframe so it fills the full height of the preview panel instead of rendering in a small portion of it.

**Architecture:** Add a `style` prop to `SandpackProvider` so the `.sp-wrapper` div it renders gets explicit height and flex layout, completing the flex height chain from the outer container down to the iframe.

**Tech Stack:** React, Sandpack (`@codesandbox/sandpack-react`), Tailwind CSS

---

### Task 1: Fix SandpackProvider height

**Files:**
- Modify: `components/preview/preview-frame.tsx:24`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/preview-frame.test.tsx` (create if it doesn't exist):

```tsx
import { render } from "@testing-library/react";
import { PreviewFrame } from "@/components/preview/preview-frame";

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

jest.mock("@/lib/sandpack-config", () => ({
  buildSandpackConfig: () => ({
    template: "react",
    files: {},
    options: {},
    customSetup: {},
    theme: "auto",
  }),
}));

describe("PreviewFrame", () => {
  it("passes height:100% style to SandpackProvider", () => {
    const { getByTestId } = render(
      <PreviewFrame files={{ "/App.js": "export default () => <div/>" }} projectId="test" />
    );
    const provider = getByTestId("sandpack-provider");
    expect(provider).toHaveStyle({ height: "100%" });
  });

  it("passes display:flex and flexDirection:column to SandpackProvider", () => {
    const { getByTestId } = render(
      <PreviewFrame files={{ "/App.js": "export default () => <div/>" }} projectId="test" />
    );
    const provider = getByTestId("sandpack-provider");
    expect(provider).toHaveStyle({ display: "flex", flexDirection: "column" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPatterns="preview-frame"
```

Expected: FAIL — `SandpackProvider` does not receive height/flex styles yet.

- [ ] **Step 3: Apply the fix**

In `components/preview/preview-frame.tsx`, add `style` to `SandpackProvider`:

```tsx
<SandpackProvider
  key={sandpackKey}
  template={config.template as "react"}
  files={config.files}
  options={config.options}
  customSetup={config.customSetup}
  theme={config.theme as "auto"}
  style={{ height: "100%", display: "flex", flexDirection: "column" }}
>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="preview-frame"
```

Expected: PASS

- [ ] **Step 5: Verify visually**

```bash
npm run dev
```

Open a project with generated code. The preview iframe should now fill the full height of the preview panel with no blank space below.

- [ ] **Step 6: Commit**

```bash
git add components/preview/preview-frame.tsx __tests__/preview-frame.test.tsx
git commit -m "fix: SandpackProvider fills preview panel height"
```
