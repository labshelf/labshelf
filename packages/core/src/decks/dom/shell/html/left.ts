// The deck workspace's left panel: a talk's Slides (the slide strip) and Elements (the current slide's blocks) tabs, or a poster's
// Structure (an overview and its blocks) and Elements (the blocks to insert) tabs.
import { renderElement, renderIcon, showMenu, type IconName } from "../../../../ui/dom/index.js";
import { applyDeckEdit, type DeckEdit } from "../../../deckEdit.js";
import { describeDeckBlock, type DeckBlockKind } from "../../../deckBlocks.js";
import { mountSlideStrip, type SlideStrip } from "../../slideStrip.js";
import { createDeckThumbnails, type DeckThumbnails } from "../../slideThumbnails.js";
import { canvasOf, insertBlock } from "./actions.js";
import { tabs } from "./fields.js";
import type { BlockInsertKind, ShellContext } from "./types.js";

const KIND_ICON: Record<DeckBlockKind, IconName> = { text: "text-box", image: "file-media", equation: "sigma", shape: "layers" };
const INSERTS: ReadonlyArray<readonly [BlockInsertKind, string, IconName]> = [
  ["text", "Text", "text-box"], ["image", "Image", "file-media"], ["equation", "Equation", "sigma"], ["rect", "Rectangle", "layers"], ["ellipse", "Ellipse", "layers"], ["line", "Line", "remove"],
];

type Tab = "slides" | "elements";

interface LeftState { ctx: ShellContext; tab: Tab; strip: SlideStrip | null; thumbnails: DeckThumbnails; overview: HTMLImageElement; overviewKey: string; body: HTMLElement; stripHost: HTMLElement }

/** The current slide's blocks as rows; a click selects, a double click edits the text. */
function blockRows(ctx: ShellContext): HTMLElement[] {
  const { model, slide, blocks, html } = ctx.view;
  return (model?.slides[slide]?.blocks ?? []).map((block) => {
    const { kind, label } = describeDeckBlock(html, block);
    const item = renderElement("button", { type: "button", class: "dw-tree-row", role: "treeitem", "aria-selected": String(blocks.includes(block.id)), title: block.id, html: renderIcon(KIND_ICON[kind]) });
    item.append(renderElement("span", { class: "dw-tree-label", text: label }));
    item.addEventListener("click", () => ctx.editor.selectBlocks([block.id]));
    item.addEventListener("dblclick", () => { if (kind === "text") ctx.editor.editText(block.id); });
    return item;
  });
}

function addButton(label: string, run: (anchor: HTMLElement) => void): HTMLButtonElement {
  const element = renderElement("button", { type: "button", class: "dw-new-slide", html: renderIcon("plus") });
  element.append(renderElement("span", { text: label }));
  element.addEventListener("click", () => run(element));
  return element;
}

const insertMenu = (ctx: ShellContext, anchor: HTMLElement): void =>
  showMenu(anchor, INSERTS.map(([kind, label, icon]) => ({ label, icon, disabled: kind === "image" && !ctx.options.pickImage, onSelect: () => void insertBlock(ctx, kind) })));

/** The strip edits keep the shown slide on the slide they made or moved. */
function stripEdit(ctx: ShellContext, edit: DeckEdit, label: string): void {
  ctx.edit([(html) => applyDeckEdit(html, edit)], label);
  const to = edit.kind === "addSlide" ? edit.at : edit.kind === "duplicateSlide" ? edit.slide + 1 : edit.kind === "deleteSlide" ? Math.max(0, edit.slide - 1) : edit.kind === "moveSlide" ? edit.to : undefined;
  if (to !== undefined) ctx.editor.selectSlide(to);
}

function syncStrip(ls: LeftState): void {
  const { ctx } = ls;
  const count = ctx.view.model?.slides.length ?? 0;
  if (ls.strip) return ls.strip.update(count, ctx.view.slide);
  ls.strip = mountSlideStrip(ls.stripHost, {
    count, current: ctx.view.slide, thumbnail: (index) => ls.thumbnails.thumbnail(index), onSelect: (index) => ctx.editor.selectSlide(index), onEdit: (edit, label) => stripEdit(ctx, edit, label),
    fallback: { size: () => canvasOf(ctx), srcdoc: (index) => ls.thumbnails.srcdoc(index) },
  });
}

