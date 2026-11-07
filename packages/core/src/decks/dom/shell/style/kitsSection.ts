// The Style panel's Kits section: the library's kits with their swatches and Use, From logo… (a candidate from a picked image's palette)
// and Save as Kit (an inline name and footer form), with a status line. It only adds candidates to the panel; Apply stays the only writer.
import { renderElement } from "../../../../ui/dom/index.js";
import type { DeckKit, DeckKitImage, DeckKitsPort } from "../../../deckKit.js";
import { extractPalette, styleFromPalette } from "../../../deckKitPalette.js";
import { validateDeckStyle, type DeckStyle } from "../../../deckStyleTokens.js";
import type { StyleCard } from "./candidates.js";
import { readImagePixels, type KitImageDeps } from "./kitImage.js";

/** A candidate card that may have come from a kit or from a logo; a logo card keeps its image for Save as Kit. */
export interface KitCard extends StyleCard { from?: "kit" | "logo"; logo?: DeckKitImage }

/** What the section needs of the panel: the chosen card, and adding a card (replacing one of the same name) as the chosen one. */
export interface KitsSectionHost { chosen(): KitCard; choose(card: KitCard): void }

const SWATCH_TOKENS = ["primary", "accent", "background", "text", "muted"] as const;
const UNREADABLE = "This image could not be read.";

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error && error.message !== "" ? error.message : fallback);

function swatches(style: DeckStyle): HTMLElement {
  const row = renderElement("span", { class: "dsh-kit-swatches", "aria-hidden": "true" });
  for (const token of SWATCH_TOKENS) {
    const swatch = renderElement("span", { class: "dsh-kit-swatch" });
    swatch.style.backgroundColor = style[token];
    row.append(swatch);
  }
  return row;
}

function kitInput(label: string, value: string, onInput: () => void): HTMLInputElement {
  const input = renderElement("input", { type: "text", class: "dw-input", value, "aria-label": label, spellcheck: "false" });
  input.addEventListener("input", onInput);
  return input;
}

/** Mounts the section; `update` follows the chosen card (Save's state), `destroy` stops late replies from drawing. */
export function mountKitsSection(port: DeckKitsPort, host: KitsSectionHost, kitImage?: KitImageDeps): { element: HTMLElement; update(): void; destroy(): void } {
  const list = renderElement("ul", { class: "dsh-kit-list", "aria-label": "Kits" });
  const fromLogo = renderElement("button", { type: "button", class: "dw-button", text: "From logo…" });
  const saveAs = renderElement("button", { type: "button", class: "dw-button", text: "Save as Kit" });
  const form = renderElement("div", { class: "dsh-kit-form" });
  const status = renderElement("p", { class: "dsh-kit-status", role: "status" });
  const element = renderElement("section", { class: "dsh-section dsh-kits" },
    renderElement("div", { class: "dsh-section-title", text: "Kits" }), list,
    renderElement("div", { class: "dsh-kit-actions" }, fromLogo, saveAs), form, status);
  let destroyed = false;
  let open: { name: HTMLInputElement; footer: HTMLInputElement; save: HTMLButtonElement } | undefined;
  let saving = false;

  const say = (text: string): void => { status.textContent = text; };
  const note = (text: string): HTMLElement => renderElement("li", { class: "dw-props-note", text });
  const row = (kit: DeckKit): HTMLElement => {
    const use = renderElement("button", { type: "button", class: "dw-button dsh-kit-use", "aria-label": `Use ${kit.name}`, text: "Use" });
    use.addEventListener("click", () => host.choose({ name: kit.name, style: { ...kit.style }, from: "kit" }));
    return renderElement("li", { class: "dsh-kit-row" }, renderElement("span", { class: "dsh-kit-name", text: kit.name }), swatches(kit.style), use);
  };
  const load = (): void => {
    void port.list().then(
      (kits) => { if (!destroyed) list.replaceChildren(...(kits.length === 0 ? [note("No kits yet.")] : kits.map(row))); },
      () => { if (!destroyed) list.replaceChildren(note("Kits could not be read.")); });
  };
  const update = (): void => {
    if (open) open.save.disabled = saving || open.name.value.trim() === "" || validateDeckStyle(host.chosen().style).length > 0;
  };
  const closeForm = (): void => { open = undefined; form.replaceChildren(); };
  const save = (): void => {
    if (!open || open.save.disabled) return;
    const card = host.chosen();
    const footer = open.footer.value.trim();
    const kit: DeckKit = { name: open.name.value.trim(), style: card.style, ...(footer !== "" ? { footer } : {}) };
    saving = true;
    update();
    const done = (): void => { saving = false; update(); };
    const written = card.from === "logo" && card.logo ? port.save(kit, card.logo) : port.save(kit);
    written.then((stored) => {
      done();
      if (destroyed) return;
      say(`Saved ${stored.name}.`);
      closeForm();
      load();
    }, (error: unknown) => { done(); if (!destroyed) say(messageOf(error, "The Kit could not be saved.")); });
  };
  const openForm = (): void => {
    const card = host.chosen();
    const name = kitInput("Kit name", card.from === "kit" ? card.name : "", update);
    const footer = kitInput("Kit footer", "", update);
    const saveButton = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Save" });
    const cancel = renderElement("button", { type: "button", class: "dw-button", text: "Cancel" });
    saveButton.addEventListener("click", save);
    cancel.addEventListener("click", closeForm);
    for (const input of [name, footer]) input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); save(); } });
    const field = (label: string, input: HTMLInputElement): HTMLElement =>
      renderElement("label", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: label }), input);
    form.replaceChildren(field("Name", name), field("Footer", footer), renderElement("div", { class: "dsh-kit-actions" }, saveButton, cancel));
    open = { name, footer, save: saveButton };
    update();
    name.focus();
  };

  fromLogo.addEventListener("click", () => {
    // PLATFORM: a browser opens its file dialog only inside the user's click, so the pick starts before any await.
    let picked: Promise<DeckKitImage | null>;
    try { picked = port.pickImage(); } catch (error) { return say(messageOf(error, UNREADABLE)); }
    picked.then(async (image) => {
      if (!image || destroyed) return;
      const pixels = await readImagePixels(image, kitImage);
      if (destroyed) return;
      host.choose({ name: `From ${image.name}`, style: styleFromPalette(extractPalette(pixels), host.chosen().style), from: "logo", logo: image });
      say("");
    }).catch((error: unknown) => { if (!destroyed) say(messageOf(error, UNREADABLE)); });
  });
  saveAs.addEventListener("click", () => (open ? closeForm() : openForm()));
  load();
  return { element, update, destroy() { destroyed = true; } };
}
