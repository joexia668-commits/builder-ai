# Preview Frame Height Fix — Design

**Date:** 2026-04-09  
**Status:** Approved

## Problem

The Sandpack preview iframe only fills a small portion of the preview panel. The panel is tall but the app renders in a small area, leaving blank space below.

**Root cause:** `SandpackProvider` renders a `.sp-wrapper` div that has no explicit height, breaking the flex height chain before it reaches the iframe.

## Solution

Add `style={{ height: "100%", display: "flex", flexDirection: "column" }}` to the `SandpackProvider` element in `components/preview/preview-frame.tsx`.

This completes the flex height chain:

```
div.absolute.inset-0 (flex-col)
  └── SandpackProvider [height:100%, display:flex, flexDirection:column]  ← fix
        └── SandpackLayout [flex:1, height:100%]                           ← already set
              └── SandpackPreview [flex:1, height:100%]                    ← already set
                    └── iframe [height:100% via globals.css]               ← already set
```

## Change

**File:** `components/preview/preview-frame.tsx`  
**Scope:** One prop addition to `<SandpackProvider>`.

## Non-Goals

- No changes to `globals.css`
- No changes to component interfaces or props
- No layout restructuring
