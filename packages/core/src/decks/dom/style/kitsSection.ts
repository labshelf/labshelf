// The Style panel's Kits section: the library's kits with their swatches and Use, From logo… (a candidate from a picked image's palette)
// and Save as Kit (an inline name and footer form), with a status line. It only adds candidates to the panel; Apply stays the only writer.
import { renderElement } from "../../../ui/dom/index.js";
import type { DeckKit, DeckKitImage, DeckKitsPort } from "../../deckKit.js";
import { extractPalette, styleFromPalette } from "../../deckKitPalette.js";
import { validateDeckStyle, type DeckStyle } from "../../deckStyleTokens.js";
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

const kitNote = (text: string): HTMLElement => renderElement("li", { class: "dw-props-note", text });

/** A kit's row: its name, swatches and Use, which chooses it as the candidate. */
function kitRow(kit: DeckKit, host: KitsSectionHost): HTMLElement {
  const use = renderElement("button", { type: "button", class: "dw-button dsh-kit-use", "aria-label": `Use ${kit.name}`, text: "Use" });
  use.addEventListener("click", () => host.choose({ name: kit.name, style: { ...kit.style }, from: "kit" }));
  return renderElement("li", { class: "dsh-kit-row" }, renderElement("span", { class: "dsh-kit-name", text: kit.name }), swatches(kit.style), use);
}

interface OpenKitForm { name: HTMLInputElement; footer: HTMLInputElement; save: HTMLButtonElement }

/** The Save as Kit form: name and footer inputs (Enter saves) and Save and Cancel buttons; `nodes` go in the form, `open` keeps its controls. */
function buildKitForm(initialName: string, onInput: () => void, onSave: () => void, onCancel: () => void): { nodes: HTMLElement[]; open: OpenKitForm } {
  const name = kitInput("Kit name", initialName, onInput);
  const footer = kitInput("Kit footer", "", onInput);
  const save = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Save" });
  const cancel = renderElement("button", { type: "button", class: "dw-button", text: "Cancel" });
  save.addEventListener("click", onSave);
  cancel.addEventListener("click", onCancel);
  for (const input of [name, footer]) input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); onSave(); } });
  const field = (label: string, input: HTMLInputElement): HTMLElement =>
    renderElement("label", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: label }), input);
  return { nodes: [field("Name", name), field("Footer", footer), renderElement("div", { class: "dsh-kit-actions" }, save, cancel)], open: { name, footer, save } };
}

/** Writes the form's kit with the card's style (and its logo when the card came from one). */
function writeKit(port: DeckKitsPort, form: OpenKitForm, card: KitCard): Promise<DeckKit> {
  const footer = form.footer.value.trim();
  const kit: DeckKit = { name: form.name.value.trim(), style: card.style, ...(footer !== "" ? { footer } : {}) };
  return card.from === "logo" && card.logo ? port.save(kit, card.logo) : port.save(kit);
}

/** From logo…: picks an image and offers a candidate from its palette. */
function pickLogo(port: DeckKitsPort, host: KitsSectionHost, kitImage: KitImageDeps | undefined, say: (text: string) => void, alive: () => boolean): void {
  // PLATFORM: a browser opens its file dialog only inside the user's click, so the pick starts before any await.
  let picked: Promise<DeckKitImage | null>;
  try { picked = port.pickImage(); } catch (error) { return say(messageOf(error, UNREADABLE)); }
  picked.then(async (image) => {
    if (!image || !alive()) return;
    const pixels = await readImagePixels(image, kitImage);
    if (!alive()) return;
    host.choose({ name: `From ${image.name}`, style: styleFromPalette(extractPalette(pixels), host.chosen().style), from: "logo", logo: image });
    say("");
  }).catch((error: unknown) => { if (alive()) say(messageOf(error, UNREADABLE)); });
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
  let open: OpenKitForm | undefined;
  let saving = false;

  const say = (text: string): void => { status.textContent = text; };
  const load = (): void => {
    void port.list().then(
      (kits) => { if (!destroyed) list.replaceChildren(...(kits.length === 0 ? [kitNote("No kits yet.")] : kits.map((kit) => kitRow(kit, host)))); },
      () => { if (!destroyed) list.replaceChildren(kitNote("Kits could not be read.")); });
  };
  const update = (): void => {
    if (open) open.save.disabled = saving || open.name.value.trim() === "" || validateDeckStyle(host.chosen().style).length > 0;
  };
  const closeForm = (): void => { open = undefined; form.replaceChildren(); };
  const save = (): void => {
    if (!open || open.save.disabled) return;
    saving = true;
    update();
    const done = (): void => { saving = false; update(); };
    writeKit(port, open, host.chosen()).then((stored) => {
      done();
      if (destroyed) return;
      say(`Saved ${stored.name}.`);
      closeForm();
      load();
    }, (error: unknown) => { done(); if (!destroyed) say(messageOf(error, "The Kit could not be saved.")); });
  };
  const openForm = (): void => {
    const card = host.chosen();
    const built = buildKitForm(card.from === "kit" ? card.name : "", update, save, closeForm);
    form.replaceChildren(...built.nodes);
    open = built.open;
    update();
    built.open.name.focus();
  };

  fromLogo.addEventListener("click", () => pickLogo(port, host, kitImage, say, () => !destroyed));
  saveAs.addEventListener("click", () => (open ? closeForm() : openForm()));
  load();
  return { element, update, destroy() { destroyed = true; } };
}
