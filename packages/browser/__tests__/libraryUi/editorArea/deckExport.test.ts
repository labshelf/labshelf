// Tests exportDeckFromBrowser (spec 9.3): Export PDF downloads the Helper's PDF when the Helper announces printPdf, otherwise opens the
// single-file HTML in a tab with #print and says what saves PDFs automatically; Export HTML downloads the single-file HTML built from the
// original asset bytes, with no external URL left in it.
// Written as if the file sat at packages/browser/__tests__/libraryUi/editorArea/deckExport.test.ts.
//
// Fakes: the Helper is an ILatexHelper-shaped object with status() and printPdf; the asset resolver is a plain object with 9.1's
// DeckAssetResolver shape (resolveAsset, original, dispose); download, openTab and notify are jest mocks.
import type { ILatexHelper } from "@labshelf/core/helper";
import { exportDeckHtml } from "../../../../core/src/decks/deckExport";
import { layoutTalkPdf } from "../../../../core/src/decks/deckHandout";
import { addPrintMarks } from "../../../../core/src/decks/deckPrintMarks";
import { SAMPLE_TALK, THEME } from "../../../../core/__tests__/decks/deckSamples";
import { exportDeckFromBrowser, type DeckExportPorts } from "../../../src/libraryUi/editorArea/deckExport";

const NAME = "my-talk";
const SIZE = "1920x1080px";
const PLOT = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
const PLOT_URI = `data:image/png;base64,${Buffer.from(PLOT).toString("base64")}`;
const PDF = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55, 10, 1, 2, 3]);

const HELPER_MESSAGE = "The deck opened for printing. Install LabShelf Helper to save PDFs automatically.";
const CHROMIUM_MESSAGE = "The deck opened for printing. Install Chromium or Chrome to save PDFs automatically.";

type PrintResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; reason: "noChromium" | "limit" | "failed" | "unsupported" | "cancelled"; message: string };

/** A ready HelperState (9.2 shape: optional capabilities on the ready state). */
const ready = (capabilities?: string[]): unknown => ({
  state: "ready",
  helperVersion: "1.0.0",
  tex: { source: "tinytex", complete: true },
  host: "helper",
  ...(capabilities ? { capabilities } : {}),
});

interface FakeHelper { helper: ILatexHelper; printPdf: jest.Mock }
function fakeHelper(state: unknown, result: PrintResult = { ok: true, pdf: PDF }): FakeHelper {
  const printPdf = jest.fn(async (_request: { html: string; size: string }, _signal?: AbortSignal) => result);
  const helper = { status: () => state, printPdf, connect: jest.fn(async () => state), disconnect: jest.fn() } as unknown as ILatexHelper;
  return { helper, printPdf };
}

function fakeAssets() {
  const files = new Map<string, Uint8Array>([["assets/plot.png", PLOT]]);
  return {
    resolveAsset: jest.fn(async (path: string) => `blob:proxy/${path}`),
    original: jest.fn(async (path: string) => files.get(path)),
    dispose: jest.fn(),
  };
}

function setup(helper: ILatexHelper | undefined, html = SAMPLE_TALK) {
  const download = jest.fn(async (_bytes: Uint8Array, _filename: string, _mime: string) => undefined);
  const openTab = jest.fn(async (_text: string, _mime: string, _fragment?: string) => undefined);
  const notify = jest.fn((_message: string) => undefined);
  const assets = fakeAssets();
  const ports: DeckExportPorts = { helper: () => helper, download, openTab, notify };
  const deck = { html, theme: THEME, name: NAME, size: SIZE, assets };
  return { ports, deck, download, openTab, notify, assets };
}

/** The single-file HTML the spec says both formats build: original assets, theme inlined, no math renderer. */
const expectedHtml = (): Promise<string> =>
  exportDeckHtml(SAMPLE_TALK, { theme: THEME, readAsset: async (path) => (path === "assets/plot.png" ? PLOT : undefined) });

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytesOf = (value: unknown): number[] => Array.from(value as Uint8Array);

