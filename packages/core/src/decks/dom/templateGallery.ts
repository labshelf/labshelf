// The new-deck template gallery: kind, format, title, template cards with a palette-coloured preview, size and orientation, and the palettes
// (Default, the Style presets and the user's Kits), handing a DeckTemplateChoice to onCreate.
import { renderElement } from "../../ui/dom/index.js";
import { deckSizeOrientation, orientDeckSize, type DeckKind, type DeckSize, type DeckSizePreset } from "../deckSizes.js";
import { DECK_STYLE_PRESETS } from "../deckStylePresets.js";
import { sameSize } from "../deckSizes.js";
import { DEFAULT_DECK_STYLE, type DeckStyle } from "../deckStyleTokens.js";
import { listDeckTemplates, listTemplateSizes, type DeckTemplate, type DeckTemplateChoice, type DeckTemplateFormat, type DeckTemplateGalleryInit } from "../deckTemplates.js";

export interface DeckTemplateGalleryOptions extends DeckTemplateGalleryInit { onCreate(choice: DeckTemplateChoice): void; onCancel(): void }

type Orientation = "portrait" | "landscape";
interface Palette { label: string; name: string; style: DeckStyle | null; kit: boolean }

const KIND_LABEL: Record<DeckKind, string> = { talk: "Presentation", poster: "Poster" };
const FORMAT_LABEL: Record<DeckTemplateFormat, string> = { html: "Visual", latex: "LaTeX", typst: "Typst" };
const HEADING: Record<DeckKind, string> = { talk: "New presentation", poster: "New poster" };
const SWATCH_TOKENS = ["primary", "accent", "background", "text"] as const;

const pressedButton = (label: string, pressed: boolean, cls: string, ...children: Array<Node | string>): HTMLButtonElement =>
  renderElement("button", { type: "button", class: cls, "aria-pressed": String(pressed), "aria-label": label }, ...children);
const group = (label: string, cls: string, ...children: Array<Node | null>): HTMLElement =>
  renderElement("div", { class: cls, role: "group", "aria-label": label }, ...children);

/** The sizes offered for a kind and format; a poster lists only those of the orientation, square ones always. */
function sizesFor(kind: DeckKind, format: DeckTemplateFormat, orientation: Orientation): DeckSizePreset[] {
  const all = listTemplateSizes(kind, format);
  if (kind === "talk") return all;
  return all.filter((preset) => deckSizeOrientation(preset.size) !== (orientation === "portrait" ? "landscape" : "portrait"));
}

/** The four colours of a style as swatches, set through the CSSOM. */
function swatches(style: DeckStyle): HTMLElement {
  const row = renderElement("span", { class: "dtg-swatches", "aria-hidden": "true" });
  for (const token of SWATCH_TOKENS) {
    const swatch = renderElement("span", { class: "dtg-swatch" });
    swatch.style.backgroundColor = style[token];
    row.append(swatch);
  }
  return row;
}

/** A poster preview: the header band and one column per layout column sized by ratio, its sections by weight, a takeaway in the primary colour. */
function posterPreview(template: DeckTemplate, style: DeckStyle, size: DeckSize): HTMLElement {
  const layout = template.poster ?? { columns: [1], headerHeight: 0.12, typeScale: 1, sections: [] };
  const box = renderElement("span", { class: "dtg-preview dtg-preview-poster", "aria-hidden": "true" });
  box.style.setProperty("aspect-ratio", `${size.w} / ${size.h}`);
  box.style.backgroundColor = style.background;
  const header = renderElement("span", { class: "dtg-preview-header" });
  header.style.height = `${Math.round(layout.headerHeight * 100)}%`;
  header.style.backgroundColor = style.primary;
  const body = renderElement("span", { class: "dtg-preview-body" });
  layout.columns.forEach((ratio, index) => {
    const column = renderElement("span", { class: "dtg-preview-column" });
    column.style.flexGrow = String(ratio);
    for (const section of layout.sections.filter((candidate) => candidate.column === index)) {
      const cell = renderElement("span", { class: section.takeaway ? "dtg-preview-section dtg-preview-takeaway" : "dtg-preview-section" });
      cell.style.flexGrow = String(section.weight ?? 1);
      cell.style.borderColor = style.muted;
      if (section.takeaway) cell.style.backgroundColor = style.primary;
      column.append(cell);
    }
    body.append(column);
  });
  box.append(header, body);
  return box;
}

