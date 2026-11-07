// The Style panel of a LaTeX or Typst deck: its port over the source's labshelf:style block (previews compile a build copy through the
// host's optional port) and the Style button that shows the panel in the properties column in place of the properties.
import { DEFAULT_DECK_STYLE, readSourceDeckStyle, setSourceDeckStyle, stylePreviewSource, type DeckStyle } from "../../index.js";
import { mountStylePanel, shellButton, type DeckStylePort, type DeckStylePreview } from "../shell/index.js";
import { openPdfDeck } from "../pdfDeck.js";
import { apply } from "./workspaceEdits.js";
import { slideIndex, type WorkspaceState } from "./workspaceState.js";

const PREVIEW_WIDTH_PX = 240;
const UNSUPPORTED = "Style needs a beamer, tikzposter or Typst deck";
const NEEDS_BUILD: DeckStylePreview = { kind: "swatches", note: "Preview needs a build" };
const UNAVAILABLE: DeckStylePreview = { kind: "swatches", note: "Preview unavailable" };

/** FNV-1a of a string as 8 hex digits: a stable cache key, not a security measure. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** The PDF page drawn at a thumbnail width as a data URL; undefined when the page is not there or cannot be drawn. */
async function renderPage(ws: WorkspaceState, bytes: ArrayBuffer, page: number): Promise<string | undefined> {
  const { assets, createWorker } = ws.ports.pdf;
  const pdf = await openPdfDeck({ assets, readBytes: async () => bytes, ...(createWorker ? { createWorker } : {}) });
  try {
    if (page < 1 || page > pdf.count) return undefined;
    const canvas = document.createElement("canvas");
    await pdf.render(canvas, page - 1, PREVIEW_WIDTH_PX / pdf.pageSize(page - 1).width);
    return canvas.toDataURL("image/png") || undefined;
  } finally {
    pdf.destroy();
  }
}

/** The current slide in `style`: the host's build of a copy drawn as an image, or the swatches with the reason there is no image. */
async function previewOf(ws: WorkspaceState, style: DeckStyle): Promise<DeckStylePreview> {
  const { stylePreview } = ws.ports;
  const slide = slideIndex(ws);
  const copy = stylePreviewSource(ws.format, ws.ports.editing.text(), style, slide);
  if (copy === null) return UNAVAILABLE;
  if (!stylePreview || (ws.build.state !== "succeeded" && ws.ui.stage.pdf() === undefined)) return NEEDS_BUILD;
  const page = ws.format === "typst" && ws.kind === "talk" ? ws.linking.pageOfSlide(slide) ?? copy.page : copy.page;
  const bytes = await stylePreview({ text: copy.text, page, key: fnv1a(copy.text + JSON.stringify(style)) });
  if (bytes === undefined) return NEEDS_BUILD;
  const src = await renderPage(ws, bytes, page).catch(() => undefined);
  return src === undefined ? UNAVAILABLE : { kind: "image", src };
}

/** The Style panel's port over the deck's source; Apply is one editor change, so one undo step, and then the usual build. */
function workspaceStylePort(ws: WorkspaceState): DeckStylePort {
  const { editing } = ws.ports;
  return {
    read() {
      const found = readSourceDeckStyle(ws.format, editing.text());
      return { style: { ...DEFAULT_DECK_STYLE, ...found?.style }, block: found?.block?.text ?? "" };
    },
    candidateBlock(style) {
      const change = setSourceDeckStyle(ws.format, editing.text(), style);
      return change === null ? null : readSourceDeckStyle(ws.format, change.text)?.block?.text ?? null;
    },
    preview: (style) => previewOf(ws, style),
    apply: (style) => apply(ws, setSourceDeckStyle(ws.format, editing.text(), style)),
  };
}

/** The Style button and the panel it shows in place of the properties; `render` follows the text, `destroy` closes the panel. */
export function createStyleToggle(ws: WorkspaceState): { button: HTMLButtonElement; render(): void; destroy(): void } {
  let panel: ReturnType<typeof mountStylePanel> | undefined;
  const props = (): HTMLElement => ws.ui.props.element;
  const close = (): void => {
    if (!panel) return;
    panel.destroy();
    panel = undefined;
    props().hidden = false;
    button.setAttribute("aria-pressed", "false");
  };
  const button = shellButton("droplet", "Style", "dw-insert", () => {
    if (panel) return close();
    if (button.disabled) return;
    panel = mountStylePanel(workspaceStylePort(ws), { onClose: () => { close(); button.focus(); } });
    props().after(panel.element);
    props().hidden = true;
    button.setAttribute("aria-pressed", "true");
  });
  button.setAttribute("aria-pressed", "false");
  return {
    button,
    render() {
      const supported = readSourceDeckStyle(ws.format, ws.ports.editing.text()) !== null;
      button.disabled = !supported;
      button.title = supported ? "Style" : UNSUPPORTED;
      if (!supported) close();
      panel?.refresh();
    },
    destroy: close,
  };
}
