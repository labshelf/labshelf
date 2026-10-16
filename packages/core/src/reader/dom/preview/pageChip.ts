// Shows how many body pages the shown PDF has against the project's page limit, and reports the count to the host once per PDF.
import { arcMarkElement } from "../../../ui/dom/index.js";
import type { ArcTone } from "../../../ui/index.js";
import type { PreviewRoots, WebviewToHost } from "../../index.js";

interface PageChipDeps {
  /** The toolbar slot; the chip is its last child. */
  actions: HTMLElement;
  post: (msg: WebviewToHost) => void;
  countBodyPages: () => Promise<number>;
}

function toneOf(pages: number, limit: number): ArcTone {
  return pages > limit ? "err" : pages === limit ? "warn" : "ok";
}

export class PageChip {
  private mark: HTMLElement | null = null;
  private roots: PreviewRoots | null = null;
  private counted: { root: string; pages: number } | null = null;
  // False from a document change until the shown root is counted again.
  private fresh = false;
  // INVARIANT: only the count started last may report, so a count of a replaced document or root never lands.
  private generation = 0;
  private counting: string | null = null;

  constructor(private readonly deps: PageChipDeps) {}

  setRoots(roots: PreviewRoots): void {
    this.roots = roots;
    this.refresh();
  }

  /** The open document was replaced; the shown root is counted again. */
  documentChanged(): void {
    this.fresh = false;
    this.generation++;
    this.counting = null;
    this.refresh();
  }

  private refresh(): void {
    const { roots, counted } = this;
    if (!roots || roots.pageLimit === undefined) { return this.render(null); }
    if (counted?.root === roots.shown) { this.render(counted.pages, roots.pageLimit); } else { this.render(null); }
    if (this.fresh && counted?.root === roots.shown) { return; }
    if (this.counting === roots.shown) { return; }
    void this.count(roots.shown);
  }

  private async count(root: string): Promise<void> {
    const generation = ++this.generation;
    this.counting = root;
    try {
      const pages = await this.deps.countBodyPages();
      if (generation !== this.generation) { return; }
      this.counting = null;
      this.fresh = true;
      this.counted = { root, pages };
      this.deps.post({ command: "bodyPages", root, contentPages: pages });
      this.refresh();
    } catch (err) {
      if (generation !== this.generation) { return; }
      this.counting = null;
      console.warn(`LabShelf reader: could not count the body pages of ${root}`, err);
      this.render(null);
    }
  }

  private render(pages: number | null, limit = 0): void {
    this.mark?.remove();
    this.mark = null;
    if (pages === null) { return; }
    this.mark = arcMarkElement(toneOf(pages, limit), "full", `${pages} of ${limit}`);
    this.deps.actions.append(this.mark);
  }
}
