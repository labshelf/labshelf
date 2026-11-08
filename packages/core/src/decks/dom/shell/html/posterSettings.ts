// Poster Settings of an HTML poster, shown in the properties column in place of the properties: size presets and a custom size, the
// orientation switch, and on a sectioned poster the columns, margins, header height and text size; with one section selected, its content
// actions. Every change is one undo step; the fields show the current theme's settings on every refresh.
import { renderElement } from "../../../../ui/dom/index.js";
import { applyDeckEdit, type DeckEditResult } from "../../../deckEdit.js";
import { parseDeck } from "../../../deckParse.js";
import { isDeckSizeAllowed, listDeckSizePresets, type DeckSize } from "../../../deckSizes.js";
import { findDeckBlock } from "../../../deckStyle.js";
import { posterCanvas, readPosterLayout, readPosterSettings, POSTER_MAX_COLUMNS, type PosterLayout, type PosterSettings } from "../../../posterSections.js";
import { addPosterFigure, addPosterSection, movePosterSection, setPosterSettings, switchPosterOrientation, type PosterEditResult } from "../../../posterSectionEdits.js";
import { button, field, input, row, section, select, toggle } from "./fields.js";
import type { ShellContext } from "./types.js";
import { sameSize } from "../../../deckSizes.js";
import { commitPosterEdit } from "./posterStage.js";

type PosterSettingsChange = Parameters<typeof setPosterSettings>[2];

const CUSTOM = "custom";
const SIZE_MESSAGE = "Poster sizes are 100 to 2438.4 mm (3.9 to 96 in) per side.";
const TEXT_SIZES: ReadonlyArray<readonly [string, number]> = [["Small", 0.85], ["Medium", 1], ["Large", 1.2]];
const PX_PER_CM = 96 / 2.54;

/** What the panel keeps between refreshes: whether Custom is chosen, the custom size being typed and the size error. */
interface PanelState { custom: boolean; draft: DeckSize | null; error: string }

const cmText = (px: number): string => (px / PX_PER_CM).toFixed(1);

/** Resizes the poster: reflowing its sections when it has any, else through the plain size edit with the blocks scaled. */
function applySize(ctx: ShellContext, size: DeckSize, sectioned: boolean, label: string): void {
  if (sectioned) commitPosterEdit(ctx, setPosterSettings(ctx.view.html, ctx.view.theme, { size }), label);
  else ctx.edit([(html) => applyDeckEdit(html, { kind: "setSize", size, scale: true })], label);
}

function sizeSection(ctx: ShellContext, state: PanelState, size: DeckSize, sectioned: boolean, refresh: () => void): HTMLElement {
  const presets = listDeckSizePresets("poster");
  const matching = presets.find((preset) => sameSize(preset.size, size));
  const custom = state.custom || !matching;
  const presetSelect = select([...presets.map((preset) => [preset.label, preset.id] as const), ["Custom", CUSTOM] as const], custom ? CUSTOM : matching!.id, (value) => {
    const preset = presets.find((candidate) => candidate.id === value);
    state.error = "";
    if (!preset) {
      state.custom = true;
      state.draft = { ...size };
      refresh();
      return;
    }
    state.custom = false;
    state.draft = null;
    applySize(ctx, preset.size, sectioned, "Change poster size");
  });
  presetSelect.setAttribute("aria-label", "Size preset");
  const children: HTMLElement[] = [presetSelect];
  if (custom) children.push(customFields(ctx, state, size, sectioned, refresh));
  if (state.error) children.push(renderElement("p", { class: "dsh-poster-settings-error", role: "alert", text: state.error }));
  return section("Size", ...children);
}