/** Any src, href or srcset that is not a data URI or a fragment, or any url() that is not a data URI. */
function externalUrls(html: string): string[] {
  const attrs = [...html.matchAll(/\b(?:src|href|srcset)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]!).filter((v) => !v.startsWith("data:") && !v.startsWith("#"));
  const urls = [...html.matchAll(/url\(\s*["']?([^"')]*)/gi)].map((m) => m[1]!).filter((v) => !v.startsWith("data:"));
  return [...attrs, ...urls];
}

describe("exportDeckFromBrowser: PDF through the Helper", () => {
  it("9.3a downloads <name>.pdf with the Helper's bytes and returns pdf", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]));
    const { ports, deck, download, openTab } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("pdf");
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, filename, mime] = download.mock.calls[0]!;
    expect(bytesOf(bytes)).toEqual(Array.from(PDF));
    expect(filename).toBe(`${NAME}.pdf`);
    expect(mime).toBe("application/pdf");
    expect(openTab).not.toHaveBeenCalled();
  });

  it("9.3a asks the Helper to print the single-file HTML at the deck's size", async () => {
    const { helper, printPdf } = fakeHelper(ready(["printPdf"]));
    const { ports, deck } = setup(helper);
    await exportDeckFromBrowser("pdf", deck, ports);
    expect(printPdf).toHaveBeenCalledTimes(1);
    expect(printPdf.mock.calls[0]![0]).toEqual({ html: await expectedHtml(), size: SIZE });
  });
});

describe("exportDeckFromBrowser: PDF fallback", () => {
  it("9.3b without a Helper opens the HTML tab with #print and says to install LabShelf Helper", async () => {
    const { ports, deck, download, openTab, notify } = setup(undefined);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith(HELPER_MESSAGE);
    expect(download).not.toHaveBeenCalled();
  });

  it("9.3b with a Helper that is not connected falls back without printing", async () => {
    const { helper, printPdf } = fakeHelper(undefined);
    const { ports, deck, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(printPdf).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith(HELPER_MESSAGE);
  });

  it("9.3b with a not-installed Helper state falls back without printing", async () => {
    const { helper, printPdf } = fakeHelper({ state: "not-installed" });
    const { ports, deck, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(printPdf).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith(HELPER_MESSAGE);
  });

  it("9.3b with a ready Helper lacking the printPdf capability falls back without printing", async () => {
    const { helper, printPdf } = fakeHelper(ready());
    const { ports, deck, download, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(printPdf).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith(HELPER_MESSAGE);
  });

  it("9.3b with a Helper whose capabilities omit printPdf falls back", async () => {
    const { helper, printPdf } = fakeHelper(ready(["somethingElse"]));
    const { ports, deck, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(printPdf).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith(HELPER_MESSAGE);
  });

  it("9.3b with a Helper without Chromium opens the print tab and says to install Chromium or Chrome, and nothing else", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: false, reason: "noChromium", message: "No Chromium found." });
    const { ports, deck, download, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify.mock.calls).toEqual([[CHROMIUM_MESSAGE]]);
    expect(download).not.toHaveBeenCalled();
  });

  it("9.3b an unsupported reply falls back with the Helper message and no failure message", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: false, reason: "unsupported", message: "Update LabShelf Helper to export PDFs." });
    const { ports, deck, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify.mock.calls).toEqual([[HELPER_MESSAGE]]);
  });

  it("9.3b a failed print notifies 'PDF export failed: <message>' and opens the print tab", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: false, reason: "failed", message: "Chromium crashed." });
    const { ports, deck, download, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(notify).toHaveBeenCalledWith("PDF export failed: Chromium crashed.");
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(download).not.toHaveBeenCalled();
  });

  it("9.3b a print over the limit notifies 'PDF export failed: <message>' and opens the print tab", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: false, reason: "limit", message: "The deck is too large to print through LabShelf Helper." });
    const { ports, deck, openTab, notify } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(notify).toHaveBeenCalledWith("PDF export failed: The deck is too large to print through LabShelf Helper.");
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
  });

  it("9.3b a deck with errors notifies the export error and returns fallback without opening a tab", async () => {
    const { helper, printPdf } = fakeHelper(ready(["printPdf"]));
    const { ports, deck, download, openTab, notify } = setup(helper, "<!doctype html>\n<html><head></head><body></body></html>\n");
    await expect(exportDeckFromBrowser("pdf", deck, ports)).resolves.toBe("fallback");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatch(/^The deck has errors: /);
    expect(openTab).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(printPdf).not.toHaveBeenCalled();
  });
});

