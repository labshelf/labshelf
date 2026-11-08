/** @jest-environment jsdom */
/** Spec 4.1a to 4.1c: the Style presets and candidates, and the Style panel over a fake port: cards, lazy cached previews, token fields, contrast, diff and Apply. */
import { DEFAULT_DECK_STYLE, DECK_STYLE_TOKENS, deckStyleContrast, validateDeckStyle, type DeckStyle } from "../../../../src/decks/deckStyleTokens";
import { DECK_STYLE_PRESETS, mountStylePanel, styleCandidates } from "../../../../src/decks/dom/style/panel";
import type { DeckStylePort, DeckStylePreview } from "../../../../src/decks/dom/style/types";
import { watchStyleMarkup } from "../styleMarkupWatch";

const blockOf = (style: DeckStyle): string => DECK_STYLE_TOKENS.map((token) => `--${token}: ${style[token]};`).join("\n");

interface Fake extends DeckStylePort { previews: DeckStyle[]; applied: DeckStyle[]; current: DeckStyle }

function fakePort(preview?: (style: DeckStyle) => Promise<DeckStylePreview>): Fake {
  const port: Fake = {
    current: DEFAULT_DECK_STYLE, previews: [], applied: [],
    read: () => ({ style: port.current, block: blockOf(port.current) }),
    candidateBlock: (style) => (validateDeckStyle(style).length > 0 ? null : blockOf(style)),
    preview(style) { port.previews.push(style); return preview ? preview(style) : Promise.resolve({ kind: "image", src: `data:image/png,${style.primary}` }); },
    apply(style) { port.applied.push(style); port.current = style; return true; },
  };
  return port;
}

let panel: ReturnType<typeof mountStylePanel> | undefined;
const onClose = jest.fn();
afterEach(() => { panel?.destroy(); panel = undefined; document.body.innerHTML = ""; onClose.mockReset(); jest.useRealTimers(); });

