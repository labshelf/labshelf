/** @jest-environment jsdom */
/**
 * Spec 6.2: link badges — renderLinkBadges on its own (targets in, onUpdate out, the badges it puts in each box) and in openDeckEditor
 * with `linkSources` (badges for the current slide, one Update linked block change). jsdom does not load srcdoc frames, so a
 * MutationObserver loads each srcdoc into its frame. Editor helpers throw `not implemented: …` when no badge appears.
 */
import { parseDeck } from "../../../src/decks/deckParse";
import { deckLinkHash, updateDeckLink, type DeckLinkSources, type DeckLinkStatus as LinkStatus } from "../../../src/decks/deckLinks";
import { openDeckEditor, type DeckEditorChange, type DeckEditorController, type DeckEditorOptions } from "../../../src/decks/dom/openDeckEditor";
import { renderLinkBadges } from "../../../src/decks/dom/deckOverlay";

// The seam stubs `plan red` writes carry no imports; this global lets them compile. The real module imports its own type.
declare global {
  type DeckLinkStatus = import("../../../src/decks/deckLinks").DeckLinkStatus;
}

const THEME = ":root { --deck-bg: #ffffff; }\n";
const STYLE = (top: number) => `left: 120px; top: ${top}px; width: 400px; height: 200px;`;
const PLOT = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const CHART = new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9]);

function deck(chartHash: string): string {
  return [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    '<head>\n<meta charset="utf-8">\n<title>Links</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
    "<body>",
    "<section data-slide>",
    `<div data-block="plot" data-source="figure:figures/plot.png" data-source-hash="000000000000" style="${STYLE(80)}"><p>Plot</p></div>`,
    `<div data-block="chart" data-source="figure:figures/chart.png" data-source-hash="${chartHash}" style="${STYLE(320)}"><p>Chart</p></div>`,
    `<div data-block="gone" data-source="figure:figures/gone.png" data-source-hash="000000000000" style="${STYLE(560)}"><p>Gone</p></div>`,
    "</section>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const sources: DeckLinkSources = {
  readFigure: async (path: string) => (path === "figures/plot.png" ? PLOT : path === "figures/chart.png" ? CHART : undefined),
  labelSource: async () => undefined,
  citeText: async () => undefined,
};

// --- jsdom shims -------------------------------------------------------------------------------------------------------------------

const written = new WeakMap<HTMLIFrameElement, string>();
let observer: MutationObserver | undefined;

function loadSrcdocFrames(): void {
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    const srcdoc = frame.getAttribute("srcdoc");
    const doc = frame.contentDocument;
    if (srcdoc == null || !doc || written.get(frame) === srcdoc) continue;
    written.set(frame, srcdoc);
    doc.open();
    doc.write(srcdoc);
    doc.close();
    frame.dispatchEvent(new Event("load"));
  }
}

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  el.hasPointerCapture ??= () => false;
  observer = new MutationObserver(loadSrcdocFrames);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
});

afterAll(() => observer?.disconnect());

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    loadSrcdocFrames();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let editor: DeckEditorController | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = "";
});

const buttons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>("button, [role='button']"));
const updateButton = (root: ParentNode, block: string) => buttons(root).find((b) => b.getAttribute("aria-label") === `Update block ${block} from its source`) ?? null;
const countOf = (text: string, part: string) => text.split(part).length - 1;

function makeBox(): HTMLElement {
  const box = document.createElement("div");
  document.body.append(box);
  return box;
}

// --- 6.2d unit ----------------------------------------------------------------------------------------------------------------------

describe("renderLinkBadges", () => {
  it("6.2d a stale target gets an Out of date badge with an Update button inside its box", () => {
    const box = makeBox();
    renderLinkBadges([{ block: "plot", status: { state: "stale", hash: "0123456789ab" }, box }], jest.fn());
    expect(box.textContent).toContain("Out of date");
    const button = updateButton(box, "plot");
    expect(button).not.toBeNull();
    expect((button!.textContent ?? "").trim()).toBe("Update");
  });

  it("6.2d Update calls onUpdate with the block and its status", () => {
    const box = makeBox();
    const status: LinkStatus = { state: "stale", hash: "0123456789ab", text: "Smith (2020)." };
    const onUpdate = jest.fn<void, [string, LinkStatus]>();
    renderLinkBadges([{ block: "ref", status, box }], onUpdate);
    updateButton(box, "ref")!.click();
    expect(onUpdate.mock.calls).toEqual([["ref", status]]);
  });

  it("6.2d a missing target shows Source missing without an Update button", () => {
    const box = makeBox();
    renderLinkBadges([{ block: "gone", status: { state: "missing" }, box }], jest.fn());
    expect(box.textContent).toContain("Source missing");
    expect(box.textContent).not.toContain("Out of date");
    expect(buttons(box)).toHaveLength(0);
  });

  it("6.2d a fresh target gets no badge", () => {
    const box = makeBox();
    box.textContent = "Chart";
    renderLinkBadges([{ block: "chart", status: { state: "fresh", hash: "0123456789ab" }, box }], jest.fn());
    expect(box.textContent).toBe("Chart");
    expect(box.children).toHaveLength(0);
  });
});

// --- 6.2d editor --------------------------------------------------------------------------------------------------------------------

describe("openDeckEditor link badges", () => {
  async function open(html: string) {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = jest.fn<void, [DeckEditorChange]>();
    const options = { html, theme: THEME, resolveAsset: async (p: string) => `blob:asset/${p}`, onChange, linkSources: sources } as DeckEditorOptions;
    editor = openDeckEditor(host, options);
    await settle();
    return { host, onChange };
  }
  function need<T>(value: T | null | undefined, what: string): T {
    if (value == null) throw new Error(`not implemented: ${what}`);
    return value;
  }

  it("6.2d a stale block shows Out of date with Update, a missing one Source missing, a fresh one nothing", async () => {
    const chartHash = await deckLinkHash(CHART);
    const { host } = await open(deck(chartHash));
    need(updateButton(document, "plot"), "no Update button for the stale block plot");
    const text = host.textContent ?? "";
    expect(countOf(text, "Out of date")).toBe(1);
    expect(countOf(text, "Source missing")).toBe(1);
    expect(updateButton(document, "chart")).toBeNull();
    expect(updateButton(document, "gone")).toBeNull();
  });

  it("6.2d Update gives one Update linked block change whose hash is current", async () => {
    const chartHash = await deckLinkHash(CHART);
    const plotHash = await deckLinkHash(PLOT);
    const html = deck(chartHash);
    const { onChange } = await open(html);
    need(updateButton(document, "plot"), "no Update button for the stale block plot").click();
    await settle();
    const expected = updateDeckLink(html, "plot", plotHash);
    if (!expected.ok) throw new Error(expected.error);
    expect(onChange.mock.calls.map(([c]) => c)).toEqual([{ html: expected.html, theme: THEME, label: "Update linked block" }]);
    const block = parseDeck(expected.html).model!.slides[0]!.blocks.find((b) => b.id === "plot")!;
    expect(block.source?.hash).toBe(plotHash);
    expect(updateButton(document, "plot")).toBeNull();
  });
});
