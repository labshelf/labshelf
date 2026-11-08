/** @jest-environment jsdom */
// Spec 9.3: New slide in the HTML shell writes the grid-cell section as one step (9.3b, A9), the Style toggle and panel stay visible in Visual and Split,
// the Style panel drives an optional stagePreview, and the controller's previewThemeCss shows a theme on the frame without an edit (9.3c).
// Written as if the file sat at packages/core/__tests__/decks/dom/deckEditorCore.test.ts; relative imports are resolved from there.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDeck } from "../../../src/decks/deckParse";
import { deckSlideLayoutHtml, type DeckSlideLayout } from "../../../src/decks/deckSlideLayouts";
import { DEFAULT_DECK_STYLE, DECK_STYLE_TOKENS, validateDeckStyle, type DeckStyle } from "../../../src/decks/deckStyleTokens";
import { mountStylePanel } from "../../../src/decks/dom/style/panel";
import type { DeckStylePort, DeckStylePreview } from "../../../src/decks/dom/style/types";
import { DECK, THEME, MOD, blockIds, buttonIn, host, lastChange, moveA, named, openWs, press, root, settle, stage, toolbarOf, workspace } from "./shell/html/shellHarness";

const CANVAS = { width: 1920, height: 1080 };

// --- New slide (9.3b, A9) ------------------------------------------------------------------------------------------------------------

async function addSlide(label: string) {
  const onChange = await openWs();
  const before = onChange.mock.calls.length;
  buttonIn(toolbarOf("Insert"), "New slide")!.click();
  await settle();
  const item = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']")).find((i) => i.textContent!.trim() === label);
  if (!item) throw new Error(`no layout menu item ${label}`);
  item.click();
  await settle();
  return { onChange, before };
}

const expectedBlocks = (layout: DeckSlideLayout): string[] => {
  const model = parseDeck(DECK, { theme: THEME }).model;
  return deckSlideLayoutHtml(model, layout, THEME, CANVAS).split("\n").map((line) => line.trim()).filter((line) => line.startsWith("<div"));
};

describe("9.3b New slide in the HTML shell", () => {
  it("9.3b adds the cell-class blocks of deckSlideLayoutHtml after the current slide", async () => {
    const { onChange } = await addSlide("Title and text");
    const html = lastChange(onChange).html;
    const expected = expectedBlocks("title-text");
    expect(expected).toHaveLength(2);
    for (const block of expected) expect(html).toContain(block);
    expect(blockIds(html, 1)).toEqual(["title-1", "text-1"]);
    expect(blockIds(html, 2)).toEqual(["body"]);
  });

  it("9.3b makes the new slide one 'Add slide' step", async () => {
    const { onChange, before } = await addSlide("Two columns");
    expect(onChange.mock.calls.length - before).toBe(1);
    expect(lastChange(onChange).label).toBe("Add slide");
  });

  it("9.3b one Undo removes the added slide", async () => {
    const { onChange } = await addSlide("Two columns");
    press("z", MOD);
    await settle();
    expect(lastChange(onChange).label).toBe("Undo");
    expect(lastChange(onChange).html).toBe(DECK);
  });

  it("9.3b shows the new slide", async () => {
    await addSlide("Title and text");
    expect(workspace!.currentSlide()).toBe(1);
  });
});

describe("A9 new-slide layouts are classes", () => {
  it("A9 a Two columns slide places its blocks by grid cells on the default grid", async () => {
    const { onChange } = await addSlide("Two columns");
    const blocks = parseDeck(lastChange(onChange).html, { theme: THEME }).model!.slides[1]!.blocks;
    expect(blocks.map((b) => [b.id, b.cell])).toEqual([
      ["title-1", { col: 1, row: 1, span: 12, rows: 1 }],
      ["text-1", { col: 1, row: 2, span: 6, rows: 5 }],
      ["text-2", { col: 7, row: 2, span: 6, rows: 5 }],
    ]);
  });

  it("A9 the new blocks carry no style attribute", async () => {
    const { onChange } = await addSlide("Title");
    const html = lastChange(onChange).html;
    const block = html.slice(html.indexOf('data-block="title-1"'));
    expect(block.slice(0, block.indexOf(">"))).toContain('class="col-2 row-3 span-10 rows-1"');
    expect(block.slice(0, block.indexOf(">"))).not.toContain("style=");
  });
});

// --- The Style toggle is shown in Visual and Split (9.3c) --------------------------------------------------------------------------

