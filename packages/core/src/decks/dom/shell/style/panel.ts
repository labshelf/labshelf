// The Style panel (D4-D6): four candidate styles previewed on the current slide, the chosen one's tokens, its contrast,
// the diff of the style block it would write and Apply, which writes it through the port as one undo step.
import { renderElement, renderIcon } from "../../../../ui/dom/index.js";
import { renderDiffLines } from "../../../../writing/history/dom/index.js";
import {
  deckStyleContrast, diffDeckStyleBlock, normaliseDeckColour, normaliseDeckStyle, validateDeckStyle,
  type DeckStyle, type DeckStyleColourToken, type DeckStyleContrast, type DeckStyleFontToken,
} from "../../../deckStyleTokens.js";
import { DECK_STYLE_PRESETS } from "../../../deckStylePresets.js";
import type { DeckKitsPort } from "../../../deckKit.js";
import { cardGrid, createStylePreviews, styleKey } from "./candidates.js";
import type { KitImageDeps } from "./kitImage.js";
import { mountKitsSection, type KitCard } from "./kitsSection.js";
import type { DeckStylePort } from "./types.js";

// ---- the presets ----

export { DECK_STYLE_PRESETS, type DeckStylePreset } from "../../../deckStylePresets.js";

const PRESET_COLOURS: readonly DeckStyleColourToken[] = ["primary", "accent", "background", "text", "muted"];
const sameColours = (a: DeckStyle, b: DeckStyle): boolean => PRESET_COLOURS.every((token) => a[token].toLowerCase() === b[token].toLowerCase());

/** The current style named Current, then three presets whose colours differ from it, from `offset` on and wrapping. */
function namedStyleCandidates(current: DeckStyle, offset: number): Array<{ name: string; style: DeckStyle }> {
  const count = DECK_STYLE_PRESETS.length;
  const start = ((Math.trunc(offset) % count) + count) % count;
  const picked: Array<{ name: string; style: DeckStyle }> = [];
  for (let i = 0; i < count && picked.length < 3; i += 1) {
    const next = DECK_STYLE_PRESETS[(start + i) % count]!;
    if (sameColours(next.style, current)) continue;
    const { headingFont, bodyFont, monoFont, scale } = current;
    picked.push({ name: next.name, style: { ...next.style, ...(next.fonts ? {} : { headingFont, bodyFont, monoFont }), ...(next.scale ? {} : { scale }) } });
  }
  return [{ name: "Current", style: current }, ...picked];
}

/** The four styles of the Style panel's cards: `current` first, then three presets that differ from it in a colour, from `offset` on (wrapping). */
export function styleCandidates(current: DeckStyle, offset: number): DeckStyle[] {
  return namedStyleCandidates(current, offset).map((candidate) => candidate.style);
}

// ---- the token fields and the contrast list ----

const COLOUR_FIELDS: ReadonlyArray<readonly [DeckStyleColourToken, string]> = [["primary", "Primary"], ["accent", "Accent"], ["background", "Background"], ["text", "Text"], ["muted", "Muted"]];
const FONT_FIELDS: ReadonlyArray<readonly [DeckStyleFontToken, string]> = [["headingFont", "Heading font"], ["bodyFont", "Body font"], ["monoFont", "Mono font"]];
const PAIR_LABEL: Record<DeckStyleContrast["pair"], string> = { text: "Text", muted: "Muted", primary: "Primary", accent: "Accent" };

type StyleEdit = <T extends keyof DeckStyle>(token: T, value: DeckStyle[T]) => void;

const field = (label: string, ...controls: HTMLElement[]): HTMLElement =>
  renderElement("label", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: label }), ...controls);

/** An input reporting every keystroke and commit; Enter leaves it. */
function textInput(type: string, value: string, label: string, report: (value: string) => void, extra: Record<string, string> = {}): HTMLInputElement {
  const element = renderElement("input", { type, class: "dw-input", value, "aria-label": label, spellcheck: "false", ...extra });
  for (const name of ["input", "change"]) element.addEventListener(name, () => report(element.value));
  element.addEventListener("keydown", (event) => { if (event.key === "Enter") element.blur(); });
  return element;
}

/** A swatch and the hex beside it, kept in step; the hex may hold an invalid colour, which the panel lists as a problem. */
function colourControl(value: string, label: string, report: (value: string) => void): HTMLElement {
  const picker = textInput("color", normaliseDeckColour(value) ?? "#000000", label, (next) => { hex.value = next; report(next); }, { class: "dsh-swatch" });
  const hex = textInput("text", value, `${label} hex`, (next) => {
    const colour = normaliseDeckColour(next);
    if (colour) picker.value = colour;
    report(next.trim());
  }, { class: "dw-input dsh-hex" });
  return renderElement("span", { class: "dw-input-row" }, picker, hex);
}

