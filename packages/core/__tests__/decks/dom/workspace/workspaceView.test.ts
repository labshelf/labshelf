/** @jest-environment jsdom */
// workspaceView.ts, spec 7.2: the Overflow badges of a talk in the workspace: after a build state with overflow marks (LaTeX) or a PDF whose Typst slides
// spill onto extra pages, the slide grid and the structure panel mark those slides; none without, and a failed build keeps them.
// Acceptance ids: 7.2d, A7.
// These tests run Typst decks, which are off in the product.
jest.mock("../../../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { readSourceDeckBlocks } from "../../../../src/decks/index.js";
import { BEAMER, flush, mount, talk, type Rig } from "./workspaceHarness";

const openPdfDeck = jest.fn();
jest.mock("../../../../src/decks/dom/pdfDeck", () => ({ ...jest.requireActual("../../../../src/decks/dom/pdfDeck"), openPdfDeck: (...args: unknown[]) => openPdfDeck(...args) }));

const fakePdf = (pages: string[]) => ({
  count: pages.length, labels: null, pageSize: () => ({ width: 480, height: 270 }), render: async () => undefined,
  textRuns: async (page: number) => [{ text: pages[page] ?? "", pt: 20, left: 0, top: 0, width: 100 }], destroy: () => undefined,
});

beforeEach(() => {
  openPdfDeck.mockReset();
  openPdfDeck.mockImplementation(async () => fakePdf(["a", "b", "c"]));
});

const tree = readSourceDeckBlocks("latex", "talk", BEAMER);
const slides = tree.flatMap((node, index) => (node.kind === "slide" ? [index] : []));
const second = tree[slides[1]!]!;

const gridBadges = (rig: Rig): number[] => [...rig.root.querySelectorAll<HTMLElement>('.dw-slide-grid [role="option"]')]
  .flatMap((option) => (option.querySelector(".dsh-overflow-badge") ? [Number(option.dataset["slide"])] : []));
const panelBadges = (rig: Rig): number[] => [...rig.root.querySelectorAll<HTMLElement>(".dw-thumb")]
  .flatMap((thumb) => (thumb.querySelector(".dsh-overflow-badge") ? [Number(thumb.querySelector(".dw-thumb-number")!.textContent) - 1] : []));

async function built(rig: Rig, overflow?: { file: string; line: number }[]): Promise<void> {
  rig.emitBuild({ state: "building", errors: 0 });
  rig.emitBuild({ state: "succeeded", errors: 0, ...(overflow ? { overflow } : {}) });
  await flush();
}

describe("overflow badges", () => {
  it("7.2d a LaTeX build with an overflow mark badges its slide in the grid and in the structure panel", async () => {
    const rig = talk({ mode: "grid", pdf: true });
    await flush();
    await built(rig, [{ file: "talks/demo/main.tex", line: second.line + 1 }]);
    expect(gridBadges(rig)).toEqual([slides[1]]);
    expect(panelBadges(rig)).toEqual([slides[1]]);
    const badge = rig.root.querySelector<HTMLElement>(".dw-slide-grid .dsh-overflow-badge")!;
    expect(badge.textContent).toBe("Overflow");
    expect(badge.title).toBe("Content overflows this slide");
  });

  it("7.2d a build without overflow shows no badge, and the next good build clears the old ones", async () => {
    const rig = talk({ mode: "grid", pdf: true });
    await flush();
    await built(rig);
    expect(gridBadges(rig)).toEqual([]);
    expect(panelBadges(rig)).toEqual([]);
    await built(rig, [{ file: "talks/demo/main.tex", line: second.line }]);
    expect(gridBadges(rig)).toEqual([slides[1]]);
    await built(rig);
    expect(gridBadges(rig)).toEqual([]);
  });

  it("7.2d a failed build keeps the badges of the last good one", async () => {
    const rig = talk({ mode: "grid", pdf: true });
    await flush();
    await built(rig, [{ file: "talks/demo/main.tex", line: second.line }]);
    rig.emitBuild({ state: "building", errors: 0 });
    rig.emitBuild({ state: "failed", errors: 1 });
    await flush();
    expect(gridBadges(rig)).toEqual([slides[1]]);
  });

  it("7.2d a mark of another file badges nothing", async () => {
    const rig = talk({ mode: "grid", pdf: true });
    await flush();
    await built(rig, [{ file: "talks/demo/other.tex", line: second.line }]);
    expect(gridBadges(rig)).toEqual([]);
  });

  it("7.2d a Typst talk badges the slide that spills onto an extra page", async () => {
    const text = "#slide(title: [Alpha])[\n  A\n]\n#slide(title: [Beta])[\n  B\n]\n#slide(title: [Gamma])[\n  C\n]\n";
    openPdfDeck.mockImplementation(async () => fakePdf(["Alpha", "Beta", "Beta more", "Gamma"]));
    const rig = mount("talks/typ/main.typ", text, { mode: "grid", pdf: true });
    await flush();
    await built(rig);
    expect(gridBadges(rig)).toEqual([1]);
    expect(panelBadges(rig)).toEqual([1]);
  });
});
