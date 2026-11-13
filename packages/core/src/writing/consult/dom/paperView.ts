// The body of a paper's consult window: its pages read-only, with its highlights and note pins and the browser's own text selection. When the
// surface writes (ConsultActions), a selection, a highlight or a note pin opens a bubble to cite it, and a fixed bar cites the paper or the page in view.
import type { PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import { base64ToBytes } from "../../../encoding/base64.js";
import { formatError } from "../../../errors/index.js";
import type { Annotation } from "../../../model/index.js";
import { parseItemFile, type ItemFile } from "../../../qmd/item/index.js";
import { renderElement, renderTextButton } from "../../../ui/dom/index.js";
import type { PillButton } from "../../../ui/dom/widgets/pillBar.js";
import { findScopeNote, type CitationScope } from "../../citations/citationScopes.js";
import { deriveNotePage } from "../../citations/citeTargets.js";
import { deriveNotePins, mountPaperPages, type PaperSelection } from "../../dom/sourceEditor/paperPages.js";
import { createActionBubble, isQuotable, renderActionBar, type ActionBubble, type ConsultActions } from "./consultActions.js";
import { askConsult, type ConsultClient } from "./consultClient.js";

export interface PaperView { ready: Promise<void>; destroy(): void }

export interface PaperViewOptions {
  client: ConsultClient;
  paperId: string;
  pdfSource(bytes: ArrayBuffer): PdfDeckSource;
  /** The surface's actions, read when used; undefined (or absent) leaves the window read-only with Copy. */
  actions?(): ConsultActions | undefined;
  onError?(error: unknown): void;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function readPaper(client: ConsultClient, paperId: string): Promise<{ bytes: ArrayBuffer; annotations: Annotation[]; notes: ItemFile | undefined }> {
  const [pdf, marks] = await Promise.all([
    askConsult(client, { kind: "paperPdf", paperId }),
    askConsult(client, { kind: "paperMarks", paperId }),
  ]);
  if (pdf.kind !== "pdf") { throw new Error("the host sent no PDF"); }
  if (marks.kind !== "marks") { throw new Error("the host sent no marks"); }
  return { bytes: toArrayBuffer(base64ToBytes(pdf.base64)), annotations: marks.annotations, notes: marks.notesText === null ? undefined : parseItemFile(marks.notesText) };
}

/** Where a bubble goes: over the browser's selection when there is one, else at the last press in the window. */
function bubbleAnchor(lastPress: { x: number; y: number }): { left: number; top: number; bottom: number } {
  const selection = globalThis.getSelection?.();
  const rect = selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
  if (rect && (rect.width > 0 || rect.height > 0)) return { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom };
  return { left: lastPress.x, top: lastPress.y, bottom: lastPress.y };
}

/** What the window cites from: the paper's highlights and notes as read on open, and the page in view. */
interface Shown { annotations: Annotation[]; notes: ItemFile | undefined; pageInView: number | undefined }

class PaperActions {
  private readonly bubble: ActionBubble = createActionBubble("Cite from this paper");
  private readonly bar = renderActionBar();
  private readonly citePaper = renderTextButton("Cite paper", "ls-btn");
  private readonly citePage = renderTextButton("Cite page", "ls-btn");
  private lastPress = { x: 0, y: 0 };
  private readonly onPress = (event: PointerEvent): void => { this.lastPress = { x: event.clientX, y: event.clientY }; };

  constructor(private readonly body: HTMLElement, private readonly options: PaperViewOptions, private readonly shown: Shown) {
    this.citePaper.addEventListener("click", () => this.cite({ kind: "paper" }, false));
    this.citePage.addEventListener("click", () => { if (shown.pageInView !== undefined) this.cite({ kind: "page", page: shown.pageInView }, false); });
    this.bar.append(this.citePaper, this.citePage);
    body.addEventListener("pointerdown", this.onPress, true);
    body.addEventListener("scroll", () => this.bubble.hide(), true);
    this.sync();
  }

  get element(): HTMLElement { return this.bar; }

  /** Shows the bar only while the surface can cite, and names the page in view. */
  sync(): void {
    const actions = this.options.actions?.();
    this.bar.hidden = actions === undefined;
    const page = this.shown.pageInView;
    this.citePage.textContent = page === undefined ? "Cite page" : `Cite page ${page}`;
    this.citePage.disabled = page === undefined;
  }

  onSelection(selection: PaperSelection): void {
    const scope = (selection.highlightId === undefined ? undefined : this.highlightScope(selection.highlightId)) ?? { kind: "passage", page: selection.page, text: selection.text } satisfies CitationScope;
    this.offer(scope, selection.text);
  }

  onHighlight(id: string): void {
    const scope = this.highlightScope(id);
    if (scope) this.offer(scope, this.shown.annotations.find((annotation) => annotation.id === id)?.content);
  }

  onNote(id: string): void {
    const note = findScopeNote(this.shown.notes, id);
    if (!note) return;
    const page = deriveNotePage(note, this.shown.annotations);
    this.offer(page === undefined ? { kind: "note", noteId: id } : { kind: "note", noteId: id, page }, undefined);
  }

  destroy(): void {
    this.bubble.destroy();
    this.body.removeEventListener("pointerdown", this.onPress, true);
  }

  private highlightScope(id: string): CitationScope | undefined {
    const highlight = this.shown.annotations.find((annotation) => annotation.id === id);
    return highlight && { kind: "highlight", annotationId: id, page: highlight.pageNumber };
  }

  /** Opens the bubble for `scope`: Cite and, for a scope with words, Cite with quote; Copy when there is text to copy. */
  private offer(scope: CitationScope, text: string | undefined): void {
    const actions = this.options.actions?.();
    const buttons: PillButton[] = [];
    if (actions) {
      buttons.push(this.citeButton(actions, scope, false));
      if (isQuotable(scope)) buttons.push(this.citeButton(actions, scope, true));
    }
    if (text) buttons.push({ label: "Copy", icon: "copy", run: () => { void navigator.clipboard.writeText(text).catch((error: unknown) => this.options.onError?.(error)); } });
    if (buttons.length === 0) return;
    this.bubble.show([buttons], bubbleAnchor(this.lastPress));
  }

  /** A cite button whose hover card shows the exact text it writes, read once the bubble opens. */
  private citeButton(actions: ConsultActions, scope: CitationScope, quoted: boolean): PillButton {
    const button: PillButton = { label: quoted ? "Cite with quote" : "Cite", icon: quoted ? "text-box" : "quote", run: () => this.cite(scope, quoted) };
    void actions.citationText(this.options.paperId, scope, quoted).then((text) => { button.shortcut = text; }, () => undefined);
    return button;
  }

  private cite(scope: CitationScope, quoted: boolean): void {
    const actions = this.options.actions?.();
    if (!actions) return;
    void actions.cite(this.options.paperId, scope, quoted).catch((error: unknown) => this.options.onError?.(error));
  }
}

/** Mounts the paper's pages in `body`; a failure shows its sentence in the body instead, and `ready` resolves either way. */
export function mountPaperView(body: HTMLElement, options: PaperViewOptions): PaperView {
  let destroyed = false;
  let pages: { destroy(): void } | undefined;
  let actions: PaperActions | undefined;
  const showError = (error: unknown): void => {
    if (destroyed) return;
    pages?.destroy();
    pages = undefined;
    body.replaceChildren(renderElement("p", { class: "ls-consult-error", role: "alert", text: `Could not open the paper: ${formatError(error)}` }));
  };
  const ready = (async (): Promise<void> => {
    const paper = await readPaper(options.client, options.paperId);
    if (destroyed) return;
    const shown: Shown = { annotations: paper.annotations, notes: paper.notes, pageInView: undefined };
    const paperActions = new PaperActions(body, options, shown);
    actions = paperActions;
    body.append(paperActions.element);
    const view = mountPaperPages(body, {
      source: options.pdfSource(paper.bytes), annotations: paper.annotations, notes: deriveNotePins(paper.notes, paper.annotations),
      onSelection: (selection) => paperActions.onSelection(selection),
      onHighlightClick: (id) => paperActions.onHighlight(id),
      onNoteClick: (id) => paperActions.onNote(id),
      onPageInView: (page) => { shown.pageInView = page; paperActions.sync(); },
    });
    pages = view;
    await view.ready;
  })().catch(showError);
  return {
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      actions?.destroy();
      pages?.destroy();
      pages = undefined;
    },
  };
}