/** The fields of `style`; each change goes to `edit`. */
function tokenFields(style: DeckStyle, edit: StyleEdit): HTMLElement {
  return renderElement("div", { class: "dsh-style-tokens" },
    ...COLOUR_FIELDS.map(([token, label]) => field(label, colourControl(style[token], label, (value) => edit(token, value)))),
    ...FONT_FIELDS.map(([token, label]) => field(label, textInput("text", style[token], label, (value) => edit(token, value)))),
    field("Scale", textInput("number", String(style.scale), "Scale", (value) => edit("scale", value.trim() === "" ? Number.NaN : Number(value)), { min: "0.5", max: "3", step: "0.05" })));
}

/** One row per contrast pair against the background, the ratio with one decimal; a failing pair is a warning. */
function contrastList(style: DeckStyle): HTMLElement {
  return renderElement("ul", { class: "dsh-style-contrast", "aria-label": "Contrast" }, ...deckStyleContrast(style).map((pair) => {
    const row = renderElement("li", { class: pair.ok ? "dsh-style-contrast-row" : "dsh-style-contrast-row is-warning" },
      renderElement("span", { text: `${PAIR_LABEL[pair.pair]} on background` }),
      renderElement("span", { class: "dsh-style-ratio", text: `${pair.ratio.toFixed(1)}:1` }));
    if (!pair.ok) row.append(renderElement("span", { class: "dsh-style-low", text: "Low contrast" }));
    return row;
  }));
}

// ---- the panel ----

/** How long an edited field waits before its candidate is previewed again. */
const PREVIEW_DELAY_MS = 300;

interface PanelState { current: { style: DeckStyle; block: string }; offset: number; cards: KitCard[]; chosen: number }

const sameStyle = (a: DeckStyle, b: DeckStyle): boolean => styleKey(normaliseDeckStyle(a)) === styleKey(normaliseDeckStyle(b));

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  return renderElement("section", { class: "dsh-section" }, renderElement("div", { class: "dsh-section-title", text: title }), ...children);
}

/** The diff of the current block against the chosen style's, or why there is none. */
function diffView(port: DeckStylePort, ps: PanelState, problems: readonly string[]): HTMLElement {
  const block = problems.length > 0 ? null : port.candidateBlock(ps.cards[ps.chosen]!.style);
  if (block === null) return renderElement("p", { class: "dw-props-note", text: problems.length > 0 ? "Fix the problems above to see the change." : "This style cannot be written." });
  const lines = diffDeckStyleBlock(ps.current.block, block);
  return lines.some((line) => line.kind === "added" || line.kind === "removed") ? renderDiffLines(lines) : renderElement("p", { class: "dw-props-note", text: "No change." });
}

type Kits = ReturnType<typeof mountKitsSection>;
type PanelPreviews = ReturnType<typeof createStylePreviews>;

interface PanelUi { element: HTMLElement; close: HTMLElement; more: HTMLElement; grid: HTMLElement; fields: HTMLElement; checks: HTMLElement; apply: HTMLButtonElement }

function buildPanelUi(): PanelUi {
  const close = renderElement("button", { type: "button", class: "dsh-style-close", title: "Close", "aria-label": "Close", html: renderIcon("x") });
  const head = renderElement("div", { class: "dw-props-title dsh-style-head" }, renderElement("span", { text: "Style" }), close);
  const grid = renderElement("div", { class: "dsh-style-grid" });
  const more = renderElement("button", { type: "button", class: "dw-button dsh-style-more", "aria-label": "More", text: "More" });
  const fields = renderElement("div", { class: "dsh-style-fields" });
  const checks = renderElement("div", { class: "dsh-style-checks" });
  const apply = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary dsh-style-apply", text: "Apply" });
  const element = renderElement("aside", { class: "dw-props dsh-props dsh-style", "aria-label": "Style" }, head, grid, more, fields, checks, apply);
  return { element, close, more, grid, fields, checks, apply };
}

/** Shows the chosen style on the stage, or nothing when it is the current style or cannot be applied. */
function stageChosen(port: DeckStylePort, ps: PanelState): void {
  const style = ps.cards[ps.chosen]!.style;
  port.stagePreview?.(validateDeckStyle(style).length > 0 || sameStyle(style, ps.current.style) ? null : style);
}

function drawChecks(port: DeckStylePort, ps: PanelState, ui: PanelUi, kits: Kits | undefined): void {
  const style = ps.cards[ps.chosen]!.style;
  const problems = validateDeckStyle(style);
  ui.checks.replaceChildren(
    ...(problems.length > 0 ? [section("Problems", renderElement("ul", { class: "dsh-style-problems" }, ...problems.map((text) => renderElement("li", { text }))))] : []),
    section("Contrast", contrastList(style)),
    section("Changes", diffView(port, ps, problems)));
  ui.apply.disabled = problems.length > 0 || sameStyle(style, ps.current.style) || port.candidateBlock(style) === null;
  kits?.update();
}

