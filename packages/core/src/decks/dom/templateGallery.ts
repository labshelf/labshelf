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

export function mountDeckTemplateGallery(host: HTMLElement, options: DeckTemplateGalleryOptions): { readonly element: HTMLElement; destroy(): void } {
  const formats: DeckTemplateFormat[] = options.formats.length > 0 ? [...options.formats] : ["html"];
  const palettes: Palette[] = [
    { label: "Default", name: "Default", style: null, kit: false },
    ...DECK_STYLE_PRESETS.map((preset) => ({ label: preset.name, name: preset.name, style: preset.style, kit: false })),
    ...options.kits.map((kit) => ({ label: `Kit: ${kit.name}`, name: kit.name, style: kit.style, kit: true })),
  ];
  let kind: DeckKind = options.kind ?? "talk";
  let format: DeckTemplateFormat = formats[0]!;
  let template = "generic";
  let orientation: Orientation = "portrait";
  let size: DeckSize = { w: 1920, h: 1080, unit: "px" };
  let palette = 0;

  const title = renderElement("input", { type: "text", class: "ls-input dtg-title-input", "aria-label": "Title" });
  const create = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary dtg-create", text: "Create" });
  const cancel = renderElement("button", { type: "button", class: "ls-btn dtg-cancel", text: "Cancel" });
  const kindSlot = renderElement("div", { class: "dtg-slot" });
  const formatSlot = renderElement("div", { class: "dtg-slot" });
  const templateSlot = renderElement("div", { class: "dtg-slot" });
  const sizeSlot = renderElement("div", { class: "dtg-slot dtg-size" });
  const paletteSlot = renderElement("div", { class: "dtg-slot" });
  const heading = options.kind ? HEADING[options.kind] : "New talk or poster";
  const element = renderElement("div", { class: "dtg", role: "dialog", "aria-modal": "true", "aria-label": heading },
    renderElement("h2", { class: "dtg-heading", text: heading }),
    kindSlot, formatSlot,
    renderElement("label", { class: "dtg-field" }, renderElement("span", { class: "dtg-label", text: "Title" }), title),
    renderElement("div", { class: "dtg-label", text: "Template" }), templateSlot,
    sizeSlot,
    renderElement("div", { class: "dtg-label", text: "Palette" }), paletteSlot,
    renderElement("div", { class: "dtg-actions" }, cancel, create));

  const trimmedTitle = (): string => title.value.trim();
  const syncCreate = (): void => { create.disabled = trimmedTitle() === ""; };

  function renderKind(): void {
    if (options.kind) return kindSlot.replaceChildren();
    const buttons = (["talk", "poster"] as const).map((value) => {
      const button = pressedButton(KIND_LABEL[value], value === kind, "ls-btn ls-btn-ghost dtg-toggle", KIND_LABEL[value]);
      button.addEventListener("click", () => { if (kind !== value) { kind = value; changed(); } });
      return button;
    });
    kindSlot.replaceChildren(group("Kind", "dtg-toggles", ...buttons));
  }

  function renderFormat(): void {
    if (formats.length < 2) return formatSlot.replaceChildren();
    const buttons = formats.map((value) => {
      const button = pressedButton(FORMAT_LABEL[value], value === format, "ls-btn ls-btn-ghost dtg-toggle", FORMAT_LABEL[value]);
      button.addEventListener("click", () => { if (format !== value) { format = value; changed(); } });
      return button;
    });
    formatSlot.replaceChildren(group("Format", "dtg-toggles", ...buttons));
  }

  function renderTemplates(): void {
    const style = palettes[palette]!.style ?? DEFAULT_DECK_STYLE;
    const cards = listDeckTemplates(kind, format).map((entry) => {
      const preview = kind === "poster" ? posterPreview(entry, style, size) : talkPreview(entry, style);
      const card = pressedButton(entry.name, entry.id === template, "dtg-card", preview,
        renderElement("span", { class: "dtg-card-name", text: entry.name }),
        renderElement("span", { class: "dtg-card-description", text: entry.description }));
      card.addEventListener("click", () => { template = entry.id; renderTemplates(); });
      return card;
    });
    templateSlot.replaceChildren(group("Template", "dtg-cards", ...cards));
  }

  function renderSize(): void {
    const presets = sizesFor(kind, format, orientation);
    const fallback = kind === "talk" ? "talk-16-9" : `a0-${orientation}`;
    const chosen = presets.find((preset) => sameSize(preset.size, size))
      ?? (kind === "poster" ? presets.find((preset) => sameSize(preset.size, orientDeckSize(size, orientation))) : undefined)
      ?? presets.find((preset) => preset.id === fallback) ?? presets[0];
    if (chosen) size = { ...chosen.size };
    const select = renderElement("select", { class: "ls-input dtg-size-select", "aria-label": "Size" },
      ...presets.map((preset) => renderElement("option", { value: preset.id, text: preset.label })));
    if (chosen) select.value = chosen.id;
    select.addEventListener("change", () => {
      const picked = presets.find((preset) => preset.id === select.value);
      if (picked) { size = { ...picked.size }; renderTemplates(); }
    });
    const orientations = kind === "poster"
      ? group("Orientation", "dtg-toggles", ...(["portrait", "landscape"] as const).map((value) => {
        const label = value === "portrait" ? "Portrait" : "Landscape";
        const button = pressedButton(label, value === orientation, "ls-btn ls-btn-ghost dtg-toggle", label);
        button.addEventListener("click", () => { if (orientation !== value) { orientation = value; renderSize(); renderTemplates(); } });
        return button;
      }))
      : null;
    sizeSlot.replaceChildren(renderElement("label", { class: "dtg-field" }, renderElement("span", { class: "dtg-label", text: "Size" }), select), ...(orientations ? [orientations] : []));
  }

  function renderPalettes(): void {
    const button = (entry: Palette, index: number): HTMLButtonElement => {
      const node = pressedButton(entry.label, index === palette, "dtg-palette", swatches(entry.style ?? DEFAULT_DECK_STYLE),
        renderElement("span", { class: "dtg-palette-name", text: entry.name }));
      node.addEventListener("click", () => { palette = index; renderPalettes(); renderTemplates(); });
      return node;
    };
    const builtIn = palettes.map((entry, index) => (entry.kit ? null : button(entry, index))).filter((node): node is HTMLButtonElement => node !== null);
    const kits = palettes.map((entry, index) => (entry.kit ? button(entry, index) : null)).filter((node): node is HTMLButtonElement => node !== null);
    paletteSlot.replaceChildren(group("Palette", "dtg-palettes",
      renderElement("div", { class: "dtg-palette-row" }, ...builtIn),
      kits.length > 0 ? renderElement("h3", { class: "dtg-subheading", text: "Your kits" }) : null,
      kits.length > 0 ? renderElement("div", { class: "dtg-palette-row" }, ...kits) : null));
  }

  /** A change of kind or format: keeps the template when it still exists, else Generic, and redraws what depends on them. */
  function changed(): void {
    if (!listDeckTemplates(kind, format).some((entry) => entry.id === template)) template = "generic";
    title.placeholder = `${KIND_LABEL[kind]} title`;
    renderKind();
    renderFormat();
    renderSize();
    renderTemplates();
  }

  const submit = (): void => {
    const text = trimmedTitle();
    if (text === "") return;
    options.onCreate({ kind, format, template, title: text, size: { ...size }, style: palettes[palette]!.style });
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

  changed();
  renderPalettes();
  syncCreate();
  host.append(element);
  return {
    element,
    destroy() {
      title.removeEventListener("input", syncCreate);
      title.removeEventListener("keydown", onTitleKey);
      element.removeEventListener("keydown", onKey);
      create.removeEventListener("click", submit);
      cancel.removeEventListener("click", onCancelClick);
      element.remove();
    },
  };
}
