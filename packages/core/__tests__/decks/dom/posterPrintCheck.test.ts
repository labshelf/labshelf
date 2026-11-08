/** @jest-environment jsdom */
/**
 * Spec 10c.2: the print check in the poster preview. showPrintCheck draws the Print check section in the aside and the markers on the
 * canvas; framePrintInput measures an HTML poster's frame in mm; openContentPosterPreview runs the check after poster.ready and pans to an
 * entry; pdfPosterContent (and PdfDeck.images) measure a PDF poster.
 * The shared fakes (pdf.js, srcdoc shim, host, frames, PDF decks) are in posterPrintCheckHarness.ts. jsdom has no layout: the host reports
 * 1000 x 800 px (so the viewport, less the 24 px rulers, is 976 x 776), rects come from stubs, and naturalWidth/naturalHeight are defined
 * by hand. Issues are computed from the 10c.1 rules (150 DPI, 10 mm margin, 0.7 fill).
 */
import { openPosterPreview, type CanvasRect } from "../../../src/decks/dom/openPosterPreview";
import { framePrintInput, showPrintCheck } from "../../../src/decks/dom/posterPrintCheck";
import { openPdfDeck, pdfPosterContent } from "../../../src/decks/dom/pdfDeck";
import { checkPosterPrint, describePrintIssue, type PrintCheckInput, type PrintIssue } from "../../../src/decks/deckPrintCheck";
import type { PdfImagePlacement } from "../../../src/decks/deckPrintCheckPdf";
import {
  A0, OP, PLACEMENTS, PT, PX_PER_MM, VIEW, checkSection, entries, expectBox, fakeContent, fakeFrame, fakePdf, fakeStore, installPosterPreviewHooks, kindsOf, makeHost,
  mm, mockOps, mountPdf, openContent, opened, rectOf, settle, sizeImage, transformOf,
} from "./posterPrintCheckHarness";

installPosterPreviewHooks();

// --- showPrintCheck ------------------------------------------------------------------------------------------------------------------

const LOW_DPI: PrintIssue = { kind: "lowDpi", block: "pic", index: 0, dpi: 120, box: { left: 10, top: 20, width: 30, height: 40 } };
const MARGIN: PrintIssue = { kind: "margin", edge: "left", count: 2, distance: 5.5, block: "title", index: 1, box: { left: 5.5, top: 50, width: 60, height: 10 } };
const UNDERFILL: PrintIssue = { kind: "underfill", dimension: "height", filled: 0.33, empty: "bottom", box: { left: 2, top: 3, width: 100, height: 200 } };

function asideAndCanvas(): { aside: HTMLElement; canvasBox: HTMLElement } {
  const aside = document.createElement("aside");
  const canvasBox = document.createElement("div");
  document.body.append(aside, canvasBox);
  return { aside, canvasBox };
}