/** The custom width, height and unit: the size applies as soon as all three describe an allowed poster size. */
function customFields(ctx: ShellContext, state: PanelState, size: DeckSize, sectioned: boolean, refresh: () => void): HTMLElement {
  const draft = state.draft ?? { ...size };
  const update = (next: DeckSize): void => {
    state.draft = next;
    if (!Number.isFinite(next.w) || !Number.isFinite(next.h) || !isDeckSizeAllowed("poster", next)) {
      state.error = SIZE_MESSAGE;
      refresh();
      return;
    }
    state.error = "";
    if (sameSize(next, size)) return refresh();
    applySize(ctx, next, sectioned, "Change poster size");
  };
  const rounded = (value: string): number => (value.trim() === "" ? NaN : Math.round(Number(value.trim()) * 10) / 10);
  const width = input("text", String(draft.w), (value) => update({ ...draft, w: rounded(value) }), { inputmode: "decimal", "aria-label": "Width" });
  const height = input("text", String(draft.h), (value) => update({ ...draft, h: rounded(value) }), { inputmode: "decimal", "aria-label": "Height" });
  const unit = select([["mm", "mm"], ["in", "in"]], draft.unit, (value) => update({ ...draft, unit: value as DeckSize["unit"] }));
  unit.setAttribute("aria-label", "Unit");
  return row(width, renderElement("span", { text: "×" }), height, unit);
}

function orientationSection(ctx: ShellContext, size: DeckSize, sectioned: boolean): HTMLElement {
  const landscape = size.w > size.h;
  const choose = (next: boolean): void => {
    if (next === landscape || size.w === size.h) return;
    if (sectioned) commitPosterEdit(ctx, switchPosterOrientation(ctx.view.html, ctx.view.theme), "Switch orientation");
    else applySize(ctx, { w: size.h, h: size.w, unit: size.unit }, false, "Switch orientation");
  };
  return section("Orientation", row(
    toggle({ text: "Portrait" }, "Portrait", !landscape, () => choose(false)),
    toggle({ text: "Landscape" }, "Landscape", landscape, () => choose(true)),
  ));
}

/** A length field in cm over a px setting; an entry that is not a number restores the field. */
function cmField(label: string, px: number, onPx: (px: number) => void, refresh: () => void): HTMLElement {
  return field(label, input("number", cmText(px), (value) => {
    const cm = value.trim() === "" ? NaN : Number(value);
    if (Number.isFinite(cm)) onPx(cm * PX_PER_CM);
    else refresh();
  }, { min: "0", step: "0.1" }));
}

function layoutSections(ctx: ShellContext, settings: PosterSettings, refresh: () => void): HTMLElement[] {
  const change = (next: PosterSettingsChange, label: string): void => commitPosterEdit(ctx, setPosterSettings(ctx.view.html, ctx.view.theme, next), label);
  const columns = field("Columns", input("number", String(settings.columns.length), (value) => {
    const count = Number(value);
    if (Number.isInteger(count) && count >= 1 && count <= POSTER_MAX_COLUMNS) change({ columns: Array.from({ length: count }, () => 1) }, "Change columns");
    else refresh();
  }, { min: "1", max: String(POSTER_MAX_COLUMNS), step: "1" }));
  const margins = section("Margins",
    cmField("Section margin", settings.sectionMargin, (px) => change({ sectionMargin: px }, "Change margins"), refresh),
    cmField("Content margin", settings.contentMargin, (px) => change({ contentMargin: px }, "Change margins"), refresh));
  const header = cmField("Header height", settings.headerHeight, (px) => change({ headerHeight: px }, "Change header height"), refresh);
  const known = TEXT_SIZES.some(([, scale]) => scale === settings.typeScale);
  const options = [...(known ? [] : [[`${settings.typeScale}×`, String(settings.typeScale)] as const]), ...TEXT_SIZES.map(([label, scale]) => [label, String(scale)] as const)];
  const text = field("Text size", select(options, String(settings.typeScale), (value) => change({ typeScale: Number(value) }, "Change text size")));
  return [section("Layout", columns, header), margins, section("Text", text)];
}

