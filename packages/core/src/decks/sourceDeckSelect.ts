// Finding nodes in a source deck tree: by offset or line, by index path (to keep a selection across rebuilds) and as a breadcrumb.
import type { DeckKind } from "./deckSizes.js";
import type { SourceDeckNode } from "./sourceDeckBlocks.js";

/** The indices from the tree's top level down to a node; a selection survives a rebuild as its path. */
export type SourceDeckPath = number[];

/** The node at `path`, or undefined when the tree has none there. */
export function findSourceDeckNode(tree: readonly SourceDeckNode[], path: SourceDeckPath): SourceDeckNode | undefined {
  let nodes: readonly SourceDeckNode[] | undefined = tree;
  let node: SourceDeckNode | undefined;
  for (const index of path) {
    node = nodes?.[index];
    if (!node) return undefined;
    nodes = node.children;
  }
  return node;
}

/** The path of the innermost node that `holds` and `accept` take, else []. */
function findPath(tree: readonly SourceDeckNode[], holds: (node: SourceDeckNode) => boolean, accept: (node: SourceDeckNode) => boolean): SourceDeckPath {
  const visit = (nodes: readonly SourceDeckNode[], prefix: SourceDeckPath): SourceDeckPath => {
    for (const [index, node] of nodes.entries()) {
      if (!holds(node)) continue;
      const inner = node.children ? visit(node.children, [...prefix, index]) : [];
      if (inner.length) return inner;
      if (accept(node)) return [...prefix, index];
    }
    return [];
  };
  return visit(tree, []);
}

/** The path of the innermost node whose range holds `offset` and that `accept` takes, else []. */
export function findSourceDeckPathAt(tree: readonly SourceDeckNode[], offset: number, accept: (node: SourceDeckNode) => boolean = () => true): SourceDeckPath {
  return findPath(tree, (node) => offset >= node.range[0] && offset <= node.range[1], accept);
}

/** The path of the innermost node whose lines hold `line` (1-based) and that `accept` takes, else []. */
export function findSourceDeckPathAtLine(tree: readonly SourceDeckNode[], line: number, accept: (node: SourceDeckNode) => boolean = () => true): SourceDeckPath {
  return findPath(tree, (node) => line >= node.line && line <= node.endLine, accept);
}

/** Every node with its path, depth first in source order. */
export function listSourceDeckNodes(tree: readonly SourceDeckNode[]): Array<{ node: SourceDeckNode; path: SourceDeckPath }> {
  const out: Array<{ node: SourceDeckNode; path: SourceDeckPath }> = [];
  const visit = (nodes: readonly SourceDeckNode[], prefix: SourceDeckPath): void => {
    nodes.forEach((node, index) => {
      const path = [...prefix, index];
      out.push({ node, path });
      if (node.children) visit(node.children, path);
    });
  };
  visit(tree, []);
  return out;
}

/**
 * The path a selection had before an edit, in the tree after it: the same path while it holds a node of the same kind,
 * else the nearest node (by path order) with the same title, else the deepest existing prefix of the path.
 */
export function restoreSourceDeckPath(tree: readonly SourceDeckNode[], path: SourceDeckPath, before?: Pick<SourceDeckNode, "kind" | "title">): SourceDeckPath {
  const same = findSourceDeckNode(tree, path);
  if (same && (!before || same.kind === before.kind)) return path;
  if (before?.title) {
    const titled = listSourceDeckNodes(tree).filter(({ node }) => node.kind === before.kind && node.title === before.title);
    const distance = (other: SourceDeckPath): number => Math.abs(comparePaths(other, path));
    const nearest = titled.sort((a, b) => distance(a.path) - distance(b.path))[0];
    if (nearest) return nearest.path;
  }
  for (let length = path.length - 1; length > 0; length--) {
    if (findSourceDeckNode(tree, path.slice(0, length))) return path.slice(0, length);
  }
  return [];
}

/** A rough signed distance between two paths: the first differing index, weighted by depth. */
function comparePaths(a: SourceDeckPath, b: SourceDeckPath): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1);
    if (diff !== 0) return diff * 100 ** (4 - Math.min(i, 4));
  }
  return 0;
}

const ELEMENT_NAMES: Record<SourceDeckNode["kind"], string> = {
  column: "Column", block: "Block", slide: "Slide", figure: "Figure", equation: "Equation", list: "List", table: "Table", columns: "Columns", text: "Text", code: "Code",
};

/** What a node is called in the structure panel, the breadcrumb and the properties: its title, else its kind (with its number for columns and slides). */
export function describeSourceDeckNode(node: SourceDeckNode, index: number): string {
  if (node.title) return readableTitle(node.title);
  if (node.kind === "column" || node.kind === "slide") return `${ELEMENT_NAMES[node.kind]} ${index + 1}`;
  return ELEMENT_NAMES[node.kind];
}

/** A LaTeX title as it reads on the slide: ellipses, ties, escaped characters and dashes, with text-style commands kept to their argument. */
function readableTitle(title: string): string {
  return title
    .replace(/\\(?:ldots|dots|textellipsis)\b(?:\{\})?/g, "…")
    .replace(/\\(?:emph|textbf|textit|textsc|texttt|alert|structure)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\([&%$#_])/g, "$1")
    .replace(/\\\\|~/g, " ")
    .replace(/---/g, "—").replace(/--/g, "–");
}

/** The breadcrumb of a path: "Poster" or "Talk", then each node's name ("Poster > Column 3 > Results"). */
export function sourceDeckBreadcrumb(tree: readonly SourceDeckNode[], kind: DeckKind, path: SourceDeckPath): string[] {
  const parts = [kind === "talk" ? "Talk" : "Poster"];
  let nodes: readonly SourceDeckNode[] | undefined = tree;
  for (const index of path) {
    const node: SourceDeckNode | undefined = nodes?.[index];
    if (!node) break;
    parts.push(describeSourceDeckNode(node, index));
    nodes = node.children;
  }
  return parts;
}
