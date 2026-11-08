// Which slides of a talk overflow: LaTeX frames holding an Overfull \vbox line, Typst slides that spill onto extra pages (D10).
import type { SourceDeckNode } from "./sourceDeckBlocks.js";
import { sameSourcePath } from "./sourceDeckFiles.js";

/** Where a build reported content taller than the page: the project-relative '/' path of the source file and the 1-based line. */
export interface DeckOverflowMark { file: string; line: number }

/** The tree indexes of the slides whose lines (in their own file, the main file when a node names none) hold a mark. */
export function overfullSlides(tree: readonly SourceDeckNode[], marks: readonly DeckOverflowMark[], mainPath: string): Set<number> {
  const marked = new Set<number>();
  tree.forEach((node, index) => {
    if (node.kind !== "slide") return;
    const file = node.file ?? mainPath;
    if (marks.some((mark) => node.line <= mark.line && mark.line <= node.endLine && sameSourcePath(mark.file, file, "/"))) marked.add(index);
  });
  return marked;
}

// A Typst slide with overlays makes several pages on purpose.
const OVERLAY = /#(?:pause|uncover|only|meanwhile|alternatives|one-by-one)(?![\w-])|(?<![\w#-])pause(?![\w-])/;

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The tree indexes of the Typst slides that take more than one page without overlays, found by walking the page texts for the slide
 * titles; empty when the pages do not outnumber the slides or a titled slide cannot be found (unknown). */
export function spilledTypstSlides(tree: readonly SourceDeckNode[], textOf: (file: string | undefined) => string, pageTexts: readonly string[]): Set<number> {
  const slides = tree.flatMap((node, index) => (node.kind === "slide" ? [index] : []));
  if (pageTexts.length <= slides.length) return new Set();
  const pages = pageTexts.map(collapse);
  const firsts: number[] = [];
  let previous = -1;
  for (const index of slides) {
    const title = tree[index]!.title === undefined ? "" : collapse(tree[index]!.title!);
    let first = previous + 1;
    if (title) {
      while (first < pages.length && !pages[first]!.includes(title)) first += 1;
      if (first >= pages.length) return new Set();
    }
    firsts.push(first);
    previous = first;
  }
  const spilled = new Set<number>();
  const sources = new Map<string | undefined, string>();
  slides.forEach((index, at) => {
    const next = firsts[at + 1] ?? pageTexts.length;
    if (next - firsts[at]! <= 1) return;
    const node = tree[index]!;
    if (!sources.has(node.file)) sources.set(node.file, textOf(node.file));
    if (!OVERLAY.test(sources.get(node.file)!.slice(node.range[0], node.range[1]))) spilled.add(index);
  });
  return spilled;
}