describe("9.3c shell.css and the Style toggle", () => {
  const css = readFileSync(join(__dirname, "../../../src/decks/dom/shell/shell.css"), "utf8");
  let sheet: HTMLStyleElement;
  beforeEach(() => { sheet = document.createElement("style"); sheet.textContent = css; document.head.append(sheet); });
  afterEach(() => sheet.remove());

  /** Whether `el` or an ancestor up to the shell root is hidden by display. */
  const hidden = (el: Element): boolean => {
    for (let node: Element | null = el; node && node !== root().parentElement; node = node.parentElement) if (getComputedStyle(node).display === "none") return true;
    return false;
  };
  const mode = (name: "visual" | "split" | "code"): void => root().setAttribute("data-mode", name);
  const styleButton = (): HTMLElement => named("Style")!;

  it("9.3c the stylesheet applies: the insert bar is hidden in Code", async () => {
    await openWs();
    mode("code");
    expect(hidden(toolbarOf("Insert")!)).toBe(true);
  });

  it("9.3c the Style toggle is not hidden in Visual", async () => {
    await openWs();
    mode("visual");
    expect(styleButton()).not.toBeNull();
    expect(hidden(styleButton())).toBe(false);
  });

  it("9.3c the Style toggle is not hidden in Split", async () => {
    await openWs();
    mode("split");
    expect(hidden(styleButton())).toBe(false);
  });

  it("9.3c one click on Style opens the Style panel, which is shown in Visual", async () => {
    await openWs();
    mode("visual");
    styleButton().click();
    const panel = host.querySelector<HTMLElement>("aside.dsh-style");
    expect(panel).not.toBeNull();
    expect(hidden(panel!)).toBe(false);
  });

  it("9.3c the Style panel is shown in Split while the properties stay hidden", async () => {
    await openWs();
    mode("split");
    styleButton().click();
    const panel = host.querySelector<HTMLElement>("aside.dsh-style");
    expect(panel).not.toBeNull();
    expect(hidden(panel!)).toBe(false);
  });

  it("9.3c the properties panel is still hidden in Split without the Style panel", async () => {
    await openWs();
    mode("split");
    expect(hidden(host.querySelector<HTMLElement>("aside.dw-props:not(.dsh-style)")!)).toBe(true);
  });
});

// --- The panel drives stagePreview (9.3c) ------------------------------------------------------------------------------------------

const blockOf = (style: DeckStyle): string => DECK_STYLE_TOKENS.map((token) => `--${token}: ${style[token]};`).join("\n");

describe("9.3c the Style panel calls stagePreview", () => {
  let log: string[];
  let previewed: Array<DeckStyle | null>;
  let applied: DeckStyle[];
  let panel: ReturnType<typeof mountStylePanel> | undefined;
  const onClose = jest.fn();

  function port(withStage = true): DeckStylePort {
    const p: DeckStylePort = {
      read: () => ({ style: DEFAULT_DECK_STYLE, block: blockOf(DEFAULT_DECK_STYLE) }),
      candidateBlock: (style) => (validateDeckStyle(style).length > 0 ? null : blockOf(style)),
      preview: (): Promise<DeckStylePreview> => Promise.resolve({ kind: "swatches", note: "none" }),
      apply(style) { log.push("apply"); applied.push(style); return true; },
      ...(withStage ? { stagePreview(style: DeckStyle | null) { log.push(style === null ? "null" : "style"); previewed.push(style); } } : {}),
    };
    return p;
  }
  function mount(withStage = true): HTMLElement {
    panel = mountStylePanel(port(withStage), { onClose });
    document.body.append(panel.element);
    return panel.element;
  }
  const cards = (el: HTMLElement): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>(".dsh-style-card"));
  const applyButton = (el: HTMLElement): HTMLButtonElement => Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === "Apply")!;

  beforeEach(() => { log = []; previewed = []; applied = []; onClose.mockReset(); });
  afterEach(() => { panel?.destroy(); panel = undefined; document.body.innerHTML = ""; });

  it("9.3c choosing a candidate calls stagePreview with the style the panel would apply", () => {
    const el = mount();
    cards(el)[1]!.click();
    const last = previewed[previewed.length - 1];
    expect(last).not.toBeNull();
    expect(validateDeckStyle(last!)).toEqual([]);
    expect(last).not.toEqual(DEFAULT_DECK_STYLE);
    applyButton(el).click();
    expect(applied[0]).toEqual(last);
  });

  it("9.3c changing a field calls stagePreview with the edited style", () => {
    const el = mount();
    cards(el)[1]!.click();
    const calls = previewed.length;
    const input = el.querySelector<HTMLInputElement>('[aria-label="Primary hex"]')!;
    input.value = "#224466";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(previewed.length).toBeGreaterThan(calls);
    expect(previewed[previewed.length - 1]!.primary).toBe("#224466");
  });

  it("9.3c Apply calls stagePreview with null before it writes the style", () => {
    const el = mount();
    cards(el)[1]!.click();
    applyButton(el).click();
    expect(applied).toHaveLength(1);
    const at = log.indexOf("apply");
    expect(log.slice(0, at)).toContain("null");
    expect(log[at - 1]).toBe("null");
  });

  it("9.3c Close calls stagePreview with null", () => {
    const el = mount();
    cards(el)[1]!.click();
    el.querySelector<HTMLElement>('[aria-label="Close"]')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(previewed[previewed.length - 1]).toBeNull();
  });

  it("9.3c destroy calls stagePreview with null", () => {
    const el = mount();
    cards(el)[2]!.click();
    expect(previewed[previewed.length - 1]).not.toBeNull();
    panel!.destroy();
    expect(previewed[previewed.length - 1]).toBeNull();
  });

  it("9.3c a port without stagePreview still works", () => {
    const el = mount(false);
    cards(el)[1]!.click();
    applyButton(el).click();
    expect(applied).toHaveLength(1);
    panel!.destroy();
  });
});

