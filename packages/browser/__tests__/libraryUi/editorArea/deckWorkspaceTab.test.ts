// resolveDroppedImage: a file-tree drop becomes a path relative to the deck's folder, or nothing. downloadBuiltDeckPdf (11.3): a compiled
// talk's PDF asks the talk choices and is laid out with the notes and frames of describeSourceDeck.
import { TALK_PDF_CHOICES, describeSourceDeck } from "@labshelf/core";
import { downloadBuiltDeckPdf, resolveDroppedImage } from "../../../src/libraryUi/editorArea/deckWorkspaceTab";

const mockPick = jest.fn(async (_items: Array<{ label: string; value: number }>, _options?: unknown): Promise<number | undefined> => undefined);
const mockLayout = jest.fn(async (..._args: unknown[]) => Uint8Array.from([9]));
const mockDownload = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), pickQuickEntry: (...args: [never, never]) => mockPick(...args) }));
jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), layoutTalkPdf: (...args: unknown[]) => mockLayout(...args) }));
jest.mock("../../../src/platform", () => ({ ...jest.requireActual("../../../src/platform"), downloadBytes: (...args: unknown[]) => mockDownload(...args) }));

const deck = { projectIds: ["p1", "folder"], folder: "talks", typst: false };

describe("resolveDroppedImage", () => {
  it("returns the path relative to the deck folder", () => {
    expect(resolveDroppedImage([{ projectId: "p1", path: "figures/plot.png" }], deck)).toBe("../figures/plot.png");
  });

  it("accepts either name of the open project", () => {
    expect(resolveDroppedImage([{ projectId: "folder", path: "talks/a.svg" }], deck)).toBe("a.svg");
  });

  it("refuses a file of another project", () => {
    expect(resolveDroppedImage([{ projectId: "other", path: "figures/plot.png" }], deck)).toBeUndefined();
  });

  it("refuses pdf for Typst but not for LaTeX", () => {
    const files = [{ projectId: "p1", path: "figures/plot.pdf" }];
    expect(resolveDroppedImage(files, { ...deck, typst: true })).toBeUndefined();
    expect(resolveDroppedImage(files, deck)).toBe("../figures/plot.pdf");
  });

  it("refuses non-images and paths that leave the project", () => {
    expect(resolveDroppedImage([{ projectId: "p1", path: "notes.txt" }], deck)).toBeUndefined();
    expect(resolveDroppedImage([{ projectId: "p1", path: "../x.png" }], deck)).toBeUndefined();
  });
});

describe("downloadBuiltDeckPdf of a talk", () => {
  const TYP = "#import \"@preview/touying:0.5.2\": *\n#show: university-theme\n= One\n#speaker-note[First note]\n= Two\n";
  const PATH = "talks/intro/main.typ";
  const pickLabel = (label: string | undefined): void => {
    mockPick.mockImplementation(async (items) => items.find((item) => item.label === label)?.value);
  };
  beforeEach(() => jest.clearAllMocks());

  it("11.3 Handout 6 per page downloads <name>-handout.pdf laid out with the source's notes and frames", async () => {
    pickLabel("Handout, 6 per page");
    await downloadBuiltDeckPdf(PATH, TYP, Uint8Array.from([1]));
    expect(mockPick.mock.calls[0]![0].map((item) => item.label)).toEqual(TALK_PDF_CHOICES.map((choice) => choice.label));
    const { notes, frames } = describeSourceDeck("typst", PATH, TYP)!;
    expect(mockLayout).toHaveBeenCalledWith(Uint8Array.from([1]), { kind: "handout", perPage: 6 }, { notes, frames, format: "typst" });
    expect(mockDownload).toHaveBeenCalledWith(Uint8Array.from([9]), "intro-handout.pdf", "application/pdf");
  });

  it("11.3 Notes pages download <name>-notes.pdf, PDF the built bytes, and a dismissed pick nothing", async () => {
    pickLabel("Notes pages");
    await downloadBuiltDeckPdf(PATH, TYP, Uint8Array.from([1]));
    expect(mockDownload.mock.calls[0]![1]).toBe("intro-notes.pdf");
    pickLabel("PDF");
    await downloadBuiltDeckPdf(PATH, TYP, Uint8Array.from([1]));
    expect(mockDownload.mock.calls[1]).toEqual([Uint8Array.from([1]), "intro.pdf", "application/pdf"]);
    pickLabel(undefined);
    await downloadBuiltDeckPdf(PATH, TYP, Uint8Array.from([1]));
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(mockLayout).toHaveBeenCalledTimes(1);
  });
});
