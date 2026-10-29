// Shows a project note: each of its items in the core editor, saved through the project notes store.
import { formatError, parseItemFile } from "@labshelf/core";
import { QMD_VOCABULARY, mountQmdEditor, renderElement, showToast, type QmdEditorHandle } from "@labshelf/core/dom";
import type { TabContext, TabModule } from "./tabKinds";

const MODULE = "tabs.projectNote";

interface NoteSaver {
  /** Records an item's latest text and starts saving it. */
  change(id: string, text: string): void;
  /** Marks an item's text as already on disk. */
  loaded(id: string, text: string): void;
  /** Resolves once every queued save ended; false when one failed. */
  flush(): Promise<boolean>;
}

/** Saves the edited items of one note. INVARIANT: saves run one after another, so a later edit of an item never lands before an earlier one. */
function createNoteSaver(ctx: TabContext, projectId: string, path: string): NoteSaver {
  const { notes } = ctx.project();
  const latest = new Map<string, string>();
  const saved = new Map<string, string>();
  let saving: Promise<boolean> = Promise.resolve(true);
  const flush = (): Promise<boolean> => {
    saving = saving.then(async () => {
      const dirty = [...latest].filter(([id, text]) => saved.get(id) !== text);
      try {
        for (const [id, text] of dirty) { await notes.editItem(projectId, path, id, text); saved.set(id, text); }
        ctx.tab.setDirty(false);
        return true;
      } catch (error) {
        void ctx.logger.error(MODULE, error, { action: "save note", projectId, path });
        showToast(formatError(error), "error");
        return false;
      }
    });
    return saving;
  };
  return {
    change(id, text) { latest.set(id, text); ctx.tab.setDirty(true); void flush(); },
    loaded(id, text) { saved.set(id, text); },
    flush,
  };
}

/** Mounts one editor per item of the note text into `body`; returns the editors. */
function mountNoteItems(body: HTMLElement, text: string | null, saver: NoteSaver): QmdEditorHandle[] {
  const items = parseItemFile(text ?? "").segments.flatMap((segment) => (segment.kind === "item" ? [segment] : []));
  if (items.length === 0) body.append(renderElement("p", { class: "ls-empty-text" }, `This ${QMD_VOCABULARY.item} is empty.`));
  return items.map((item) => {
    const root = body.appendChild(renderElement("div", { class: "ls-project-note-item" }));
    saver.loaded(item.id, item.body);
    return mountQmdEditor(root, { body: item.body, onChange: (next) => saver.change(item.id, next) });
  });
}

export const mountTab: TabModule["mountTab"] = (host, params, ctx) => {
  const projectId = params["projectId"] ?? "";
  const path = params["path"] ?? "";
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill ls-project-note", role: "group", "aria-label": QMD_VOCABULARY.item }));
  const saver = createNoteSaver(ctx, projectId, path);
  const editors: QmdEditorHandle[] = [];
  let disposed = false;
  ctx.tab.onBeforeClose(saver.flush);

  const placeholder = body.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${path}…`));
  void ctx.project().notes.read(projectId, path).then((text) => {
    if (disposed) return;
    placeholder.remove();
    editors.push(...mountNoteItems(body, text, saver));
  }, (error: unknown) => {
    placeholder.textContent = `Could not open ${path}.`;
    void ctx.logger.error(MODULE, error, { action: "open note", projectId, path });
  });

  return {
    dispose() {
      disposed = true;
      void saver.flush().then(() => { for (const editor of editors) editor.destroy(); body.remove(); });
    },
  };
};
