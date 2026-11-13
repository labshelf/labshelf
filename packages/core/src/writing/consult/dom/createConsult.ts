// The consult controller a host mounts beside its source editor (plan local-sync D8): the chooser, one floating window per consulted entry with
// its paper or editable view, and the footer listing the windows. Closing a window flushes its view and releases its file.
import type { Extension } from "@codemirror/state";
import type { PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import { formatError } from "../../../errors/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { createFloatingWindows, type FloatingWindow, type FloatingWindows } from "../../../ui/dom/widgets/floatingWindow.js";
import type { ConsultEntry, ConsultKind } from "../consultRequests.js";
import { openConsultChooser } from "./consultChooser.js";
import { askConsult, type ConsultClient } from "./consultClient.js";
import { consultKindIcon, createConsultFooter } from "./consultFooter.js";
import type { EditableFileOpener } from "./editableFile.js";
import { mountEditableView } from "./editableView.js";
import { mountPaperView } from "./paperView.js";

export interface ConsultOptions { client: ConsultClient; openFile: EditableFileOpener; pdfSource(bytes: ArrayBuffer): PdfDeckSource; root?: HTMLElement; windows?: FloatingWindows; onError?(error: unknown): void }

export interface Consult { readonly windows: FloatingWindows; choose(): void; open(entry: ConsultEntry): Promise<FloatingWindow>; footer(): Extension; dispose(): Promise<void> }

/** What a window's body holds once mounted; closing the window destroys it. */
interface Body { destroy(): void | Promise<void> }

export function createConsult(options: ConsultOptions): Consult {
  const { client } = options;
  const windows = options.windows ?? createFloatingWindows(options.root ? { root: options.root } : {});
  /** The chooser's last kind, kept while this surface lives. */
  const memory: { kind?: ConsultKind } = {};
  const onError = (error: unknown): void => { options.onError?.(error); };

  const choose = (): void => {
    openConsultChooser({ client, memory, onPick: (entry) => { void open(entry); }, onError });
  };

  const open = async (entry: ConsultEntry): Promise<FloatingWindow> => {
    const { ref } = entry;
    let view: Body | undefined;
    const win = windows.open({
      kind: ref.kind, title: entry.label, icon: consultKindIcon(ref.kind),
      ...(ref.kind === "pickedFile" ? {} : { onOpen: () => { void askConsult(client, { kind: "open", ref }).catch(onError); } }),
      onClose: () => view?.destroy(),
    });
    if (ref.kind === "paper") {
      view = mountPaperView(win.body, { client, paperId: ref.paperId, pdfSource: options.pdfSource });
      return win;
    }
    try {
      const file = await options.openFile(ref);
      if (win.closed) {
        file.release();
        return win;
      }
      view = mountEditableView(win.body, file, { noteKey: file.path, onError });
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
    footer: () => createConsultFooter({ windows, onConsult: choose }),
    dispose: () => windows.closeAll(),
  };
}