/** Appends `<p>Text</p>` at the end of a section's content. */
function appendText(id: string): (html: string) => DeckEditResult {
  return (html) => {
    const block = findDeckBlock(parseDeck(html).model, id);
    if (!block) return { ok: false, error: `No block of the poster has the id "${id}".` };
    const close = html.lastIndexOf("</", block.range.to);
    if (close <= block.startTag.to) return { ok: false, error: `The section "${id}" has no closing tag.` };
    return { ok: true, html: `${html.slice(0, close)}<p>Text</p>${html.slice(close)}` };
  };
}

/** Adds a section to `column` and moves it to just after the section at `index`. */
function addSectionBelow(ctx: ShellContext, layout: PosterLayout, column: number, index: number): void {
  const before = new Set(layout.columns.flat().map((box) => box.id));
  const added = addPosterSection(ctx.view.html, ctx.view.theme, column);
  if (!added.ok) return commitPosterEdit(ctx, added, "Add section");
  const id = readPosterLayout(added.html, added.theme)?.columns[column]?.map((box) => box.id).find((candidate) => !before.has(candidate));
  commitPosterEdit(ctx, id ? movePosterSection(added.html, added.theme, id, column, index + 1) : added, "Add section");
}

async function addFigure(ctx: ShellContext, id: string): Promise<void> {
  const src = await ctx.options.pickImage?.();
  if (!src) return;
  commitPosterEdit(ctx, addPosterFigure(ctx.view.html, ctx.view.theme, id, src), "Add figure");
}

/** The content actions of the one selected section; none for any other selection. */
function sectionActions(ctx: ShellContext, layout: PosterLayout): HTMLElement | null {
  if (ctx.view.blocks.length !== 1) return null;
  const id = ctx.view.blocks[0]!;
  const column = layout.columns.findIndex((boxes) => boxes.some((box) => box.id === id));
  if (column < 0) return null;
  const index = layout.columns[column]!.findIndex((box) => box.id === id);
  const figure = button("Add figure", () => void addFigure(ctx, id), "file-media");
  figure.disabled = !ctx.options.pickImage;
  return section("Section",
    button("Add section below", () => addSectionBelow(ctx, layout, column, index), "plus"),
    button("Add text", () => ctx.edit([appendText(id)], "Add text"), "text-box"),
    figure);
}

/** The Poster Settings panel of the current poster; `refresh` redraws it from the editor's view. */
export function createPosterSettings(ctx: ShellContext): { element: HTMLElement; refresh(): void } {
  const element = renderElement("aside", { class: "dw-props dsh-props dsh-poster-settings", "aria-label": "Poster settings" });
  const state: PanelState = { custom: false, draft: null, error: "" };
  const refresh = (): void => {
    const canvas = posterCanvas(ctx.view.html);
    const title = renderElement("div", { class: "dw-props-title", text: "Poster" });
    if (!canvas) return element.replaceChildren(title);
    const layout = readPosterLayout(ctx.view.html, ctx.view.theme);
    const children: Array<HTMLElement | null> = [title, sizeSection(ctx, state, canvas.size, layout !== null, refresh), orientationSection(ctx, canvas.size, layout !== null)];
    if (layout) children.push(...layoutSections(ctx, readPosterSettings(ctx.view.theme, canvas.width, canvas.height), refresh), sectionActions(ctx, layout));
    else children.push(section("Sections", button("Use sections", () => useSections(ctx), "panel-left")));
    element.replaceChildren(...children.filter((child): child is HTMLElement => child !== null));
    if (ctx.view.readOnly) for (const control of Array.from(element.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select"))) control.disabled = true;
  };
  refresh();
  return { element, refresh };
}

/** Turns an unsectioned poster into a sectioned one with a section per column. */
function useSections(ctx: ShellContext): void {
  let result: PosterEditResult = { ok: true, html: ctx.view.html, theme: ctx.view.theme };
  for (const column of [0, 1, 2]) {
    if (!result.ok) break;
    result = addPosterSection(result.html, result.theme, column);
  }
  commitPosterEdit(ctx, result, "Use sections");
}