describe("showPrintCheck", () => {
  it("10c.2a lists each issue as an entry button with its kind and the describePrintIssue text, under a 'Print check' heading", () => {
    const { aside, canvasBox } = asideAndCanvas();
    showPrintCheck(aside, canvasBox, [LOW_DPI, MARGIN, UNDERFILL], 4, () => undefined);
    const sections = aside.querySelectorAll("[data-print-check]");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.querySelector(".ls-poster-print-heading")!.tagName).toBe("H2");
    expect(sections[0]!.querySelector(".ls-poster-print-heading")!.textContent).toBe("Print check");
    const list = sections[0]!.querySelector("ul.ls-poster-print-list")!;
    expect(list.children).toHaveLength(3);
    expect(Array.from(list.children).every((li) => li.tagName === "LI")).toBe(true);
    expect(kindsOf(aside)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(entries(aside).map((e) => e.textContent)).toEqual([LOW_DPI, MARGIN, UNDERFILL].map(describePrintIssue));
    expect(entries(aside)[0]!.textContent).toBe("Image at 120 DPI at print size (needs 150)");
  });

  it("10c.2a with no issues the heading reads 'Print check: no issues' and the list is empty", () => {
    const { aside, canvasBox } = asideAndCanvas();
    showPrintCheck(aside, canvasBox, [], 4, () => undefined);
    expect(aside.querySelector(".ls-poster-print-heading")!.textContent).toBe("Print check: no issues");
    expect(aside.querySelector("ul.ls-poster-print-list")!.children).toHaveLength(0);
    expect(canvasBox.querySelectorAll(".ls-poster-print-marker")).toHaveLength(0);
  });

  it("10c.2a a second call replaces the section instead of adding another", () => {
    const { aside, canvasBox } = asideAndCanvas();
    showPrintCheck(aside, canvasBox, [LOW_DPI, MARGIN, UNDERFILL], 4, () => undefined);
    showPrintCheck(aside, canvasBox, [MARGIN], 4, () => undefined);
    expect(aside.querySelectorAll("[data-print-check]")).toHaveLength(1);
    expect(kindsOf(aside)).toEqual(["margin"]);
    expect(aside.querySelector(".ls-poster-print-heading")!.textContent).toBe("Print check");
    showPrintCheck(aside, canvasBox, [], 4, () => undefined);
    expect(aside.querySelectorAll("[data-print-check]")).toHaveLength(1);
    expect(entries(aside)).toHaveLength(0);
    expect(aside.querySelector(".ls-poster-print-heading")!.textContent).toBe("Print check: no issues");
  });

  it("10c.2a draws one marker per lowDpi and margin issue and none for underfill, with kind, title and canvas-px position", () => {
    const { aside, canvasBox } = asideAndCanvas();
    showPrintCheck(aside, canvasBox, [LOW_DPI, MARGIN, UNDERFILL], 4, () => undefined);
    const markers = Array.from(canvasBox.querySelectorAll<HTMLElement>(".ls-poster-print-marker"));
    expect(markers.map((m) => m.getAttribute("data-print-kind"))).toEqual(["lowDpi", "margin"]);
    expect(markers.map((m) => m.title)).toEqual([describePrintIssue(LOW_DPI), describePrintIssue(MARGIN)]);
    const px = (value: string): number => Number.parseFloat(value);
    expect([markers[0]!.style.left, markers[0]!.style.top, markers[0]!.style.width, markers[0]!.style.height].map(px)).toEqual([40, 80, 120, 160]);
    expect([markers[1]!.style.left, markers[1]!.style.top, markers[1]!.style.width, markers[1]!.style.height].map(px)).toEqual([22, 200, 240, 40]);
    expect(markers[0]!.style.left.endsWith("px")).toBe(true);
  });

  it("10c.2a a second call replaces the previous print markers", () => {
    const { aside, canvasBox } = asideAndCanvas();
    showPrintCheck(aside, canvasBox, [LOW_DPI, MARGIN], 4, () => undefined);
    showPrintCheck(aside, canvasBox, [UNDERFILL, LOW_DPI], 4, () => undefined);
    expect(Array.from(canvasBox.querySelectorAll(".ls-poster-print-marker")).map((m) => m.getAttribute("data-print-kind"))).toEqual(["lowDpi"]);
    showPrintCheck(aside, canvasBox, [], 4, () => undefined);
    expect(canvasBox.querySelectorAll(".ls-poster-print-marker")).toHaveLength(0);
  });

  it("10c.2a leaves the small-text markers and the rest of the aside alone", () => {
    const { aside, canvasBox } = asideAndCanvas();
    const small = document.createElement("div");
    small.className = "ls-poster-marker";
    canvasBox.append(small);
    const heading = document.createElement("h2");
    heading.className = "ls-poster-small-heading";
    heading.textContent = "Text below 24 pt";
    aside.append(heading);
    showPrintCheck(aside, canvasBox, [LOW_DPI], 4, () => undefined);
    showPrintCheck(aside, canvasBox, [MARGIN], 4, () => undefined);
    expect(canvasBox.querySelectorAll(".ls-poster-marker")).toHaveLength(1);
    expect(canvasBox.querySelector(".ls-poster-marker")).toBe(small);
    expect(aside.querySelector(".ls-poster-small-heading")).toBe(heading);
    expect(heading.textContent).toBe("Text below 24 pt");
  });

  it("10c.2c clicking an entry calls onFocus with the issue box in canvas px (mm times px per mm)", () => {
    const { aside, canvasBox } = asideAndCanvas();
    const onFocus = jest.fn<void, [CanvasRect]>();
    showPrintCheck(aside, canvasBox, [LOW_DPI, MARGIN, UNDERFILL], 4, onFocus);
    entries(aside)[0]!.click();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenLastCalledWith({ left: 40, top: 80, width: 120, height: 160 });
    entries(aside)[2]!.click();
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onFocus).toHaveBeenLastCalledWith({ left: 8, top: 12, width: 400, height: 800 });
  });
});

