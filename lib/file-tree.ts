export type TreeNode =
  | { kind: "file"; name: string; path: string }
  | { kind: "dir"; name: string; path: string; children: TreeNode[] };

/**
 * Converts flat file paths into a tree structure.
 * Directories sort before files; /App.js is always first among root-level files.
 */
export function buildFileTree(paths: string[]): TreeNode[] {
  // Map from dir-path → dir node (for deduplication)
  const dirMap = new Map<string, Extract<TreeNode, { kind: "dir" }>>();
  const roots: TreeNode[] = [];

  function getOrCreateDir(
    segments: string[],
    parentList: TreeNode[]
  ): Extract<TreeNode, { kind: "dir" }> {
    const dirPath = "/" + segments.join("/");
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
    const node: Extract<TreeNode, { kind: "dir" }> = {
      kind: "dir",
      name: segments[segments.length - 1],
      path: dirPath,
      children: [],
    };
    dirMap.set(dirPath, node);
    parentList.push(node);
    return node;
  }

  for (const fullPath of paths) {
    // Strip leading slash and split
    const parts = fullPath.replace(/^\//, "").split("/");
    const fileName = parts[parts.length - 1];
    const dirSegments = parts.slice(0, -1);

    if (dirSegments.length === 0) {
      roots.push({ kind: "file", name: fileName, path: fullPath });
    } else {
      let currentList = roots;
      for (let i = 0; i < dirSegments.length; i++) {
        const dir = getOrCreateDir(dirSegments.slice(0, i + 1), currentList);
        currentList = dir.children;
      }
      currentList.push({ kind: "file", name: fileName, path: fullPath });
    }
  }

  sortNodes(roots);
  return roots;
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    // Dirs before files
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    // App.js always first among files
    if (a.kind === "file" && a.name === "App.js") return -1;
    if (b.kind === "file" && b.name === "App.js") return 1;
    return a.name.localeCompare(b.name);
  });
  // Recurse into dirs
  for (const node of nodes) {
    if (node.kind === "dir") sortNodes(node.children);
  }
}
