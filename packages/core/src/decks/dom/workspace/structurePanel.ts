// A talk's slide strip under the page while the code shows one unit at a time: the Preamble, the slides and the section dividers the build
// shipped between them, each with its page, then New slide.
import { attachFileDrop, renderElement, renderIcon, showMenu, type FileDrop } from "../../../ui/dom/index.js";
import { SLIDE_LAYOUTS, describeSourceDeckNode, type SlideLayout, type SourceDeckNode, type SourceDeckPath } from "../../index.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { PageSection } from "./linking.js";
import { drawPdfPage, overflowBadge, sectionCard, sectionKey, type StripUnit } from "./slideGrid.js";

const THUMB_WIDTH = 160;

export interface StructurePanelHooks {
  select(path: SourceDeckPath): void;
  selectPreamble(): void;
  selectSection(section: PageSection): void;
  newSlide(layout: SlideLayout): void;
  /** The first page each slide shows, 1-based; undefined before a build. */
  pageOfSlide(slide: number): number | undefined;
  /** The slides and the section dividers between them, in page order. */
  units(): StripUnit[];
  /** Whether the last build marks the slide's content as overflowing it; absent, no slide is marked. */
  overflowOfSlide?(slide: number): boolean;
  /** Files dropped on a slide's thumbnail (a project file or a uri list); absent, thumbnails take no file drops. */
  dropImage?(path: SourceDeckPath, drop: FileDrop): void;
}

export interface StructurePanel {
  element: HTMLElement;
  /** `preamble`: the Preamble card is the selected one. */
  render(tree: readonly SourceDeckNode[], selected: SourceDeckPath, preamble?: boolean): void;
  /** Draws the thumbnails from a newly opened PDF. */
  setPdf(pdf: PdfDeck | undefined): void;
}

/** What one strip keeps between renders. */
interface StripState {
  hooks: StructurePanelHooks;
  list: HTMLElement;
  pdf: PdfDeck | undefined;
  tree: readonly SourceDeckNode[];
  selected: SourceDeckPath;
  preamble: boolean;
  /** Each card's page, by slide index or section key. */
  thumbs: Map<string, HTMLCanvasElement>;
}

const keyOf = (unit: StripUnit): string => (unit.kind === "slide" ? String(unit.index) : `s:${sectionKey(unit.section)}`);

function thumbOf(ss: StripState, key: string): HTMLCanvasElement {
  let canvas = ss.thumbs.get(key);
  if (!canvas) { canvas = renderElement("canvas", { class: "dw-thumb-canvas" }); ss.thumbs.set(key, canvas); }
  return canvas;
}

/** The Preamble card before the slides: the lines before the first one. */
function preambleCard(ss: StripState): HTMLElement {
  const item = renderElement("button", { type: "button", class: "dw-preamble", role: "treeitem", "aria-selected": String(ss.preamble), title: "Packages, theme and title page settings" });
  item.insertAdjacentHTML("afterbegin", renderIcon("code"));
  item.append(renderElement("span", { text: "Preamble" }));
  item.addEventListener("click", () => ss.hooks.selectPreamble());
  return item;
}

function slideCard(ss: StripState, index: number, selected: boolean): HTMLElement {
  const { hooks } = ss;
  const node = ss.tree[index]!;
  const title = describeSourceDeckNode(node, index);
  const item = renderElement("button", { type: "button", class: "dw-thumb", role: "treeitem", "aria-selected": String(selected), title },
    renderElement("span", { class: "dw-thumb-number", text: String(index + 1) }), renderElement("span", { class: "dw-thumb-frame" }, thumbOf(ss, String(index))),
    renderElement("span", { class: "dw-thumb-title", text: title }), ...(hooks.overflowOfSlide?.(index) ? [overflowBadge()] : []));
  item.addEventListener("click", () => hooks.select([index]));
  attachFileDrop(item, hooks.dropImage && ((drop) => hooks.dropImage!([index], drop)));
  return item;
}

function renderStrip(ss: StripState): void {
  const units = ss.hooks.units();
  const known = new Set(units.map(keyOf));
  for (const key of ss.thumbs.keys()) if (!known.has(key)) ss.thumbs.delete(key);
  const onSection = ss.preamble || units.some((unit) => unit.kind === "section" && unit.selected);
  ss.list.replaceChildren(preambleCard(ss), ...units.map((unit) => (unit.kind === "section"
    ? sectionCard(unit, thumbOf(ss, keyOf(unit)), "dw-thumb", ss.hooks.selectSection)
    : slideCard(ss, unit.index, !onSection && ss.selected[0] === unit.index))));
  ss.list.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

async function drawThumbs(ss: StripState, current: PdfDeck): Promise<void> {
  for (const unit of ss.hooks.units()) {
    if (ss.pdf !== current) return;
    const page = unit.kind === "slide" ? ss.hooks.pageOfSlide(unit.index) : unit.page;
    if (page !== undefined) await drawPdfPage(current, thumbOf(ss, keyOf(unit)), page, THUMB_WIDTH);
  }
}

export function createStructurePanel(hooks: StructurePanelHooks): StructurePanel {
  const list = renderElement("div", { class: "dw-tree", role: "tree", "aria-label": "Slides" });
  const newSlide = renderElement("button", { type: "button", class: "dw-new-slide", html: renderIcon("plus") });
  newSlide.append(renderElement("span", { text: "New slide" }));
  newSlide.addEventListener("click", () => showMenu(newSlide, SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => hooks.newSlide(layout.id) }))));
  const element = renderElement("aside", { class: "dw-structure", "aria-label": "Slides" }, list, newSlide);
  const ss: StripState = { hooks, list, pdf: undefined, tree: [], selected: [], preamble: false, thumbs: new Map() };

  return {
    element,
    render(nextTree, nextSelected, preamble = false) {
      ss.tree = nextTree; ss.selected = nextSelected; ss.preamble = preamble;
      renderStrip(ss);
    },
    setPdf(next) {
      ss.pdf = next;
      // The Preamble and New slide cards take the slides' ratio.
      const size = next?.pageSize(0);
      if (size) element.style.setProperty("--dw-slide-ratio", `${size.width} / ${size.height}`);
      if (next) { renderStrip(ss); void drawThumbs(ss, next); }
    },
  };
}