// --- framePrintInput -----------------------------------------------------------------------------------------------------------------

describe("framePrintInput", () => {
  it("10c.2a texts are the frame's leaves in leaf order, boxes in mm (px x 25.4 / 96), with block and leaf index", () => {
    const { deckFrame, doc } = fakeFrame('<div data-block="title"><h1 id="a">A</h1><p id="b">B</p></div><div data-block="body"><p id="c">C</p></div>', [
      { selector: "#c", block: "body", index: 0 },
      { selector: "#a", block: "title", index: 0 },
      { selector: "#b", block: "title", index: 1 },
    ]);
    doc.querySelector<HTMLElement>("#a")!.getBoundingClientRect = rectOf(96, 192, 192, 96);
    doc.querySelector<HTMLElement>("#b")!.getBoundingClientRect = rectOf(0, 960, 480, 48);
    doc.querySelector<HTMLElement>("#c")!.getBoundingClientRect = rectOf(48, 48, 96, 24);
    const input = framePrintInput(deckFrame, A0);
    expect(input.texts.map((t) => [t.block, t.index])).toEqual([["body", 0], ["title", 0], ["title", 1]]);
    expectBox(input.texts[0]!.box, [mm(48), mm(48), mm(96), mm(24)]);
    expectBox(input.texts[1]!.box, [25.4, 50.8, 50.8, 25.4]);
    expectBox(input.texts[2]!.box, [0, mm(960), mm(480), mm(48)]);
    expect(input.images).toEqual([]);
  });

  it("10c.2a skips leaves whose rect is empty", () => {
    const { deckFrame, doc } = fakeFrame('<div data-block="title"><p id="a">A</p><p id="b">B</p><p id="c">C</p><p id="d">D</p></div>', [
      { selector: "#a", block: "title", index: 0 },
      { selector: "#b", block: "title", index: 1 },
      { selector: "#c", block: "title", index: 2 },
      { selector: "#d", block: "title", index: 3 },
    ]);
    doc.querySelector<HTMLElement>("#a")!.getBoundingClientRect = rectOf(10, 10, 0, 20);
    doc.querySelector<HTMLElement>("#b")!.getBoundingClientRect = rectOf(10, 10, 20, 0);
    doc.querySelector<HTMLElement>("#c")!.getBoundingClientRect = rectOf(10, 10, 20, 20);
    doc.querySelector<HTMLElement>("#d")!.getBoundingClientRect = rectOf(0, 0, 0, 0);
    expect(framePrintInput(deckFrame, A0).texts.map((t) => t.index)).toEqual([2]);
  });

  it("10c.2a the page is the page given", () => {
    const { deckFrame } = fakeFrame("");
    expect(framePrintInput(deckFrame, { width: 594, height: 841 }).page).toEqual({ width: 594, height: 841 });
  });

  it("10c.2a images are the frame's img elements in document order with pixel size = natural size and box in mm", () => {
    const { deckFrame, doc } = fakeFrame('<div data-block="title"><img id="a" src="https://example.test/a.png"></div><div data-block="body"><img id="b" src="https://example.test/b.jpg"></div>');
    sizeImage(doc.querySelector<HTMLImageElement>("#a")!, [600, 400], [96, 192, 192, 96]);
    sizeImage(doc.querySelector<HTMLImageElement>("#b")!, [1200, 900], [480, 96, 960, 480]);
    const { images } = framePrintInput(deckFrame, A0);
    expect(images).toHaveLength(2);
    expectBox(images[0]!.box, [25.4, 50.8, 50.8, 25.4]);
    expect([images[0]!.pixelWidth, images[0]!.pixelHeight]).toEqual([600, 400]);
    expectBox(images[1]!.box, [mm(480), mm(96), mm(960), mm(480)]);
    expect([images[1]!.pixelWidth, images[1]!.pixelHeight]).toEqual([1200, 900]);
  });

  it("10c.2a leaves out images that are not loaded (natural size 0) and svg images, ignoring case and query, and keeps raster data URIs", () => {
    const { deckFrame, doc } = fakeFrame(
      [
        '<img id="notLoaded" src="https://example.test/n.png">',
        '<img id="svg" src="https://example.test/logo.svg">',
        '<img id="svgUpper" src="https://example.test/logo.SVG?v=2">',
        '<img id="svgData" src="data:image/svg+xml;base64,PHN2Zy8+">',
        '<img id="pngData" src="data:image/png;base64,iVBORw0KGgo=">',
        '<img id="svgNamed" src="https://example.test/svg-photo.png">',
        '<img id="ok" src="https://example.test/ok.png?x=1">',
      ].join(""),
    );
    const sized = (id: string, natural: [number, number]): void => sizeImage(doc.querySelector<HTMLImageElement>(`#${id}`)!, natural, [10, 10, 100, 100]);
    sized("notLoaded", [0, 0]);
    sized("svg", [100, 100]);
    sized("svgUpper", [100, 100]);
    sized("svgData", [100, 100]);
    sized("pngData", [111, 222]);
    sized("svgNamed", [333, 444]);
    sized("ok", [555, 666]);
    const { images } = framePrintInput(deckFrame, A0);
    expect(images.map((i) => [i.pixelWidth, i.pixelHeight])).toEqual([[111, 222], [333, 444], [555, 666]]);
  });

  it("10c.2a an image is attributed to the frame block that contains it, '' outside any block, with its index among the kept images", () => {
    const { deckFrame, doc } = fakeFrame(
      '<div data-block="title"><img id="skip" src="https://example.test/s.svg"><img id="a" src="https://example.test/a.png"></div><div data-block="body"><div><img id="b" src="https://example.test/b.png"></div></div><div id="loose"><img id="c" src="https://example.test/c.png"></div>',
    );
    sizeImage(doc.querySelector<HTMLImageElement>("#skip")!, [50, 50], [0, 0, 10, 10]);
    sizeImage(doc.querySelector<HTMLImageElement>("#a")!, [100, 100], [0, 0, 10, 10]);
    sizeImage(doc.querySelector<HTMLImageElement>("#b")!, [200, 200], [0, 0, 10, 10]);
    sizeImage(doc.querySelector<HTMLImageElement>("#c")!, [300, 300], [0, 0, 10, 10]);
    const { images } = framePrintInput(deckFrame, A0);
    expect(images.map((i) => [i.pixelWidth, i.block, i.index])).toEqual([[100, "title", 0], [200, "body", 1], [300, "", 2]]);
  });
});

