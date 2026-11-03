// The workspace's left panel: a poster's columns, blocks and the selected block's elements with an overview of the page, or a talk's
// slide thumbnails with New slide and the selected slide's elements.
import { renderElement, renderIcon, showMenu, type IconName } from "../../../ui/dom/index.js";
import { SLIDE_LAYOUTS, describeSourceDeckNode, type DeckKind, type SlideLayout, type SourceDeckNode, type SourceDeckNodeKind, type SourceDeckPath } from "../../index.js";
import type { PdfDeck } from "../pdfDeck.js";

const KIND_ICON: Record<SourceDeckNodeKind, IconName> = {
  column: "layers", block: "text-box", slide: "file", figure: "file-media", equation: "sigma", list: "list", table: "table", columns: "grid", text: "heading", code: "code",
};
const THUMB_WIDTH = 160;
const OVERVIEW_WIDTH = 220;

export interface StructurePanelHooks {
  select(path: SourceDeckPath): void;
  newSlide(layout: SlideLayout): void;
  /** The first page each slide shows, 1-based; undefined before a build. */
  pageOfSlide(slide: number): number | undefined;
}

export interface StructurePanel {
  element: HTMLElement;
  render(tree: readonly SourceDeckNode[], selected: SourceDeckPath): void;
  /** Draws the thumbnails (talk) or the overview (poster) from a newly opened PDF. */
  setPdf(pdf: PdfDeck | undefined): void;
}

const samePath = (a: SourceDeckPath, b: SourceDeckPath): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const startsWith = (path: SourceDeckPath, prefix: SourceDeckPath): boolean => prefix.length <= path.length && prefix.every((v, i) => v === path[i]);

function row(node: SourceDeckNode, index: number, path: SourceDeckPath, depth: number, selected: SourceDeckPath, select: (path: SourceDeckPath) => void): HTMLElement {
  const item = renderElement("button", { type: "button", class: "dw-tree-row", role: "treeitem", "data-kind": node.kind, "aria-selected": String(samePath(path, selected)), title: `Line ${node.line}` });
  item.style.paddingLeft = `${8 + depth * 14}px`;
  item.insertAdjacentHTML("afterbegin", renderIcon(KIND_ICON[node.kind]));
  item.append(renderElement("span", { class: "dw-tree-label", text: describeSourceDeckNode(node, index) }));
  item.addEventListener("click", () => select(path));
  return item;
}

async function drawPage(pdf: PdfDeck, canvas: HTMLCanvasElement, page: number, width: number): Promise<void> {
  const size = pdf.pageSize(page - 1);
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  await pdf.render(canvas, page - 1, (width / size.width) * ratio).catch(() => undefined);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${(size.height / size.width) * width}px`;
}

export function createStructurePanel(kind: DeckKind, hooks: StructurePanelHooks): StructurePanel {
  const heading = renderElement("div", { class: "dw-panel-heading", text: kind === "talk" ? "Slides" : "Blocks" });
  const list = renderElement("div", { class: "dw-tree", role: "tree", "aria-label": kind === "talk" ? "Slides" : "Blocks" });
  const elementsHeading = renderElement("div", { class: "dw-panel-heading", text: "Elements" });
  const elements = renderElement("div", { class: "dw-tree", role: "tree", "aria-label": "Elements" });
  const overviewCanvas = renderElement("canvas", { class: "dw-overview-canvas" });
  const overview = renderElement("div", { class: "dw-overview", hidden: true }, renderElement("div", { class: "dw-panel-heading", text: "Overview" }), overviewCanvas);
  const newSlide = renderElement("button", { type: "button", class: "dw-new-slide", html: renderIcon("plus") });
  newSlide.append(renderElement("span", { text: "New slide" }));
  newSlide.addEventListener("click", () => showMenu(newSlide, SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => hooks.newSlide(layout.id) }))));
  const element = renderElement("aside", { class: "dw-structure", "aria-label": "Structure" }, heading, list, ...(kind === "talk" ? [newSlide] : []), elementsHeading, elements, overview);
  let pdf: PdfDeck | undefined;
  let tree: readonly SourceDeckNode[] = [];
  let selected: SourceDeckPath = [];
  const thumbs = new Map<number, HTMLCanvasElement>();

  const thumbOf = (slide: number): HTMLCanvasElement => {
    let canvas = thumbs.get(slide);
    if (!canvas) { canvas = renderElement("canvas", { class: "dw-thumb-canvas" }); thumbs.set(slide, canvas); }
    return canvas;
  };

  function renderSlides(): void {
    list.replaceChildren(...tree.flatMap((node, index) => {
      if (node.kind !== "slide") return [];
      const canvas = thumbOf(index);
      const item = renderElement("button", { type: "button", class: "dw-thumb", role: "treeitem", "aria-selected": String(selected[0] === index), title: describeSourceDeckNode(node, index) },
        renderElement("span", { class: "dw-thumb-number", text: String(index + 1) }), renderElement("span", { class: "dw-thumb-frame" }, canvas),
        renderElement("span", { class: "dw-thumb-title", text: describeSourceDeckNode(node, index) }));
      item.addEventListener("click", () => hooks.select([index]));
      return [item];
    }));
    list.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView?.({ block: "nearest" });
  }

  function renderBlocks(): void {
    list.replaceChildren(...tree.flatMap((column, c) => column.kind !== "column" ? [] : [
      row(column, c, [c], 0, selected, hooks.select),
      ...(column.children ?? []).flatMap((block, b) => block.kind === "block" ? [row(block, b, [c, b], 1, selected, hooks.select)] : []),
    ]));
  }

  function renderElements(): void {
    // The elements of the selected slide or block, one level down.
    const ownerPath = kind === "talk" ? selected.slice(0, 1) : selected.slice(0, 2);
    let owner: SourceDeckNode | undefined;
    let nodes: readonly SourceDeckNode[] | undefined = tree;
    for (const index of ownerPath) { owner = nodes?.[index]; nodes = owner?.children; }
    const children = owner && (owner.kind === "slide" || owner.kind === "block") ? owner.children ?? [] : [];
    elementsHeading.hidden = children.length === 0;
    elements.replaceChildren(...children.map((child, i) => row(child, i, [...ownerPath, i], 0, startsWith(selected, [...ownerPath, i]) ? [...ownerPath, i] : [], hooks.select)));
  }

  async function drawThumbs(current: PdfDeck): Promise<void> {
    for (const [slide, canvas] of thumbs) {
      const page = hooks.pageOfSlide(slide);
      if (pdf !== current) return;
      if (page !== undefined) await drawPage(current, canvas, page, THUMB_WIDTH);
    }
  }

  return {
    element,
    render(nextTree, nextSelected) {
      tree = nextTree; selected = nextSelected;
      if (kind === "talk") renderSlides(); else renderBlocks();
      renderElements();
    },
    setPdf(next) {
      pdf = next;
      overview.hidden = kind === "talk" || !next;
      if (!next) return;
      if (kind === "talk") { renderSlides(); void drawThumbs(next); } else void drawPage(next, overviewCanvas, 1, OVERVIEW_WIDTH);
    },
  };
}
