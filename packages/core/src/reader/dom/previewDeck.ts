// The preview of a LaTeX or Typst talk or poster. A talk gets a slide bar (Present, the slide it shows, notes), a strip of slide
// thumbnails and the current slide's notes. A poster gets a bar with Real size, its print size and a print check of text too small at that
// size. Both fit one page to the view.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { mapPagesToSlides, smallTextThresholdPt } from "../../decks/index.js";
import { renderElement, showMenu, type MenuItem } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/index.js";
import type { PreviewBuildRoot, PreviewDeck, WebviewToHost } from "../index.js";
import { DOCUMENT_REPLACED } from "./pdfLoader.js";
import type { ReaderContext } from "./readerSession.js";

export interface PreviewDeckView {
  /** Switches the preview into the shown root's talk or poster mode, or back to a document. */
  setRoot(root: PreviewBuildRoot | undefined): void;
}

const THUMB_WIDTH = 132;
const MAX_FLAGS = 60;

interface SmallRun { text: string; pt: number; page: number; x: number; y: number }

function barButton(icon: Parameters<typeof renderIcon>[0], label: string, run: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "rd-deck-button", title: label, html: renderIcon(icon) });
  button.append(renderElement("span", { text: label }));
  button.addEventListener("click", run);
  return button;
}

/** The text runs of page 1 below the print threshold of its size, in PDF points from the bottom left. */
async function findSmallRuns(document: PDFDocumentProxy): Promise<{ runs: SmallRun[]; thresholdPt: number; sizeMm: [number, number] }> {
  const page = await document.getPage(1);
  const { width, height } = page.getViewport({ scale: 1 });
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4);
  const thresholdPt = smallTextThresholdPt({ w: mm(width), h: mm(height), unit: "mm" });
  const content = await page.getTextContent();
  const runs = content.items.flatMap((item): SmallRun[] => {
    if (!("str" in item) || !item.str.trim()) return [];
    const [, , c, d, e, f] = item.transform as number[];
    const pt = Math.hypot(c ?? 0, d ?? 0);
    return pt > 0 && pt < thresholdPt ? [{ text: item.str.trim(), pt: Math.round(pt * 10) / 10, page: 1, x: e ?? 0, y: (f ?? 0) + pt }] : [];
  });
  return { runs, thresholdPt, sizeMm: [mm(width), mm(height)] };
}

interface DeckDom { bar: HTMLElement; strip: HTMLElement; notes: HTMLElement }

function buildDom(ctx: ReaderContext): DeckDom {
  const bar = renderElement("div", { class: "rd-deck-bar", role: "toolbar", "aria-label": "Talk and poster tools", hidden: true });
  const strip = renderElement("div", { class: "rd-deck-strip", role: "listbox", "aria-label": "Slides", hidden: true });
  const notes = renderElement("div", { class: "rd-deck-notes", role: "region", "aria-label": "Speaker notes", hidden: true });
  ctx.container.before(bar);
  ctx.container.after(strip, notes);
  return { bar, strip, notes };
}

/** The thumbnails of every page, drawn one after another so the first slides show first; a later document cancels an unfinished run. */
async function drawStrip(ctx: ReaderContext, strip: HTMLElement, document: PDFDocumentProxy, current: () => PDFDocumentProxy, label: (page: number) => string): Promise<void> {
  strip.replaceChildren();
  const items: HTMLElement[] = [];
  for (let n = 1; n <= document.numPages; n++) {
    const canvas = renderElement("canvas", { class: "rd-deck-thumb-canvas" });
    const item = renderElement("button", { type: "button", class: "rd-deck-thumb", role: "option", "data-page": String(n), title: label(n) }, canvas, renderElement("span", { class: "rd-deck-thumb-label", text: label(n) }));
    item.addEventListener("click", () => { ctx.pdfViewer.currentPageNumber = n; });
    items.push(item);
  }
  strip.append(...items);
  for (const [index, item] of items.entries()) {
    if (current() !== document) return;
    const page = await document.getPage(index + 1);
    const scale = THUMB_WIDTH / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale: scale * Math.min(globalThis.devicePixelRatio || 1, 2) });
    const canvas = item.querySelector("canvas")!;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (context) await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise.catch(() => undefined);
  }
}