// --- openContentPosterPreview ---------------------------------------------------------------------------------------------------------

// The measured poster of 10c.2a: A0 with an image of 200 px over 100 mm (51 DPI), a text 5 mm from the left edge, and all content in the
// top 150 mm of 1189 (a tenth of the height).
const A0_INPUT: PrintCheckInput = {
  page: { width: 841, height: 1189 },
  texts: [{ box: { left: 5, top: 60, width: 200, height: 30 }, block: "title", index: 0 }],
  images: [{ box: { left: 300, top: 50, width: 100, height: 100 }, block: "pic", index: 0, pixelWidth: 200, pixelHeight: 200 }],
};

describe("poster preview print check", () => {
  it("10c.2a lists the low-resolution image, the edge text and the underfill in the Print check section, under the small-text list", async () => {
    const { host } = await openContent(fakeContent(A0_INPUT));
    const section = checkSection(host)!;
    expect(section).not.toBeNull();
    expect(section.closest("aside")).not.toBeNull();
    expect(section.querySelector(".ls-poster-print-heading")!.textContent).toBe("Print check");
    expect(kindsOf(section)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(entries(section).map((e) => e.textContent)).toEqual([
      "Image at 51 DPI at print size (needs 150)",
      "1 item within 10 mm of the left edge, closest 5 mm",
      "Content fills 8% of the page height; the bottom is empty",
    ]);
    const smallList = host.querySelector(".ls-poster-small-list")!;
    expect(smallList.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("10c.2a marks the image and the margin item on the canvas, in canvas px, and not the underfill", async () => {
    const { host } = await openContent(fakeContent(A0_INPUT));
    const canvasBox = host.querySelector<HTMLElement>(".ls-poster-canvas")!;
    const markers = Array.from(canvasBox.querySelectorAll<HTMLElement>(".ls-poster-print-marker"));
    expect(markers.map((m) => m.getAttribute("data-print-kind"))).toEqual(["lowDpi", "margin"]);
    const [image, text] = markers.map((m) => [m.style.left, m.style.top, m.style.width, m.style.height].map(Number.parseFloat)) as [number[], number[]];
    [300, 50, 100, 100].forEach((value, i) => expect(image![i]).toBeCloseTo(value * PX_PER_MM, 1));
    [5, 60, 200, 30].forEach((value, i) => expect(text![i]).toBeCloseTo(value * PX_PER_MM, 1));
    expect(markers[0]!.title).toBe("Image at 51 DPI at print size (needs 150)");
  });

  it("10c.2a printIssues returns the issues of the check, in the order lowDpi, margin, underfill", async () => {
    const { preview } = await openContent(fakeContent(A0_INPUT));
    const issues = preview.printIssues();
    expect(issues).toEqual(checkPosterPrint(A0_INPUT));
    expect(issues.map((i) => i.kind)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(issues[0]).toMatchObject({ kind: "lowDpi", dpi: 51, block: "pic", index: 0 });
    expect(issues[1]).toMatchObject({ kind: "margin", edge: "left", count: 1, distance: 5 });
    expect(issues[2]).toMatchObject({ kind: "underfill", dimension: "height", empty: "bottom" });
  });

  it("10c.2a printIssues returns copies: changing the result does not change the next call", async () => {
    const { preview } = await openContent(fakeContent(A0_INPUT));
    const first = preview.printIssues();
    first.pop();
    first.length = 0;
    const second = preview.printIssues();
    expect(second).toHaveLength(3);
    expect(second).not.toBe(first);
  });

  it("10c.2a a well-filled page shows 'Print check: no issues' with no markers", async () => {
    const full: PrintCheckInput = { page: { width: 841, height: 1189 }, texts: [{ box: { left: 20, top: 20, width: 800, height: 1150 }, block: "body", index: 0 }], images: [] };
    const { host, preview } = await openContent(fakeContent(full));
    expect(preview.printIssues()).toEqual([]);
    expect(checkSection(host)!.querySelector(".ls-poster-print-heading")!.textContent).toBe("Print check: no issues");
    expect(entries(host)).toHaveLength(0);
    expect(host.querySelectorAll(".ls-poster-print-marker")).toHaveLength(0);
  });

  it("10c.2a the small-text list and its markers stay as they were next to the print check", async () => {
    const flag = { block: "title", leaf: 1, pt: 12, text: "Affiliation", rect: { left: 100, top: 100, width: 200, height: 20 } };
    const { host, preview } = await openContent(fakeContent(A0_INPUT, [flag]));
    expect(preview.smallText()).toEqual([{ block: "title", leaf: 1, pt: 12, text: "Affiliation" }]);
    expect(host.querySelector("[data-small-text]")!.textContent).toContain("12 pt: Affiliation");
    expect(host.querySelector("[data-small-text]")!.textContent).toContain("Text below 24 pt");
    expect(host.querySelectorAll(".ls-poster-marker")).toHaveLength(1);
    expect(host.querySelectorAll(".ls-poster-print-marker")).toHaveLength(2);
  });

  it("10c.2c clicking an entry pans so the centre of its box sits at the centre of the viewport, with the zoom unchanged", async () => {
    const { host, preview } = await openContent(fakeContent(A0_INPUT));
    preview.setZoom(1);
    await settle();
    const zoom = preview.zoom();
    const before = transformOf(host);
    entries(host)[0]!.click();
    await settle();
    const after = transformOf(host);
    expect(preview.zoom()).toBe(zoom);
    expect(after.scale).toBeCloseTo(before.scale, 9);
    expect(after.x).not.toBeCloseTo(before.x, 1);
    // The image box is 300..400 mm by 50..150 mm: its centre is (350, 100) mm.
    expect(after.x + 350 * PX_PER_MM * after.scale).toBeCloseTo(VIEW.width / 2, 0);
    expect(after.y + 100 * PX_PER_MM * after.scale).toBeCloseTo(VIEW.height / 2, 0);
  });

  it("10c.2c clicking the underfill entry centres the content box", async () => {
    const { host, preview } = await openContent(fakeContent(A0_INPUT));
    preview.setZoom(1);
    await settle();
    entries(host).find((e) => e.getAttribute("data-print-kind") === "underfill")!.click();
    await settle();
    const { x, y, scale } = transformOf(host);
    // The union of all content: 5..400 mm across and 50..150 mm down, centre (202.5, 100).
    expect(x + 202.5 * PX_PER_MM * scale).toBeCloseTo(VIEW.width / 2, 0);
    expect(y + 100 * PX_PER_MM * scale).toBeCloseTo(VIEW.height / 2, 0);
  });

  it("10c.2c a content without printInput shows no Print check section, no print markers and no issues", async () => {
    const { host, preview } = await openContent(fakeContent(undefined));
    expect(checkSection(host)).toBeNull();
    expect(host.querySelector(".ls-poster-print-heading")).toBeNull();
    expect(host.querySelectorAll(".ls-poster-print-marker")).toHaveLength(0);
    expect(preview.printIssues()).toEqual([]);
    expect(host.querySelector("[data-small-text]")).not.toBeNull();
  });
});

// --- pdfPosterContent and PdfDeck.images ------------------------------------------------------------------------------------------------

describe("pdfPosterContent print input", () => {
  it("10c.2b printInput gives the page in mm, the text runs with pt > 0 as mm boxes and the image placements in mm", async () => {
    const { input } = await mountPdf(fakePdf(async () => PLACEMENTS));
    expect(input.page.width).toBeCloseTo(254, 1);
    expect(input.page.height).toBeCloseTo(355.6, 1);
    expect(input.texts).toHaveLength(1);
    expectBox(input.texts[0]!.box, [20 * PT, 72 * PT, 144 * PT, 24 * PT]);
    expect([input.texts[0]!.block, input.texts[0]!.index]).toEqual(["", 0]);
    expect(input.images).toHaveLength(1);
    expectBox(input.images[0]!.box, [300 * PT, 100 * PT, 72 * PT, 72 * PT]);
    expect([input.images[0]!.block, input.images[0]!.index, input.images[0]!.pixelWidth, input.images[0]!.pixelHeight]).toEqual(["", 0, 100, 100]);
  });

  it("10c.2b the input reports the same kinds of issue as an HTML poster: low DPI, margin and underfill", async () => {
    const { input } = await mountPdf(fakePdf(async () => PLACEMENTS));
    const issues = checkPosterPrint(input);
    expect(issues.map((i) => i.kind)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(issues[0]).toMatchObject({ kind: "lowDpi", dpi: 100 });
    expect(issues[1]).toMatchObject({ kind: "margin", edge: "left", count: 1, distance: 7.1 });
    expect(issues[2]).toMatchObject({ kind: "underfill", dimension: "height", empty: "bottom" });
  });

  it("10c.2b mount asks the pdf deck for the images of page 0 and ready waits for them", async () => {
    let release: (placements: PdfImagePlacement[]) => void = () => undefined;
    const images = jest.fn((_page: number) => new Promise<PdfImagePlacement[]>((resolve) => { release = resolve; }));
    const poster = pdfPosterContent(fakePdf(images)).mount(document.createElement("div"));
    let ready = false;
    void poster.ready.then(() => { ready = true; });
    await settle();
    expect(images).toHaveBeenCalledWith(0);
    expect(ready).toBe(false);
    release(PLACEMENTS);
    await settle();
    expect(ready).toBe(true);
    expect(poster.printInput!().images).toHaveLength(1);
  });

  it("10c.2b a pdf deck whose images() rejects gives an input with no images, and ready still resolves", async () => {
    const { input } = await mountPdf(fakePdf(async () => { throw new Error("operator list failed"); }));
    expect(input.images).toEqual([]);
    expect(input.texts).toHaveLength(1);
  });

  it("10c.2b a pdf deck without images() gives an input with no images", async () => {
    const { input } = await mountPdf(fakePdf());
    expect(input.images).toEqual([]);
    expect(input.texts).toHaveLength(1);
  });

  it("10c.2b the small-text flags of the pdf poster are unchanged", async () => {
    const { poster } = await mountPdf(fakePdf(async () => PLACEMENTS));
    expect(poster.smallText(30).map((f) => [f.leaf, f.pt, f.text])).toEqual([[0, 24, "Title"]]);
  });

  it("10c.2b the preview of a pdf poster lists the print check and marks the image and the margin item", async () => {
    const { host, preview } = await openContent(pdfPosterContent(fakePdf(async () => PLACEMENTS)));
    expect(kindsOf(checkSection(host)!)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(host.querySelectorAll(".ls-poster-print-marker")).toHaveLength(2);
    expect(preview.printIssues().map((i) => i.kind)).toEqual(["lowDpi", "margin", "underfill"]);
  });

  it("10c.2b a pdf poster without images in its deck still shows the Print check section", async () => {
    const { host } = await openContent(pdfPosterContent(fakePdf()));
    expect(checkSection(host)).not.toBeNull();
    expect(kindsOf(checkSection(host)!)).not.toContain("lowDpi");
  });
});

describe("openPdfDeck images", () => {
  const assets = { pdfjsUrl: "fake-pdfjs-ops", workerUrl: "fake-worker" };
  const source = { assets, readBytes: async () => new ArrayBuffer(1), createWorker: () => ({}) as Worker };

  it("10c.2b images(page) reads the operator list into placements in points from the page top left, using the page height at scale 1", async () => {
    // The page is 100 x 200 pt. One image drawn under [72 0 0 72 36 100] spans x 36..108 and y 100..172 from the bottom: top = 200 - 172.
    mockOps.list = {
      fnArray: [OP.save, OP.transform, OP.paintImageXObject, OP.restore],
      argsArray: [[], [72, 0, 0, 72, 36, 100], ["img_0", 640, 480], []],
    };
    const deck = await openPdfDeck(source);
    expect(typeof deck.images).toBe("function");
    expect(await deck.images!(0)).toEqual([{ left: 36, top: 28, width: 72, height: 72, pixelWidth: 640, pixelHeight: 480 }]);
    expect(mockOps.calls).toBe(1);
    deck.destroy();
  });

  it("10c.2b images(page) gives [] when getOperatorList fails", async () => {
    mockOps.fail = true;
    const deck = await openPdfDeck(source);
    await expect(deck.images!(0)).resolves.toEqual([]);
    deck.destroy();
  });

  it("10c.2b images(page) gives [] for a page with no images", async () => {
    mockOps.list = { fnArray: [OP.save, OP.restore], argsArray: [[], []] };
    const deck = await openPdfDeck(source);
    await expect(deck.images!(0)).resolves.toEqual([]);
    deck.destroy();
  });
});

// --- A10: every format ---------------------------------------------------------------------------------------------------------------

const THEME = ":root { --deck-bg: #ffffff; }\n";
const HTML_POSTER = [
  "<!doctype html>",
  '<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="841x1189mm">',
  '<head>\n<meta charset="utf-8">\n<title>Poster</title>\n<link rel="stylesheet" href="theme.css" data-deck-theme>\n</head>',
  "<body>",
  '<section data-slide>',
  // Rects in px: the 400 px image shows at 105.8 mm (96 DPI); the title starts 20 px (5.3 mm) from the left edge; everything sits in the top 600 px.
  '<div data-block="title" style="left: 20px; top: 200px; width: 1500px; height: 100px;"><h1 data-test-rect="20,200,1500,100">Poster title</h1></div>',
  '<div data-block="pic" style="left: 800px; top: 200px; width: 400px; height: 400px;"><img src="photo.png" alt="Photo" data-test-rect="800,200,400,400" data-natural="400x400"></div>',
  "</section>",
  "</body>",
  "</html>",
  "",
].join("\n");

describe("poster print check in every format", () => {
  it("A10 an HTML poster and a PDF poster both show the Print check list with low DPI, margin and underfill issues", async () => {
    const htmlHost = makeHost();
    const pending = openPosterPreview(htmlHost, { html: HTML_POSTER, theme: THEME, store: fakeStore(), resolveAsset: async (p: string) => `blob:asset/${p}` });
    await settle();
    const htmlPreview = await pending;
    opened.push(htmlPreview);
    await settle();
    expect(kindsOf(checkSection(htmlHost)!)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(htmlPreview.printIssues().map((i) => i.kind)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(htmlHost.querySelectorAll(".ls-poster-print-marker")).toHaveLength(2);
    expect(htmlPreview.printIssues()[0]).toMatchObject({ kind: "lowDpi", dpi: 96, block: "pic" });

    const pdf = await openContent(pdfPosterContent(fakePdf(async () => PLACEMENTS)));
    expect(kindsOf(checkSection(pdf.host)!)).toEqual(["lowDpi", "margin", "underfill"]);
    expect(pdf.preview.printIssues().map((i) => i.kind)).toEqual(["lowDpi", "margin", "underfill"]);
  });
});