describe("exportDeckFromBrowser: HTML", () => {
  it("9.3c downloads <name>.html as UTF-8 text/html of the single-file HTML and returns html", async () => {
    const { ports, deck, download, openTab } = setup(undefined);
    await expect(exportDeckFromBrowser("html", deck, ports)).resolves.toBe("html");
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, filename, mime] = download.mock.calls[0]!;
    expect(filename).toBe(`${NAME}.html`);
    expect(mime).toBe("text/html");
    expect(decode(bytes)).toBe(await expectedHtml());
    expect(openTab).not.toHaveBeenCalled();
  });

  it("9.3c inlines the original asset bytes, not the resolver's proxy URLs", async () => {
    const { ports, deck, download, assets } = setup(undefined);
    await exportDeckFromBrowser("html", deck, ports);
    const text = decode(download.mock.calls[0]![0]);
    expect(assets.original).toHaveBeenCalledWith("assets/plot.png");
    expect(text).toContain(PLOT_URI);
    expect(text).not.toContain("blob:");
  });

  it("9.3c pre-renders math with renderMathSvg from loadMath when given", async () => {
    const { ports, deck, download } = setup(undefined);
    const renderMathSvg = jest.fn((_tex: string, _display: boolean) => '<svg data-fake-math="1"></svg>');
    await exportDeckFromBrowser("html", deck, { ...ports, loadMath: async () => ({ renderMathSvg }) });
    expect(renderMathSvg).toHaveBeenCalledWith("\\frac{a}{b}", true);
    expect(decode(download.mock.calls[0]![0])).toContain('data-fake-math="1"');
  });

  it("9.3c a deck with errors notifies the export error and downloads nothing", async () => {
    const { ports, deck, download, openTab, notify } = setup(undefined, "<!doctype html>\n<html><head></head><body></body></html>\n");
    await expect(exportDeckFromBrowser("html", deck, ports)).resolves.toBe("fallback");
    expect(notify.mock.calls[0]![0]).toMatch(/^The deck has errors: /);
    expect(download).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });
});

describe("exportDeckFromBrowser: A7", () => {
  it("A7 browser PDF export gives the Helper's PDF bytes unchanged", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]));
    const { ports, deck, download } = setup(helper);
    expect(await exportDeckFromBrowser("pdf", deck, ports)).toBe("pdf");
    expect(bytesOf(download.mock.calls[0]![0])).toEqual(Array.from(PDF));
  });

  it("A7 with no Chromium it opens the print fallback with the Chromium message", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: false, reason: "noChromium", message: "No Chromium found." });
    const { ports, deck, openTab, notify } = setup(helper);
    expect(await exportDeckFromBrowser("pdf", deck, ports)).toBe("fallback");
    expect(openTab.mock.calls[0]![2]).toBe("print");
    expect(notify).toHaveBeenCalledWith(CHROMIUM_MESSAGE);
  });

  it("A7 the single-file HTML has no external URL", async () => {
    const { ports, deck, download, openTab } = setup(undefined);
    await exportDeckFromBrowser("html", deck, ports);
    await exportDeckFromBrowser("pdf", deck, ports);
    const downloaded = decode(download.mock.calls[0]![0]);
    const opened = openTab.mock.calls[0]![0];
    expect(externalUrls(downloaded)).toEqual([]);
    expect(externalUrls(opened)).toEqual([]);
    expect(downloaded).not.toContain('href="theme.css"');
    expect(downloaded).not.toContain('src="assets/plot.png"');
  });
});