/** A talk preview: a 16:9 box with a title bar, and text lines below for a template with content slides. */
function talkPreview(template: DeckTemplate, style: DeckStyle): HTMLElement {
  const box = renderElement("span", { class: "dtg-preview dtg-preview-talk", "aria-hidden": "true" });
  box.style.backgroundColor = style.background;
  const bar = renderElement("span", { class: "dtg-preview-titlebar" });
  bar.style.backgroundColor = style.primary;
  box.append(bar);
  if (template.id !== "blank") {
    for (const width of [70, 55, 62]) {
      const line = renderElement("span", { class: "dtg-preview-line" });
      line.style.width = `${width}%`;
      line.style.backgroundColor = style.text;
      box.append(line);
    }
    const accent = renderElement("span", { class: "dtg-preview-accent" });
    accent.style.backgroundColor = style.accent;
    box.append(accent);
  }
  return box;
}

/** The mutable choices of one gallery: what the next DeckTemplateChoice is made of. */
interface GalleryState { kind: DeckKind; format: DeckTemplateFormat; template: string; orientation: Orientation; size: DeckSize; palette: number }

/** Everything the render functions share: the options, the choices, the palettes and the elements they fill. */
interface GalleryView {
  options: DeckTemplateGalleryOptions;
  formats: DeckTemplateFormat[];
  palettes: Palette[];
  state: GalleryState;
  title: HTMLInputElement;
  create: HTMLButtonElement;
  cancel: HTMLButtonElement;
  slots: { kind: HTMLElement; format: HTMLElement; template: HTMLElement; size: HTMLElement; palette: HTMLElement };
  element: HTMLElement;
}

function createGalleryPalettes(options: DeckTemplateGalleryOptions): Palette[] {
  return [
    { label: "Default", name: "Default", style: null, kit: false },
    ...DECK_STYLE_PRESETS.map((preset) => ({ label: preset.name, name: preset.name, style: preset.style, kit: false })),
    ...options.kits.map((kit) => ({ label: `Kit: ${kit.name}`, name: kit.name, style: kit.style, kit: true })),
  ];
}

/** The gallery's elements, empty slots included, laid out in order. */
function createGalleryView(options: DeckTemplateGalleryOptions): GalleryView {
  const formats: DeckTemplateFormat[] = options.formats.length > 0 ? [...options.formats] : ["html"];
  const title = renderElement("input", { type: "text", class: "ls-input dtg-title-input", "aria-label": "Title" });
  const create = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary dtg-create", text: "Create" });
  const cancel = renderElement("button", { type: "button", class: "ls-btn dtg-cancel", text: "Cancel" });
  const slots = {
    kind: renderElement("div", { class: "dtg-slot" }),
    format: renderElement("div", { class: "dtg-slot" }),
    template: renderElement("div", { class: "dtg-slot" }),
    size: renderElement("div", { class: "dtg-slot dtg-size" }),
    palette: renderElement("div", { class: "dtg-slot" }),
  };
  const heading = options.kind ? HEADING[options.kind] : "New talk or poster";
  const element = renderElement("div", { class: "dtg", role: "dialog", "aria-modal": "true", "aria-label": heading },
    renderElement("h2", { class: "dtg-heading", text: heading }),
    slots.kind, slots.format,
    renderElement("label", { class: "dtg-field" }, renderElement("span", { class: "dtg-label", text: "Title" }), title),
    renderElement("div", { class: "dtg-label", text: "Template" }), slots.template,
    slots.size,
    renderElement("div", { class: "dtg-label", text: "Palette" }), slots.palette,
    renderElement("div", { class: "dtg-actions" }, cancel, create));
  const state: GalleryState = { kind: options.kind ?? "talk", format: formats[0]!, template: "generic", orientation: "portrait", size: { w: 1920, h: 1080, unit: "px" }, palette: 0 };
  return { options, formats, palettes: createGalleryPalettes(options), state, title, create, cancel, slots, element };
}