describe("9.3c the HTML shell previews a Style candidate on the stage", () => {
  const themeOnFrame = (): string => {
    const frame = stage().querySelector("iframe") ?? host.querySelector("iframe");
    return frame!.contentDocument!.querySelector("style[data-deck-theme]")!.textContent ?? "";
  };
  const cards = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>(".dsh-style-card"));

  it("9.3c choosing a candidate re-renders the frame with another theme and closing restores it", async () => {
    const onChange = await openWs();
    expect(themeOnFrame()).toBe(THEME);
    named("Style")!.click();
    cards()[1]!.click();
    await settle();
    expect(themeOnFrame()).not.toBe(THEME);
    expect(onChange).not.toHaveBeenCalled();
    host.querySelector<HTMLElement>('.dsh-style [aria-label="Close"]')!.click();
    await settle();
    expect(themeOnFrame()).toBe(THEME);
    expect(onChange).not.toHaveBeenCalled();
  });
});

// --- previewThemeCss (9.3c) --------------------------------------------------------------------------------------------------------

describe("9.3c controller previewThemeCss", () => {
  const PREVIEW = `${THEME}:root { --deck-bg: #ff00ff; }\n`;
  const themeOnFrame = (): string => {
    const frame = stage().querySelector("iframe") ?? host.querySelector("iframe");
    return frame!.contentDocument!.querySelector("style[data-deck-theme]")!.textContent ?? "";
  };

  it("9.3c shows the css as the frame's theme text", async () => {
    await openWs();
    workspace!.previewThemeCss(PREVIEW);
    await settle();
    expect(themeOnFrame()).toContain("#ff00ff");
  });

  it("9.3c makes no onChange call and no history entry", async () => {
    const onChange = await openWs();
    workspace!.previewThemeCss(PREVIEW);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(buttonIn(toolbarOf("Insert"), "Undo")!.disabled).toBe(true);
    workspace!.undo();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.3c null restores the real theme", async () => {
    await openWs();
    workspace!.previewThemeCss(PREVIEW);
    await settle();
    workspace!.previewThemeCss(null);
    await settle();
    expect(themeOnFrame()).toBe(THEME);
  });

  it("9.3c null with no preview changes nothing", async () => {
    const onChange = await openWs();
    workspace!.previewThemeCss(null);
    await settle();
    expect(themeOnFrame()).toBe(THEME);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("9.3c an edit clears the preview and does not write it into the theme", async () => {
    const onChange = await openWs();
    workspace!.previewThemeCss(PREVIEW);
    await settle();
    workspace!.edit([moveA(264)], "Move block");
    await settle();
    expect(themeOnFrame()).toBe(THEME);
    expect(lastChange(onChange).theme).toBe(THEME);
  });

  it("9.3c editThemeCss clears the preview and shows the new theme", async () => {
    const onChange = await openWs();
    workspace!.previewThemeCss(PREVIEW);
    await settle();
    const next = `${THEME}:root { --deck-fg: #00ff00; }\n`;
    workspace!.editThemeCss(next, "Theme");
    await settle();
    expect(themeOnFrame()).toContain("#00ff00");
    expect(themeOnFrame()).not.toContain("#ff00ff");
    expect(lastChange(onChange).theme).toBe(next);
  });
});