function mount(port: DeckStylePort): HTMLElement {
  panel = mountStylePanel(port, { onClose });
  document.body.append(panel.element);
  return panel.element;
}
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const cards = (el: HTMLElement): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>(".dsh-style-card"));
const byLabel = <T extends HTMLElement = HTMLButtonElement>(el: HTMLElement, label: string): T => {
  const found = el.querySelector<T>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no control labelled ${label}`);
  return found;
};
const applyButton = (el: HTMLElement): HTMLButtonElement => Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Apply")!;
function edit(input: HTMLInputElement, value: string): void { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); }
const diffLines = (el: HTMLElement, kind: string): string[] => Array.from(el.querySelectorAll(`.ls-history-line-${kind}`)).map((line) => line.textContent!.replace(/^[+−]/, ""));

describe("Style panel layout and previews (4.1b)", () => {
  it("4.1b has the title, a Close button and four cards, the first one Current and chosen", () => {
    const el = mount(fakePort());
    expect(el.textContent).toContain("Style");
    byLabel(el, "Close").click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cards(el)).toHaveLength(4);
    expect(cards(el)[0]!.textContent).toContain("Current");
    expect(cards(el).map((card) => card.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(cards(el)[1]!.textContent).toContain("Forest");
  });

  it("4.1b Escape inside the panel closes it", () => {
    const el = mount(fakePort());
    el.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("4.1b requests the previews one at a time in card order and shows images", async () => {
    let release: Array<() => void> = [];
    const port = fakePort((style) => new Promise((resolve) => release.push(() => resolve({ kind: "image", src: `data:image/png,${style.primary}` }))));
    const el = mount(port);
    await flush();
    expect(port.previews).toHaveLength(1);
    expect(port.previews[0]).toEqual(DEFAULT_DECK_STYLE);
    for (let i = 1; i <= 4; i += 1) { const go = release; release = []; go.forEach((run) => run()); await flush(); expect(port.previews.length).toBe(Math.min(i + 1, 4)); }
    const images = cards(el).map((card) => card.querySelector("img")?.getAttribute("src"));
    expect(images).toEqual(port.previews.map((style) => `data:image/png,${style.primary}`));
  });

  it("4.1b caches the previews by style: More and back asks again only for new styles", async () => {
    const port = fakePort();
    const el = mount(port);
    await flush();
    expect(port.previews).toHaveLength(4);
    // offset 3 starts at Slate, which the first page already showed (Ocean is skipped: it is the current colours)
    byLabel(el, "More").click();
    await flush();
    expect(port.previews).toHaveLength(6);
    byLabel(el, "More").click();
    await flush();
    expect(port.previews.length).toBeLessThanOrEqual(10);
    const asked = new Set(port.previews.map((style) => JSON.stringify(style)));
    expect(asked.size).toBe(port.previews.length);
  });

  it("4.1b a swatches preview shows the five colours and the note; a rejected preview shows Preview failed", async () => {
    const watch = watchStyleMarkup();
    try {
      let n = 0;
      const port = fakePort(() => (n++ === 0 ? Promise.resolve<DeckStylePreview>({ kind: "swatches", note: "Preview unavailable" }) : Promise.reject(new Error("boom"))));
      const el = mount(port);
      await flush();
      expect(cards(el)[0]!.querySelectorAll(".dsh-style-swatch")).toHaveLength(5);
      expect(cards(el)[0]!.textContent).toContain("Preview unavailable");
      expect(cards(el)[1]!.querySelectorAll(".dsh-style-swatch")).toHaveLength(5);
      expect(cards(el)[1]!.textContent).toContain("Preview failed");
    } finally { watch.restore(); }
    expect(watch.writes).toEqual([]);
  });

  it("4.1b asks for no preview once destroyed", async () => {
    const port = fakePort();
    mount(port);
    panel!.destroy();
    panel = undefined;
    await flush();
    expect(port.previews.length).toBeLessThanOrEqual(1);
  });
});

describe("Style panel tokens, contrast, diff and Apply (4.1c)", () => {
  it("4.1c Apply is disabled for the current style and enabled for another card", () => {
    const el = mount(fakePort());
    expect(applyButton(el).disabled).toBe(true);
    cards(el)[1]!.click();
    expect(cards(el)[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(applyButton(el).disabled).toBe(false);
  });

  it("4.1c editing a colour updates the diff with only that line and re-previews the candidate after 300 ms", async () => {
    jest.useFakeTimers();
    const port = fakePort();
    const el = mount(port);
    await flush();
    const before = port.previews.length;
    edit(byLabel<HTMLInputElement>(el, "Primary hex"), "#224466");
    expect(diffLines(el, "removed")).toEqual(["--primary: #1f5673;"]);
    expect(diffLines(el, "added")).toEqual(["--primary: #224466;"]);
    expect(applyButton(el).disabled).toBe(false);
    expect(port.previews.length).toBe(before);
    jest.advanceTimersByTime(300);
    await flush();
    expect(port.previews.at(-1)!.primary).toBe("#224466");
  });

  it("4.1c the contrast list has one row per pair with one decimal, and a failing pair says Low contrast", () => {
    const el = mount(fakePort());
    const rows = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(".dsh-style-contrast li"));
    expect(rows()).toHaveLength(4);
    expect(rows().every((row) => /\d+\.\d:1/.test(row.textContent!))).toBe(true);
    expect(el.querySelectorAll(".is-warning")).toHaveLength(0);
    edit(byLabel<HTMLInputElement>(el, "Text hex"), "#eeeeee");
    const warning = rows().filter((row) => row.classList.contains("is-warning"));
    expect(warning).toHaveLength(1);
    expect(warning[0]!.textContent).toContain("Low contrast");
    expect(warning[0]!.textContent).toContain("Text");
  });

  it("4.1c an invalid style lists its problems and disables Apply", () => {
    const el = mount(fakePort());
    edit(byLabel<HTMLInputElement>(el, "Heading font"), "Bad{font}");
    expect(el.textContent).toContain("headingFont");
    expect(applyButton(el).disabled).toBe(true);
    edit(byLabel<HTMLInputElement>(el, "Heading font"), "Lato");
    expect(applyButton(el).disabled).toBe(false);
    edit(byLabel<HTMLInputElement>(el, "Scale"), "4");
    expect(applyButton(el).disabled).toBe(true);
  });

  it("4.1c Apply calls port.apply once and the applied style becomes the Current card", () => {
    const port = fakePort();
    const el = mount(port);
    cards(el)[2]!.click();
    const chosen = port.applied.length;
    applyButton(el).click();
    expect(port.applied).toHaveLength(chosen + 1);
    expect(cards(el)[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(cards(el)[0]!.textContent).toContain("Current");
    expect(applyButton(el).disabled).toBe(true);
    expect(port.current.primary).not.toBe(DEFAULT_DECK_STYLE.primary);
  });

  it("4.1c refresh keeps the chosen card while the block did not change", () => {
    const el = mount(fakePort());
    cards(el)[3]!.click();
    panel!.refresh();
    expect(cards(el)[3]!.getAttribute("aria-pressed")).toBe("true");
  });
});

const COLOURS = ["primary", "accent", "background", "text", "muted"] as const;
const colours = (style: DeckStyle): string => COLOURS.map((token) => style[token]).join();

describe("DECK_STYLE_PRESETS", () => {
  it("4.1a has the six named presets, Ocean being the default style", () => {
    expect(DECK_STYLE_PRESETS.map((preset) => preset.name)).toEqual(["Ocean", "Forest", "Ember", "Slate", "Plum", "High contrast"]);
    expect(DECK_STYLE_PRESETS[0]!.style).toEqual(DEFAULT_DECK_STYLE);
  });

  it("4.1a every preset is valid and passes every contrast pair", () => {
    for (const preset of DECK_STYLE_PRESETS) {
      expect(validateDeckStyle(preset.style)).toEqual([]);
      expect(deckStyleContrast(preset.style).filter((pair) => !pair.ok)).toEqual([]);
    }
  });

  it("4.1a the presets differ in their colours", () => {
    expect(new Set(DECK_STYLE_PRESETS.map((preset) => colours(preset.style))).size).toBe(6);
  });
});

describe("styleCandidates", () => {
  const custom: DeckStyle = { ...DEFAULT_DECK_STYLE, primary: "#123456", headingFont: "Lato", bodyFont: "Lato", scale: 1.2 };

  it("4.1a gives four styles, the current one first and three distinct presets after", () => {
    const candidates = styleCandidates(custom, 0);
    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toEqual(custom);
    const rest = candidates.slice(1).map(colours);
    expect(new Set(rest).size).toBe(3);
    expect(rest).toEqual(DECK_STYLE_PRESETS.slice(0, 3).map((preset) => colours(preset.style)));
  });

  it("4.1a skips a preset with the current colours", () => {
    const rest = styleCandidates(DEFAULT_DECK_STYLE, 0).slice(1).map(colours);
    expect(rest).toEqual(DECK_STYLE_PRESETS.slice(1, 4).map((preset) => colours(preset.style)));
  });

  it("4.1a starts at the offset and wraps", () => {
    expect(styleCandidates(custom, 3).slice(1).map(colours)).toEqual(DECK_STYLE_PRESETS.slice(3, 6).map((preset) => colours(preset.style)));
    expect(styleCandidates(custom, 5).slice(1).map(colours)).toEqual([5, 0, 1].map((i) => colours(DECK_STYLE_PRESETS[i]!.style)));
    expect(styleCandidates(custom, 11).slice(1).map(colours)).toEqual(styleCandidates(custom, 5).slice(1).map(colours));
  });

  it("4.1a a preset keeps the current fonts and scale unless it sets them", () => {
    for (const [index, style] of styleCandidates(custom, 0).slice(1).entries()) {
      const preset = DECK_STYLE_PRESETS[index]!;
      expect(style.headingFont).toBe(preset.fonts ? preset.style.headingFont : "Lato");
      expect(style.scale).toBe(preset.scale ? preset.style.scale : 1.2);
    }
  });
});
