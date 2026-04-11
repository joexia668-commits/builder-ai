# File Tree Code Viewer — Design Spec

**Date:** 2026-04-11
**Status:** Approved

## Problem

The current "代码" tab in `PreviewPanel` renders `MultiFileEditor` — a horizontal tab bar + editable Monaco editor. For generated multi-file projects, this flat tab layout doesn't communicate directory structure and the editable editor is unnecessary (generated code is not meant to be hand-edited in this view).

## Goal

Replace the code tab's content with a read-only file tree viewer: file tree on the left, Monaco editor on the right — like a minimal IDE explorer.

---

## Approach

**Method A (selected):** Replace `MultiFileEditor` with a new `FileTreeCodeViewer` component. Zero new dependencies. Pure React tree rendering + Monaco in read-only mode.

---

## Component Structure

New file: `components/preview/file-tree-code-viewer.tsx`

```
FileTreeCodeViewer
├── FileTree (left panel, fixed ~200px width)
│   └── FileTreeNode (recursive, dirs collapsible)
└── CodeViewer (right panel, flex-1)
    └── Monaco Editor (readOnly: true)
```

**Changes to existing files:**
- `components/preview/preview-panel.tsx`: swap `<MultiFileEditor>` for `<FileTreeCodeViewer>` in the `code` tab branch. Remove `onFilesChange` prop from the code tab (read-only, no edits to propagate).
- `MultiFileEditor` is **not deleted** — file is retained for potential future use.

---

## Data Model

Flat file paths are parsed into a typed tree:

```typescript
type TreeNode =
  | { kind: "file"; name: string; path: string }
  | { kind: "dir";  name: string; path: string; children: TreeNode[] };
```

**`buildFileTree(paths: string[]): TreeNode[]`** — pure function:
1. Split each path by `/`, build nested structure iteratively
2. Sort: directories before files at each level; `/App.js` always first among files
3. Returns root-level nodes (children of the implicit `/` root)

Collapse state: `Set<string>` of collapsed directory paths, stored in `useState`. Initial state: all directories expanded.

---

## Interaction & Style

### Left Panel (File Tree)
- Width: 200px fixed, `shrink-0`
- Background: `#252526` (matches existing tab bar)
- Font: monospace, `text-xs`
- **Directory row:** `▶` (collapsed) / `▼` (expanded) chevron + directory name. Click → toggle collapsed state.
- **File row:** indented by `depth * 12px`. Click → set `activePath`, highlight with `bg-[#1e1e1e] text-white`, idle state `text-gray-400 hover:text-gray-200`
- Separator: 1px right border `border-[#1e1e1e]`

### Right Panel (Code Viewer)
- `flex-1`, overflow hidden
- Monaco Editor with `readOnly: true`, `minimap: { enabled: false }`
- Language inferred from extension:
  - `.js`, `.jsx` → `javascript`
  - `.ts`, `.tsx` → `typescript`
  - `.css` → `css`
  - `.json` → `json`
  - fallback → `plaintext`
- If no file selected (empty `files`), show a centered placeholder message

---

## Props

```typescript
interface FileTreeCodeViewerProps {
  files: Record<string, string>;
}
```

No `onFilesChange` — read-only. `preview-panel.tsx` no longer passes edit callbacks when `tab === "code"`.

---

## Out of Scope

- File renaming, creation, deletion
- Right-click context menus
- Keyboard navigation in the tree
- Drag-and-drop reordering
- Search / filter within the tree

---

## Testing

- Unit test `buildFileTree()`: flat paths → correct tree shape, sort order, nested dirs
- Component test `FileTreeCodeViewer`: renders tree nodes, clicking a file updates the editor, clicking a dir toggles collapse
- Existing E2E test for the code tab continues to pass (tab switch still works)