interface PanelDraw { drawAll(): void; rebuild(): void; destroy(): void; isDestroyed(): boolean }

/** The drawing of the panel: the cards, the token fields and the checks, with the debounced preview of an edited field. */
function createPanelDraw(port: DeckStylePort, ps: PanelState, ui: PanelUi, previews: PanelPreviews, kits: () => Kits | undefined): PanelDraw {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const cancel = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const drawGrid = (): void => {
    ui.grid.replaceChildren(cardGrid(ps.cards, ps.chosen, previews, (index) => { ps.chosen = index; drawAll(); stageChosen(port, ps); }));
    previews.pump();
  };
  const edit: StyleEdit = (token, value) => {
    const card = ps.cards[ps.chosen]!;
    ps.cards[ps.chosen] = { ...card, style: { ...card.style, [token]: value } };
    drawChecks(port, ps, ui, kits());
    stageChosen(port, ps);
    cancel();
    timer = setTimeout(() => { timer = undefined; if (!destroyed && validateDeckStyle(ps.cards[ps.chosen]!.style).length === 0) drawGrid(); }, PREVIEW_DELAY_MS);
  };
  const drawAll = (): void => {
    cancel();
    drawGrid();
    ui.fields.replaceChildren(section("Tokens", tokenFields(ps.cards[ps.chosen]!.style, edit)));
    drawChecks(port, ps, ui, kits());
  };
  const rebuild = (): void => {
    ps.cards = namedStyleCandidates(ps.current.style, ps.offset);
    ps.chosen = 0;
    drawAll();
  };
  return { drawAll, rebuild, isDestroyed: () => destroyed, destroy() { destroyed = true; cancel(); } };
}

/** Wires Close, More, Apply and the keys of the panel; returns the host's `refresh`. */
function bindPanelActions(port: DeckStylePort, ps: PanelState, ui: PanelUi, draw: PanelDraw, previews: PanelPreviews, onClose: () => void): () => void {
  const closePanel = (): void => { port.stagePreview?.(null); onClose(); };
  ui.close.addEventListener("click", closePanel);
  ui.more.addEventListener("click", () => { ps.offset += 3; draw.rebuild(); });
  const refresh = (): void => {
    if (draw.isDestroyed()) return;
    const next = port.read();
    if (next.block === ps.current.block && sameStyle(next.style, ps.current.style)) return;
    if (next.block !== ps.current.block) previews.clear();
    ps.current = next;
    draw.rebuild();
  };
  ui.apply.addEventListener("click", () => {
    if (ui.apply.disabled) return;
    port.stagePreview?.(null);
    if (!port.apply(ps.cards[ps.chosen]!.style)) return;
    refresh();
  });
  // Keys typed in the panel are the panel's: the editor's undo and nudge keys must not see them.
  ui.element.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); closePanel(); }
  });
  return refresh;
}

/**
 * Mounts the Style panel over `port`; the host places `element`, calls `refresh` after the deck changes and `destroy` when it closes.
 * With `kits` it has a Kits section; `kitImage` replaces the canvas and image decoder of From logo… (tests).
 */
export function mountStylePanel(port: DeckStylePort, options: { onClose(): void; kits?: DeckKitsPort; kitImage?: KitImageDeps }): { element: HTMLElement; refresh(): void; destroy(): void } {
  const previews = createStylePreviews(port);
  const ps: PanelState = { current: port.read(), offset: 0, cards: [], chosen: 0 };
  const ui = buildPanelUi();
  let kits: Kits | undefined;
  const draw = createPanelDraw(port, ps, ui, previews, () => kits);
  kits = options.kits ? mountKitsSection(options.kits, {
    chosen: () => ps.cards[ps.chosen]!,
    choose(card) {
      const same = ps.cards.findIndex((existing) => existing.name === card.name);
      if (same >= 0) ps.cards[same] = card; else ps.cards.push(card);
      ps.chosen = same >= 0 ? same : ps.cards.length - 1;
      draw.drawAll();
      stageChosen(port, ps);
    },
  }, options.kitImage) : undefined;
  if (kits) ui.more.after(kits.element);
  const refresh = bindPanelActions(port, ps, ui, draw, previews, options.onClose);
  draw.rebuild();
  return {
    element: ui.element,
    refresh,
    destroy() {
      draw.destroy();
      port.stagePreview?.(null);
      previews.destroy();
      kits?.destroy();
      ui.element.remove();
    },
  };
}
