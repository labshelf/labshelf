// A .qmd or .md file of the remote library in the note editor: each change is an edit of the Mirror's row, and code cells run in the browser.
import { createCellRuns, formatError, parseItemFile, serializeItemFile, setItemBody, type CellLanguage, type RunCellPort } from "@labshelf/core";
import { createCellRunGroup, renderElement, showToast } from "@labshelf/core/dom";

import type { MirrorFileSystem } from "./mirrorFileSystem.js";
import { BROWSER_CELL_NOTICE } from "./runtimes/index.js";

/** The page's cell runner: one session per note key and language. */
export interface NoteCells { run: RunCellPort; restart(noteKey: string, language: CellLanguage): void }

/** Request ids are made by each view, so one registry serves every note tab. */
const runs = createCellRuns();
const CELL_FENCE = /^```+\s*\{/m;

/**
 * Mounts one editor per item of an item file (the loose text between items is kept as it is), or one for the whole file without items.
 * INVARIANT: every save rewrites only the edited item's body in the latest text, so the item fences and the other items stay byte for byte.
 */
export async function mountNoteFile(body: HTMLElement, options: { fs: MirrorFileSystem; cells: NoteCells; path: string }): Promise<{ destroy(): void }> {
  const { fs, cells, path } = options;
  let latest = await fs.readText(path);
  const { mountQmdEditor } = await import("@labshelf/core/dom");
  body.textContent = "";
  const items = parseItemFile(latest).segments.flatMap((s) => s.kind === "item" ? [s.id] : []);
  const bodyOf = (id: string | undefined): string | undefined => {
    if (id === undefined) { return latest; }
    const item = parseItemFile(latest).segments.find((s) => s.kind === "item" && s.id === id);
    return item?.kind === "item" ? item.body : undefined;
  };
  let warned = false;
  const save = (id: string | undefined, next: string): void => {
    latest = id === undefined ? next : serializeItemFile(setItemBody(parseItemFile(latest), id, next));
    fs.writeText(path, latest).then(() => { warned = false; }, (err: unknown) => {
      if (!warned) { warned = true; showToast(formatError(err), "error"); }
    });
  };
  const group = createCellRunGroup({ onCancel: (requestId) => { runs.cancel(requestId); } });
  if (CELL_FENCE.test(latest)) { body.append(renderElement("p", { class: "open-cell-notice", text: BROWSER_CELL_NOTICE })); }
  const editors = (items.length ? items : [undefined]).map((id) => {
    const holder = renderElement("div", { class: "open-note-item" });
    body.append(holder);
    const key = id ?? path;
    const onRunCell = group.attach(key, holder, (label, code, requestId, language, params, preview) => {
      void runs.run(cells.run, { requestId, label, code, language, noteKey: path, ...(params ? { params } : {}), ...(preview ? { preview } : {}) }, {
        read: async () => bodyOf(id),
        write: async (next) => { editor.setBody(next); save(id, next); },
        push: () => undefined,
        post: (state, info) => { group.show(requestId, state, info); },
        fail: (error) => { console.warn("[open.cells]", error); },
        preview: (result) => { group.showPreview(requestId, result); },
      });
    }, (language) => { cells.restart(path, language); });
    const onRestartCell = group.restartCell(key);
    const editor = mountQmdEditor(holder, {
      body: bodyOf(id) ?? "", onChange: (next) => { save(id, next); }, onRunCell, ...(onRestartCell ? { onRestartCell } : {}),
    });
    return editor;
  });
  return { destroy: () => { for (const editor of editors) { editor.flush(); editor.destroy(); } group.clear(); } };
}