/** A minimal one-page 300 x 400 pt PDF written by hand (pdf-lib is a core dependency only). */
const REAL_PDF = new TextEncoder().encode([
  "%PDF-1.4",
  "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj",
  "2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj",
  "3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources <<>>>> endobj",
  "4 0 obj <</Length 18>> stream",
  "0 0 1 rg 0 0 50 50 re f",
  "endstream endobj",
  "trailer <</Size 5 /Root 1 0 R>>",
  "%%EOF",
].join("\n"));

describe("exportDeckFromBrowser: poster PDF with bleed and crop marks (10c.3)", () => {
  const marks = { bleedMm: 3, cropMarks: true };

  it("10c.3 wraps the Helper's PDF with the marks before the download", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: true, pdf: REAL_PDF });
    const { ports, deck, download } = setup(helper);
    await expect(exportDeckFromBrowser("pdf", { ...deck, marks }, ports)).resolves.toBe("pdf");
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, filename, mime] = download.mock.calls[0]!;
    expect(bytesOf(bytes)).toEqual(Array.from(await addPrintMarks(REAL_PDF, marks)));
    expect(bytesOf(bytes)).not.toEqual(Array.from(REAL_PDF));
    expect(filename).toBe(`${NAME}.pdf`);
    expect(mime).toBe("application/pdf");
  });

  it("10c.3 null marks download the Helper's bytes unchanged", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: true, pdf: REAL_PDF });
    const { ports, deck, download } = setup(helper);
    await exportDeckFromBrowser("pdf", { ...deck, marks: null }, ports);
    expect(bytesOf(download.mock.calls[0]![0])).toEqual(Array.from(REAL_PDF));
  });

  it("10c.3 the print-tab fallback ignores the marks", async () => {
    const { ports, deck, download, openTab, notify } = setup(undefined);
    await expect(exportDeckFromBrowser("pdf", { ...deck, marks }, ports)).resolves.toBe("fallback");
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith(HELPER_MESSAGE);
    expect(download).not.toHaveBeenCalled();
  });
});

describe("exportDeckFromBrowser: talk handout and notes pages (11.3)", () => {
  const notes = { notes: ["First note"] };

  it("11.3 lays the Helper's PDF out as a handout and downloads <name>-handout.pdf", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: true, pdf: REAL_PDF });
    const { ports, deck, download } = setup(helper);
    const talk = { layout: { kind: "handout" as const, perPage: 4 as const }, notes };
    await expect(exportDeckFromBrowser("pdf", { ...deck, talk }, ports)).resolves.toBe("pdf");
    const [bytes, filename] = download.mock.calls[0]!;
    expect(bytesOf(bytes)).toEqual(Array.from(await layoutTalkPdf(REAL_PDF, talk.layout, notes)));
    expect(filename).toBe(`${NAME}-handout.pdf`);
  });

  it("11.3 notes pages download <name>-notes.pdf", async () => {
    const { helper } = fakeHelper(ready(["printPdf"]), { ok: true, pdf: REAL_PDF });
    const { ports, deck, download } = setup(helper);
    await exportDeckFromBrowser("pdf", { ...deck, talk: { layout: { kind: "notes" }, notes } }, ports);
    expect(download.mock.calls[0]![1]).toBe(`${NAME}-notes.pdf`);
  });

  it("11.3 the print-tab fallback says a layout needs the Helper and prints as slides", async () => {
    const { ports, deck, download, openTab, notify } = setup(undefined);
    await expect(exportDeckFromBrowser("pdf", { ...deck, talk: { layout: { kind: "notes" }, notes } }, ports)).resolves.toBe("fallback");
    expect(openTab).toHaveBeenCalledWith(await expectedHtml(), "text/html", "print");
    expect(notify).toHaveBeenCalledWith("Handouts and notes pages need the LabShelf Helper; printed as slides.");
    expect(download).not.toHaveBeenCalled();
  });
});
