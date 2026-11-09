// The workspace's structure panel, a strip under the page while the code shows one unit at a time: a poster's Preamble, block cards and
// New block, or a talk's Preamble, slide thumbnails and New slide, with the selected slide's or block's elements elsewhere.
import { renderElement, renderIcon, showMenu, type IconName } from "../../../ui/dom/index.js";
import { BLOCK_LAYOUTS, SLIDE_LAYOUTS, describeSourceDeckNode, type BlockLayout, type DeckKind, type SlideLayout, type SourceDeckNode, type SourceDeckNodeKind, type SourceDeckPath } from "../../index.js";
import { attachFileDrop, type FileDrop } from "../../../ui/dom/projectFileDrag.js";
import type { PdfDeck } from "../pdfDeck.js";
import { drawPdfPage, overflowBadge } from "./slideGrid.js";

const KIND_ICON: Record<SourceDeckNodeKind, IconName> = {
  column: "layers", block: "text-box", slide: "file", figure: "file-media", equation: "sigma", list: "list", table: "table", columns: "grid", text: "heading", code: "code",
};
const THUMB_WIDTH = 160;

export interface StructurePanelHooks {
  select(path: SourceDeckPath): void;
  /** Shows the preamble (listed before the slides or blocks); absent, there is no Preamble row. */
  selectPreamble?(): void;
  newSlide(layout: SlideLayout): void;
  /** Adds a poster block of `layout`; absent, a poster has no New block card. */
  newBlock?(layout: BlockLayout): void;
  /** The first page each slide shows, 1-based; undefined before a build. */
  pageOfSlide(slide: number): number | undefined;
  /** Whether the last build marks the slide's content as overflowing it; absent, no slide is marked. */
  overflowOfSlide?(slide: number): boolean;
  /** Whether the last build marks a poster block (column and child index) as overflowing; absent, no block is marked. */
  overflowOfBlock?(column: number, block: number): boolean;
  /** Files dropped on a slide's thumbnail or a row (a project file or a uri list), with the row's path; absent, rows take no file drops. */
  dropImage?(path: SourceDeckPath, drop: FileDrop): void;
}

export interface StructurePanel {
  element: HTMLElement;
  /** `preamble`: the Preamble row is the selected one. */
  render(tree: readonly SourceDeckNode[], selected: SourceDeckPath, preamble?: boolean): void;
  /** Draws a talk's thumbnails from a newly opened PDF. */
  setPdf(pdf: PdfDeck | undefined): void;
}

const samePath = (a: SourceDeckPath, b: SourceDeckPath): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const startsWith = (path: SourceDeckPath, prefix: SourceDeckPath): boolean => prefix.length <= path.length && prefix.every((v, i) => v === path[i]);

/** Makes `item` take file drops for the node at `path` when the panel has a dropImage hook. */
function takeDrops(item: HTMLElement, hooks: StructurePanelHooks, path: SourceDeckPath): void {
  const { dropImage } = hooks;
  attachFileDrop(item, dropImage && ((drop) => dropImage(path, drop)));
}

function row(node: SourceDeckNode, index: number, path: SourceDeckPath, depth: number, selected: SourceDeckPath, hooks: StructurePanelHooks): HTMLElement {
  const item = renderElement("button", { type: "button", class: "dw-tree-row", role: "treeitem", "data-kind": node.kind, "aria-selected": String(samePath(path, selected)), title: `Line ${node.line}` });
  item.style.paddingLeft = `${8 + depth * 14}px`;
  item.insertAdjacentHTML("afterbegin", renderIcon(KIND_ICON[node.kind]));
  item.append(renderElement("span", { class: "dw-tree-label", text: describeSourceDeckNode(node, index) }));
  item.addEventListener("click", () => hooks.select(path));
  takeDrops(item, hooks, path);
  return item;
}

/** What one structure panel keeps between renders. */
interface StructureState {
  kind: DeckKind;
  hooks: StructurePanelHooks;
  list: HTMLElement;
  elements: HTMLElement;
  elementsHeading: HTMLElement;
  pdf: PdfDeck | undefined;
  tree: readonly SourceDeckNode[];
  selected: SourceDeckPath;
  preamble: boolean;
  thumbs: Map<number, HTMLCanvasElement>;
}

function thumbOf(ss: StructureState, slide: number): HTMLCanvasElement {
  let canvas = ss.thumbs.get(slide);
  if (!canvas) { canvas = renderElement("canvas", { class: "dw-thumb-canvas" }); ss.thumbs.set(slide, canvas); }
  return canvas;
}

/** The Preamble row before the slides or blocks: the lines before the first one. */
function preambleRow(ss: StructureState): HTMLElement[] {
  const { selectPreamble } = ss.hooks;
  if (!selectPreamble) return [];
  const item = renderElement("button", { type: "button", class: "dw-tree-row dw-preamble", role: "treeitem", "aria-selected": String(ss.preamble), title: "Packages, theme and title page settings" });
  item.insertAdjacentHTML("afterbegin", renderIcon("code"));
  item.append(renderElement("span", { class: "dw-tree-label", text: "Preamble" }));
  item.addEventListener("click", () => selectPreamble());
  return [item];
}