function renderKind(view: GalleryView): void {
  const { options, state, slots } = view;
  if (options.kind) return slots.kind.replaceChildren();
  const buttons = (["talk", "poster"] as const).map((value) => {
    const button = pressedButton(KIND_LABEL[value], value === state.kind, "ls-btn ls-btn-ghost dtg-toggle", KIND_LABEL[value]);
    button.addEventListener("click", () => { if (state.kind !== value) { state.kind = value; changed(view); } });
    return button;
  });
  slots.kind.replaceChildren(group("Kind", "dtg-toggles", ...buttons));
}

function renderFormat(view: GalleryView): void {
  const { formats, state, slots } = view;
  if (formats.length < 2) return slots.format.replaceChildren();
  const buttons = formats.map((value) => {
    const button = pressedButton(FORMAT_LABEL[value], value === state.format, "ls-btn ls-btn-ghost dtg-toggle", FORMAT_LABEL[value]);
    button.addEventListener("click", () => { if (state.format !== value) { state.format = value; changed(view); } });
    return button;
  });
  slots.format.replaceChildren(group("Format", "dtg-toggles", ...buttons));
}

function renderTemplates(view: GalleryView): void {
  const { state, palettes, slots } = view;
  const style = palettes[state.palette]!.style ?? DEFAULT_DECK_STYLE;
  const cards = listDeckTemplates(state.kind, state.format).map((entry) => {
    const preview = state.kind === "poster" ? posterPreview(entry, style, state.size) : talkPreview(entry, style);
    const card = pressedButton(entry.name, entry.id === state.template, "dtg-card", preview,
      renderElement("span", { class: "dtg-card-name", text: entry.name }),
      renderElement("span", { class: "dtg-card-description", text: entry.description }));
    card.addEventListener("click", () => { state.template = entry.id; renderTemplates(view); });
    return card;
  });
  slots.template.replaceChildren(group("Template", "dtg-cards", ...cards));
}

/** The size the gallery keeps for the presets on offer: the current one, its poster orientation, the kind's default, or the first. */
function chooseSize(state: GalleryState, presets: DeckSizePreset[]): DeckSizePreset | undefined {
  const fallback = state.kind === "talk" ? "talk-16-9" : `a0-${state.orientation}`;
  return presets.find((preset) => sameSize(preset.size, state.size))
    ?? (state.kind === "poster" ? presets.find((preset) => sameSize(preset.size, orientDeckSize(state.size, state.orientation))) : undefined)
    ?? presets.find((preset) => preset.id === fallback) ?? presets[0];
}

function orientationToggles(view: GalleryView): HTMLElement {
  const { state } = view;
  return group("Orientation", "dtg-toggles", ...(["portrait", "landscape"] as const).map((value) => {
    const label = value === "portrait" ? "Portrait" : "Landscape";
    const button = pressedButton(label, value === state.orientation, "ls-btn ls-btn-ghost dtg-toggle", label);
    button.addEventListener("click", () => { if (state.orientation !== value) { state.orientation = value; renderSize(view); renderTemplates(view); } });
    return button;
  }));
}

