// The deck workspace's properties panel: the selected block's kind with Style and Arrange tabs (position and size in px, or cm on a
// poster, with a locked aspect, alignment on the slide, order, duplicate and delete); with several, align, distribute, group and delete;
// with nothing selected, the slide's title and a hint (the Style panel edits the deck's look).
import { renderElement } from "../../../../ui/dom/index.js";
import { describeDeckBlock } from "../../../deckBlocks.js";
import type { DeckBlock, DeckRect } from "../../../deckParse.js";
import { alignSelected, deleteSelected, duplicateSelected, orderSelected, placeBlock, selectedBlock, type AlignSide } from "./actions.js";
import { alignBlocks, distributeBlocks, groupSelected, selectedGroups, ungroupSelected, unitCount } from "./arrange.js";
import { button, field, grid, input, row, section, tabs, toggle } from "./fields.js";
import { styleTab } from "./propsStyle.js";
import type { ShellContext } from "./types.js";

const PX_PER_CM = 96 / 2.54;
const KIND_TITLE = { text: "Text", image: "Image", equation: "Equation", shape: "Shape", chart: "Chart" } as const;
const SIDES: ReadonlyArray<readonly [AlignSide, string]> = [["left", "Left"], ["center", "Centre"], ["right", "Right"], ["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]];

interface PanelState { tab: "style" | "arrange"; lock: boolean; key: string }

function geometry(ctx: ShellContext, block: DeckBlock & { rect: DeckRect }, ps: PanelState, redraw: () => void): HTMLElement {
  const poster = ctx.view.model?.kind === "poster";
  const unit = poster ? "cm" : "px";
  const shown = (px: number): string => String(poster ? Math.round((px / PX_PER_CM) * 10) / 10 : Math.round(px));
  const fromUnit = (value: string): number => Math.round((poster ? Number(value) * PX_PER_CM : Number(value)) * 100) / 100;
  const rect = block.rect;
  const side = (name: keyof DeckRect, label: string): HTMLElement => field(`${label} (${unit})`, input("number", shown(rect[name]), (value) => {
    const next = { ...rect, [name]: fromUnit(value) };
    if (ps.lock && name === "width") next.height = Math.round((next.width * rect.height) / rect.width);
    if (ps.lock && name === "height") next.width = Math.round((next.height * rect.width) / rect.height);
    placeBlock(ctx, block.id, next);
  }, { step: poster ? "0.1" : "1" }));
  const lock = toggle({ icon: "lock" }, "Keep the aspect ratio", ps.lock, () => { ps.lock = !ps.lock; redraw(); });
  return section("Position and size", grid(side("left", "X"), side("top", "Y"), side("width", "Width"), side("height", "Height")), row(lock, renderElement("span", { class: "dw-field-label", text: "Keep aspect ratio" })));
}

function arrangeTab(ctx: ShellContext, block: DeckBlock, ps: PanelState, redraw: () => void): HTMLElement[] {
  return [
    ...(block.rect ? [geometry(ctx, block as DeckBlock & { rect: DeckRect }, ps, redraw)] : []),
    section(ctx.view.model?.kind === "poster" ? "Align on the poster" : "Align on the slide", row(...SIDES.map(([side, label]) => toggle({ text: label }, `Align ${label.toLowerCase()}`, false, () => alignSelected(ctx, side))))),
    section("Order", grid(button("Bring to front", () => orderSelected(ctx, "front")), button("Send to back", () => orderSelected(ctx, "back")))),
    section("Block", grid(button("Duplicate", () => duplicateSelected(ctx), "copy"), button("Delete", () => deleteSelected(ctx), "trash"))),
  ];
}

function disabled<T extends HTMLButtonElement>(element: T, off: boolean): T {
  element.disabled = off;
  return element;
}

/** Several selected blocks: align them to the selection, distribute 3 or more units, group or ungroup, delete. */
function severalSelected(ctx: ShellContext): HTMLElement[] {
  const few = unitCount(ctx) < 3;
  return [renderElement("div", { class: "dw-props-title", text: `${ctx.view.blocks.length} blocks` }),
    section("Align", row(...SIDES.map(([side, label]) => toggle({ text: label }, `Align ${label.toLowerCase()}`, false, () => alignBlocks(ctx, side))))),
    section("Distribute", grid(disabled(button("Horizontally", () => distributeBlocks(ctx, "x")), few), disabled(button("Vertically", () => distributeBlocks(ctx, "y")), few))),
    section("Group", grid(button("Group", () => groupSelected(ctx)), disabled(button("Ungroup", () => ungroupSelected(ctx)), selectedGroups(ctx).length === 0))),
    section("Blocks", button("Delete", () => deleteSelected(ctx), "trash"))];
}

function nothingSelected(ctx: ShellContext): HTMLElement[] {
  const title = ctx.view.model?.kind === "poster" ? "Poster" : "Slide";
  return [renderElement("div", { class: "dw-props-title", text: title }),
    renderElement("p", { class: "dw-props-note", text: "Click a block to edit its style and position. Double-click edits its text." })];
}

function blockPanel(ctx: ShellContext, block: DeckBlock, ps: PanelState, redraw: () => void): HTMLElement[] {
  const { kind } = describeDeckBlock(ctx.view.html, block);
  const head = renderElement("div", { class: "dw-props-title" }, renderElement("span", { text: KIND_TITLE[kind] }), renderElement("span", { class: "dw-props-crumb", text: block.id }));
  const tabRow = tabs([["style", "Style"], ["arrange", "Arrange"]] as const, ps.tab, (tab) => { ps.tab = tab; redraw(); });
  return [head, tabRow, ...(ps.tab === "style" ? styleTab(ctx, block) : arrangeTab(ctx, block, ps, redraw))];
}

export interface PropertiesPanel { element: HTMLElement; render(): void }

export function createPropertiesPanel(ctx: ShellContext): PropertiesPanel {
  const element = renderElement("aside", { class: "dw-props dsh-props", "aria-label": "Properties" });
  const ps: PanelState = { tab: "style", lock: false, key: "" };
  const draw = (): void => {
    if (ctx.view.readOnly || !ctx.view.model) return void element.replaceChildren(renderElement("p", { class: "dw-props-note", text: "Fix the deck's problems to edit its blocks." }));
    const block = selectedBlock(ctx);
    element.replaceChildren(...(block ? blockPanel(ctx, block, ps, draw) : ctx.view.blocks.length > 1 ? severalSelected(ctx) : nothingSelected(ctx)));
  };
  return {
    element,
    render() {
      const { view } = ctx;
      const block = selectedBlock(ctx);
      const key = `${view.blocks.join()}|${block ? view.html.slice(block.range.from, block.range.to) : view.blocks.length > 1 ? view.html : ""}|${view.slide}|${view.readOnly}`;
      // Keep the fields, and the one being typed in, while the panel's own block did not change.
      if (key === ps.key) return;
      ps.key = key;
      draw();
    },
  };
}