/** Mounts the talk and poster tools around the preview's pages; they stay hidden while the shown root is a document. */
export function mountPreviewDeck(ctx: ReaderContext, post: (msg: WebviewToHost) => void): PreviewDeckView {
  const dom = buildDom(ctx);
  let root: PreviewBuildRoot | undefined;
  let deck: PreviewDeck | undefined;
  let drawn: PDFDocumentProxy | undefined;
  let slideOfPage: number[] | null = null;
  const label = (page: number): string => {
    const slide = slideOfPage?.[page - 1];
    return slide === undefined ? String(page) : String(slide + 1);
  };
  const position = renderElement("span", { class: "rd-deck-position" });

  const syncTalk = (): void => {
    if (deck?.kind !== "talk") return;
    const page = ctx.pdfViewer.currentPageNumber;
    const slide = slideOfPage?.[page - 1];
    const pages = ctx.pdfDocument.numPages;
    position.textContent = slide === undefined ? `Page ${page} of ${pages}` : `Slide ${slide + 1} of ${(slideOfPage?.at(-1) ?? 0) + 1} · page ${page} of ${pages}`;
    const note = slide === undefined ? "" : deck.notes?.[slide] ?? "";
    dom.notes.textContent = note || "No notes for this slide.";
    dom.notes.classList.toggle("rd-deck-notes-empty", !note);
    for (const item of dom.strip.querySelectorAll<HTMLElement>(".rd-deck-thumb")) {
      const on = item.dataset["page"] === String(page);
      item.setAttribute("aria-selected", String(on));
      if (on) item.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const showTalk = (): void => {
    const document = ctx.pdfDocument;
    const notes = dom.notes;
    const notesButton = barButton("message", "Notes", () => { notes.hidden = !notes.hidden; });
    dom.bar.replaceChildren(barButton("play", "Present", () => { if (root) post({ command: "openDeckView", root: root.path, view: "present" }); }), position, renderElement("span", { class: "rd-deck-spacer" }), notesButton);
    if (drawn !== document) {
      drawn = document;
      void document.getPageLabels().catch(() => null).then((labels) => {
        if (ctx.pdfDocument !== document) return;
        slideOfPage = mapPagesToSlides(labels, document.numPages, deck?.notes?.length ?? 0);
        syncTalk();
        return drawStrip(ctx, dom.strip, document, () => ctx.pdfDocument, label).then(syncTalk);
      });
    }
    syncTalk();
  };

  const showPoster = (): void => {
    const document = ctx.pdfDocument;
    const check = barButton("check-square", "Print check", () => undefined);
    const size = renderElement("span", { class: "rd-deck-position" });
    dom.bar.replaceChildren(barButton("eye", "Real size", () => { if (root) post({ command: "openDeckView", root: root.path, view: "poster" }); }), size, renderElement("span", { class: "rd-deck-spacer" }), check);
    void findSmallRuns(document).then(({ runs, thresholdPt, sizeMm }) => {
      if (ctx.pdfDocument !== document) return;
      size.textContent = `${sizeMm[0]} × ${sizeMm[1]} mm`;
      check.querySelector("span")!.textContent = runs.length ? `Print check: ${runs.length} too small` : "Print check: ready";
      check.dataset["tone"] = runs.length ? "warning" : "ok";
      check.onclick = () => {
        const items: MenuItem[] = runs.length === 0
          ? [{ label: `All text is at least ${thresholdPt} pt at print size`, disabled: true, onSelect: () => undefined }]
          : runs.slice(0, MAX_FLAGS).map((run) => ({
            label: `${run.pt} pt: ${run.text.slice(0, 40)}`,
            onSelect: () => ctx.pdfViewer.scrollPageIntoView({ pageNumber: run.page, destArray: [null, { name: "XYZ" }, run.x, run.y, null] }),
          }));
        showMenu(check, [{ label: `Text below ${thresholdPt} pt at print size`, disabled: true, onSelect: () => undefined }, "separator", ...items]);
      };
    }).catch(() => undefined);
  };

  const render = (): void => {
    const kind = deck?.kind;
    document.documentElement.dataset["deck"] = kind ?? "";
    dom.bar.hidden = kind === undefined;
    dom.strip.hidden = kind !== "talk";
    dom.notes.hidden = kind !== "talk";
    if (kind === undefined) return;
    // A slide or a poster reads best one page at a time, fitted to the view.
    ctx.pdfViewer.currentScaleValue = "page-fit";
    if (kind === "talk") showTalk(); else showPoster();
  };

  ctx.eventBus.on("pagechanging", syncTalk);
  ctx.eventBus.on(DOCUMENT_REPLACED, () => { drawn = undefined; slideOfPage = null; render(); });
  return {
    setRoot(next) {
      const changed = next?.deck?.kind !== deck?.kind || next?.path !== root?.path;
      root = next;
      deck = next?.deck;
      if (changed) drawn = undefined;
      if (changed) render(); else if (deck?.kind === "talk") syncTalk();
    },
  };
}