function renderSize(view: GalleryView): void {
  const { state, slots } = view;
  const presets = sizesFor(state.kind, state.format, state.orientation);
  const chosen = chooseSize(state, presets);
  if (chosen) state.size = { ...chosen.size };
  const select = renderElement("select", { class: "ls-input dtg-size-select", "aria-label": "Size" },
    ...presets.map((preset) => renderElement("option", { value: preset.id, text: preset.label })));
  if (chosen) select.value = chosen.id;
  select.addEventListener("change", () => {
    const picked = presets.find((preset) => preset.id === select.value);
    if (picked) { state.size = { ...picked.size }; renderTemplates(view); }
  });
  const orientations = state.kind === "poster" ? orientationToggles(view) : null;
  slots.size.replaceChildren(renderElement("label", { class: "dtg-field" }, renderElement("span", { class: "dtg-label", text: "Size" }), select), ...(orientations ? [orientations] : []));
}

function renderPalettes(view: GalleryView): void {
  const { state, palettes, slots } = view;
  const button = (entry: Palette, index: number): HTMLButtonElement => {
    const node = pressedButton(entry.label, index === state.palette, "dtg-palette", swatches(entry.style ?? DEFAULT_DECK_STYLE),
      renderElement("span", { class: "dtg-palette-name", text: entry.name }));
    node.addEventListener("click", () => { state.palette = index; renderPalettes(view); renderTemplates(view); });
    return node;
  };
  const builtIn = palettes.map((entry, index) => (entry.kit ? null : button(entry, index))).filter((node): node is HTMLButtonElement => node !== null);
  const kits = palettes.map((entry, index) => (entry.kit ? button(entry, index) : null)).filter((node): node is HTMLButtonElement => node !== null);
  slots.palette.replaceChildren(group("Palette", "dtg-palettes",
    renderElement("div", { class: "dtg-palette-row" }, ...builtIn),
    kits.length > 0 ? renderElement("h3", { class: "dtg-subheading", text: "Your kits" }) : null,
    kits.length > 0 ? renderElement("div", { class: "dtg-palette-row" }, ...kits) : null));
}

/** A change of kind or format: keeps the template when it still exists, else Generic, and redraws what depends on them. */
function changed(view: GalleryView): void {
  const { state } = view;
  if (!listDeckTemplates(state.kind, state.format).some((entry) => entry.id === state.template)) state.template = "generic";
  view.title.placeholder = `${KIND_LABEL[state.kind]} title`;
  renderKind(view);
  renderFormat(view);
  renderSize(view);
  renderTemplates(view);
}

/** Wires the title, keys and buttons; returns the function that removes them. */
function wireGallery(view: GalleryView): () => void {
  const { options, state, title, create, cancel, element, palettes } = view;
  const syncCreate = (): void => { create.disabled = title.value.trim() === ""; };
  const submit = (): void => {
    const text = title.value.trim();
    if (text === "") return;
    options.onCreate({ kind: state.kind, format: state.format, template: state.template, title: text, size: { ...state.size }, style: palettes[state.palette]!.style });
  };
  const onTitleKey = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    submit();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    options.onCancel();
  };
  const onCancelClick = (): void => options.onCancel();
  title.addEventListener("input", syncCreate);
  title.addEventListener("keydown", onTitleKey);
  element.addEventListener("keydown", onKey);
  create.addEventListener("click", submit);
  cancel.addEventListener("click", onCancelClick);
  syncCreate();
  return () => {
    title.removeEventListener("input", syncCreate);
    title.removeEventListener("keydown", onTitleKey);
    element.removeEventListener("keydown", onKey);
    create.removeEventListener("click", submit);
    cancel.removeEventListener("click", onCancelClick);
  };
}

export function mountDeckTemplateGallery(host: HTMLElement, options: DeckTemplateGalleryOptions): { readonly element: HTMLElement; destroy(): void } {
  const view = createGalleryView(options);
  const unwire = wireGallery(view);
  changed(view);
  renderPalettes(view);
  host.append(view.element);
  return { element: view.element, destroy() { unwire(); view.element.remove(); } };
}