function renderSlides(ss: StructureState): void {
  const { hooks, selected } = ss;
  ss.list.replaceChildren(...preambleRow(ss), ...ss.tree.flatMap((node, index) => {
    if (node.kind !== "slide") return [];
    const canvas = thumbOf(ss, index);
    const item = renderElement("button", { type: "button", class: "dw-thumb", role: "treeitem", "aria-selected": String(selected[0] === index), title: describeSourceDeckNode(node, index) },
      renderElement("span", { class: "dw-thumb-number", text: String(index + 1) }), renderElement("span", { class: "dw-thumb-frame" }, canvas),
      renderElement("span", { class: "dw-thumb-title", text: describeSourceDeckNode(node, index) }), ...(hooks.overflowOfSlide?.(index) ? [overflowBadge()] : []));
    item.addEventListener("click", () => hooks.select([index]));
    takeDrops(item, hooks, [index]);
    return [item];
  }));
  ss.list.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** A poster's block cards: the Preamble, one card per block with its title and its column's number, then New block. */
function renderBlocks(ss: StructureState): void {
  const { selected, hooks } = ss;
  let columnNumber = 0;
  const cards = ss.tree.flatMap((column, c) => {
    if (column.kind !== "column") return [];
    columnNumber++;
    return (column.children ?? []).flatMap((block, b) => {
      if (block.kind !== "block") return [];
      const title = describeSourceDeckNode(block, b);
      const item = renderElement("button", { type: "button", class: "dw-block-card", role: "treeitem", "aria-selected": String(selected[0] === c && selected[1] === b), title: `${title} · column ${columnNumber}` },
        renderElement("span", { class: "dw-thumb-number", text: String(columnNumber), title: `Column ${columnNumber}` }), renderElement("span", { class: "dw-block-card-title", text: title }));
      if (hooks.overflowOfBlock?.(c, b)) { const badge = overflowBadge(); badge.title = "Content overflows this block"; item.append(badge); }
      item.addEventListener("click", () => hooks.select([c, b]));
      takeDrops(item, hooks, [c, b]);
      return [item];
    });
  });
  ss.list.replaceChildren(...preambleRow(ss), ...cards);
  ss.list.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** The New slide or New block card after the list, which opens the layout menu. */
function newCard(kind: DeckKind, hooks: StructurePanelHooks): HTMLElement[] {
  const { newBlock } = hooks;
  if (kind === "poster" && !newBlock) return [];
  const button = renderElement("button", { type: "button", class: "dw-new-slide", html: renderIcon("plus") });
  button.append(renderElement("span", { text: kind === "talk" ? "New slide" : "New block" }));
  button.addEventListener("click", () => showMenu(button, kind === "talk"
    ? SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => hooks.newSlide(layout.id) }))
    : BLOCK_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newBlock!(layout.id) }))));
  return [button];
}

function renderElements(ss: StructureState): void {
  const { selected, hooks } = ss;
  // The elements of the selected slide or block, one level down.
  const ownerPath = ss.kind === "talk" ? selected.slice(0, 1) : selected.slice(0, 2);
  let owner: SourceDeckNode | undefined;
  let nodes: readonly SourceDeckNode[] | undefined = ss.tree;
  for (const index of ownerPath) { owner = nodes?.[index]; nodes = owner?.children; }
  const children = owner && (owner.kind === "slide" || owner.kind === "block") ? owner.children ?? [] : [];
  ss.elementsHeading.hidden = children.length === 0;
  ss.elements.replaceChildren(...children.map((child, i) => row(child, i, [...ownerPath, i], 0, startsWith(selected, [...ownerPath, i]) ? [...ownerPath, i] : [], hooks)));
}

async function drawThumbs(ss: StructureState, current: PdfDeck): Promise<void> {
  for (const [slide, canvas] of ss.thumbs) {
    const page = ss.hooks.pageOfSlide(slide);
    if (ss.pdf !== current) return;
    if (page !== undefined) await drawPdfPage(current, canvas, page, THUMB_WIDTH);
  }
}

export function createStructurePanel(kind: DeckKind, hooks: StructurePanelHooks): StructurePanel {
  const heading = renderElement("div", { class: "dw-panel-heading", text: kind === "talk" ? "Slides" : "Blocks" });
  const list = renderElement("div", { class: "dw-tree", role: "tree", "aria-label": kind === "talk" ? "Slides" : "Blocks" });
  const elementsHeading = renderElement("div", { class: "dw-panel-heading dw-elements-heading", text: "Elements" });
  const elements = renderElement("div", { class: "dw-tree dw-elements", role: "tree", "aria-label": "Elements" });
  const element = renderElement("aside", { class: "dw-structure", "aria-label": "Structure" }, heading, list, ...newCard(kind, hooks), elementsHeading, elements);
  const ss: StructureState = { kind, hooks, list, elements, elementsHeading, pdf: undefined, tree: [], selected: [], preamble: false, thumbs: new Map() };

  return {
    element,
    render(nextTree, nextSelected, preamble = false) {
      ss.tree = nextTree; ss.selected = nextSelected; ss.preamble = preamble;
      if (kind === "talk") renderSlides(ss); else renderBlocks(ss);
      renderElements(ss);
    },
    setPdf(next) {
      ss.pdf = next;
      // A talk strip's Preamble and New slide cards take the slides' ratio; a poster's cards keep the default.
      const size = next?.pageSize(0);
      if (size && kind === "talk") element.style.setProperty("--dw-slide-ratio", `${size.width} / ${size.height}`);
      if (next && kind === "talk") { renderSlides(ss); void drawThumbs(ss, next); }
    },
  };
}
