import type { FileEntry } from "../api/files.ts";

export interface TreeNode {
  name: string;
  path: string;
  /** Missing only for folders implied by a path but not listed (should not happen). */
  entry: FileEntry | undefined;
  isFolder: boolean;
  children: TreeNode[];
}

/** Builds a sorted tree (folders first, then names) from the flat file list. */
export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = {
    name: "",
    path: "",
    entry: undefined,
    isFolder: true,
    children: [],
  };
  const byPath = new Map<string, TreeNode>([["", root]]);

  const ensure = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = ensure(slash < 0 ? "" : path.slice(0, slash));
    const node: TreeNode = {
      name: path.slice(slash + 1),
      path,
      entry: undefined,
      isFolder: true,
      children: [],
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const node = ensure(file.path);
    node.entry = file;
    node.isFolder = file.kind === "folder";
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isFolder === b.isFolder
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.isFolder
          ? -1
          : 1,
    );
    for (const n of nodes) sort(n.children);
  };
  sort(root.children);
  return root.children;
}

/** Folder a new file should go into, given the current selection. */
export function folderOf(path: string | undefined, isFolder: boolean): string {
  if (!path) return "";
  if (isFolder) return path;
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export const join = (folder: string, name: string) =>
  folder ? `${folder}/${name}` : name;

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** All ancestor folder paths of a path ("a/b/c.tex" → ["a", "a/b"]). */
export function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