function drawOverview(ls: LeftState): void {
  const key = `${ls.ctx.view.html.length}:${ls.ctx.view.html}|${ls.ctx.view.theme}`;
  if (key === ls.overviewKey) return;
  ls.overviewKey = key;
  void ls.thumbnails.thumbnail(0).then((url) => { if (url && ls.overviewKey === key) ls.overview.src = url; });
}

function palette(ctx: ShellContext): HTMLElement {
  return renderElement("div", { class: "dsh-palette" }, ...INSERTS.map(([kind, label, icon]) => {
    const item = renderElement("button", { type: "button", class: "dsh-palette-item", html: renderIcon(icon), disabled: kind === "image" && !ctx.options.pickImage });
    item.append(renderElement("span", { text: label }));
    item.addEventListener("click", () => void insertBlock(ctx, kind));
    return item;
  }));
}

function draw(ls: LeftState, root: HTMLElement): void {
  const { ctx } = ls;
  const talk = ctx.view.model?.kind !== "poster";
  const names = talk ? ([["slides", "Slides"], ["elements", "Elements"]] as const) : ([["slides", "Structure"], ["elements", "Elements"]] as const);
  const tabRow = tabs(names, ls.tab, (tab) => { ls.tab = tab; draw(ls, root); });
  ls.stripHost.hidden = !(talk && ls.tab === "slides");
  if (talk && ls.tab === "slides" && !ctx.view.readOnly) syncStrip(ls);
  let content: HTMLElement[];
  if (talk) content = ls.tab === "slides" ? [] : [renderElement("div", { class: "dw-tree", role: "tree", "aria-label": "Elements" }, ...blockRows(ctx)), addButton("Add element", (anchor) => insertMenu(ctx, anchor))];
  else if (ls.tab === "slides") { drawOverview(ls); content = [renderElement("div", { class: "dsh-overview" }, ls.overview), renderElement("div", { class: "dw-panel-heading", text: "Blocks" }), renderElement("div", { class: "dw-tree", role: "tree", "aria-label": "Blocks" }, ...blockRows(ctx)), addButton("Add block", (anchor) => insertMenu(ctx, anchor))]; }
  else content = [palette(ctx)];
  ls.body.replaceChildren(...content);
  root.replaceChildren(renderElement("div", { class: "dsh-left-head", text: talk ? "Talk" : "Poster" }), tabRow, ls.stripHost, ls.body);
}

export function createLeftPanel(ctx: ShellContext): { element: HTMLElement; render(): void; destroy(): void } {
  const element = renderElement("aside", { class: "dw-structure dsh-left", "aria-label": "Structure" });
  const thumbnails = createDeckThumbnails({ deck: () => ({ html: ctx.view.html, theme: ctx.view.theme, canvas: canvasOf(ctx) }), resolveAsset: ctx.options.resolveAsset, ...(ctx.options.assetOrigin ? { assetOrigin: ctx.options.assetOrigin } : {}) });
  const ls: LeftState = { ctx, tab: "slides", strip: null, thumbnails, overview: renderElement("img", { class: "dsh-overview-image", alt: "Poster overview" }), overviewKey: "", body: renderElement("div", { class: "dsh-left-body" }), stripHost: renderElement("div", { class: "dsh-strip" }) };
  let shown = "";
  return {
    element,
    render() {
      const { view } = ctx;
      // Rows are rebuilt only when what they show changed, so a double click lands on the row it started on.
      const key = `${view.slide}|${view.blocks.join()}|${view.readOnly}|${view.theme}|${view.html}`;
      if (key !== shown) { shown = key; draw(ls, element); }
    },
    destroy: () => ls.strip?.destroy(),
  };
}
