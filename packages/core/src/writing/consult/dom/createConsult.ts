// The consult controller a host mounts beside its source editor (plan local-sync D8): the chooser, one floating window per consulted entry with
// its paper or editable view, and the footer listing the windows. Closing a window flushes its view and releases its file.
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import { formatError } from "../../../errors/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { createFloatingWindows, type FloatingWindow, type FloatingWindows } from "../../../ui/dom/widgets/floatingWindow.js";
import type { ConsultEntry, ConsultKind, ConsultRef } from "../consultRequests.js";
import type { ConsultActions } from "./consultActions.js";
import { openConsultChooser } from "./consultChooser.js";
import { askConsult, type ConsultClient } from "./consultClient.js";
import { consultKindIcon, createConsultFooter } from "./consultFooter.js";
import type { EditableFileOpener } from "./editableFile.js";
import { mountEditableView } from "./editableView.js";
import { mountPaperView } from "./paperView.js";
import { createTextWindowParts } from "./textWindow.js";

export interface ConsultOptions {
  client: ConsultClient;
  openFile: EditableFileOpener;
  pdfSource(bytes: ArrayBuffer): PdfDeckSource;
  root?: HTMLElement;
  windows?: FloatingWindows;
  onError?(error: unknown): void;
  /** What the windows can write into the surface (the source editor once mounted), read when used; without it the windows only show and edit. */
  actions?(): ConsultActions | undefined;
}

/** An open consult window over a manuscript, with the view it edits; the reader cites into it. */
export interface ManuscriptWindow {
  ref: Extract<ConsultRef, { kind: "manuscript" }>;
  title: string;
  view: EditorView;
  window: FloatingWindow;
}

/** What a host hands a surface (the reader) so it can build its own consult: the client, the file opener and the PDF source. */
export type ConsultSetup = Pick<ConsultOptions, "client" | "openFile" | "pdfSource">;

export interface Consult {
  readonly windows: FloatingWindows;
  /** Opens the chooser, on `kind` when given, else on the kind last chosen. */
  choose(kind?: ConsultKind): void;
  open(entry: ConsultEntry): Promise<FloatingWindow>;
  /** The open manuscript windows, the one used last first. */
  manuscripts(): ManuscriptWindow[];
  /** The footer with the chips of the open windows; `button: false` leaves out its Consult button (a surface that has one in its toolbar). */
  footer(options?: { button?: boolean }): Extension;
  dispose(): Promise<void>;
}

/** What a window's body holds once mounted; closing the window destroys it. */
interface Body { destroy(): void | Promise<void> }

export function createConsult(options: ConsultOptions): Consult {
  const { client } = options;
  const windows = options.windows ?? createFloatingWindows(options.root ? { root: options.root } : {});
  /** The chooser's last kind, kept while this surface lives. */
  const memory: { kind?: ConsultKind } = {};
  const onError = (error: unknown): void => { options.onError?.(error); };

  const linkOutput = (): void => { options.actions?.()?.linkOutput?.(); };
  const choose = (kind?: ConsultKind): void => {
    if (kind) memory.kind = kind;
    const canLinkOutput = options.actions?.()?.linkOutput !== undefined;
    openConsultChooser({ client, memory, onPick: (entry) => { void open(entry); }, onError, ...(canLinkOutput ? { onLinkOutput: linkOutput } : {}) });
  };

  /** The manuscript windows with their views, stamped with when each was last used. */
  const manuscriptViews = new Map<FloatingWindow, { ref: ManuscriptWindow["ref"]; view: EditorView; used: number }>();
  let useCount = 0;

  const open = async (entry: ConsultEntry): Promise<FloatingWindow> => {
    const { ref } = entry;
    let view: Body | undefined;
    const win = windows.open({
      kind: ref.kind, title: entry.label, icon: consultKindIcon(ref.kind),
      ...(ref.kind === "pickedFile" ? {} : { onOpen: () => { void askConsult(client, { kind: "open", ref }).catch(onError); } }),
      onClose: () => view?.destroy(),
    });
    if (ref.kind === "paper") {
      win.body.classList.add("ls-consult-with-actions");
      view = mountPaperView(win.body, { client, paperId: ref.paperId, pdfSource: options.pdfSource, onError, ...(options.actions ? { actions: options.actions } : {}) });
      return win;
    }
    try {
      const file = await options.openFile(ref);
      if (win.closed) {
        file.release();
        return win;
      }
      const parts = createTextWindowParts(ref, {
        ...(options.actions ? { actions: options.actions } : {}),
        onView: (textView) => {
          if (ref.kind !== "manuscript") return;
          if (textView) manuscriptViews.set(win, { ref, view: textView, used: ++useCount });
          else manuscriptViews.delete(win);
        },
        onError,
      });
      if (ref.kind === "manuscript") {
        win.element.addEventListener("focusin", () => { const found = manuscriptViews.get(win); if (found) found.used = ++useCount; });
      }
      let host = win.body;
      if (parts.bar && file.kind === "text") {
        // The bar stays above the editor, which scrolls under it.
        win.body.classList.add("ls-consult-with-actions");
        host = renderElement("div", { class: "ls-consult-text" });
        win.body.append(parts.bar, host);
        win.element.addEventListener("pointerenter", () => parts.sync());
      }
      const editable = mountEditableView(host, file, { noteKey: file.path, onError, textExtensions: parts.extensions });
      view = { destroy: async () => { parts.destroy(); manuscriptViews.delete(win); await editable.destroy(); } };
    } catch (error) {
      if (!win.closed) {
        win.body.replaceChildren(renderElement("p", { class: "ls-consult-error", role: "alert", text: `Could not open ${entry.label}: ${formatError(error)}` }));
      }
      onError(error);
    }
    return win;
  };

  return {
    windows,
    choose,
    open,
    manuscripts: () => [...manuscriptViews.entries()]
      .filter(([win]) => !win.closed)
      .sort(([, a], [, b]) => b.used - a.used)
      .map(([win, found]) => ({ ref: found.ref, title: win.title, view: found.view, window: win })),
    footer: (footerOptions) => createConsultFooter({ windows, onConsult: () => choose(), button: footerOptions?.button ?? true }),
    dispose: () => windows.closeAll(),
  };
}
