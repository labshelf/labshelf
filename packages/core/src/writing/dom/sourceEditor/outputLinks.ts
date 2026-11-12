// Marks the references a manuscript makes to linked outputs, and shows over each one the copy's preview, where it came from and its state,
// with Run, Update, Source settings… or Link to code; "Link output…" opens the dialog of outputLinkDialog.ts.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  createOutputLinks, loadsBooktabs, type ILogger, type OutputLinks, type OutputPreview, type OutputProjectFiles, type OutputSourcePort,
  type ResolvedOutputReference,
} from "../../../index.js";
import { formatRelativeTime } from "../../../time/index.js";
import { askDialog, askInputBox, renderElement, showDialog, showToast } from "../../../ui/dom/index.js";
import { createGuard, createMarksField, createLinkRefresh, insertBlock, linkTheme, type Guard } from "./linkMarks.js";
import { pickOutputLink } from "./outputLinkDialog.js";

const MODULE = "editor.outputLinks";
const PREVIEW_ROWS = 8;

/** What a host gives the editor for linked outputs: the project's files, this device's sources and the project id. */
export interface OutputLinkSupport { files: OutputProjectFiles; sources: OutputSourcePort; projectId: string }

export interface OutputLinkActions {
  /** Link output…: the dialog, then the copy, its record and the reference at the cursor. */
  insert(): Promise<void>;
}

export interface EditorOutputLinks {
  extension: Extension;
  refresh(view: EditorView): Promise<void>;
  close(): void;
  actionsFor(view: EditorView): OutputLinkActions;
}

interface OutputMark { from: number; to: number; resolved: ResolvedOutputReference }

const outputTheme = EditorView.theme({
  ".ls-output-ref": { textDecoration: "underline dotted var(--ls-mark-accent)" },
  ".ls-output-tip": { width: "min(26em, 90vw)" },
  ".ls-output-preview img": { display: "block", maxWidth: "100%", maxHeight: "14em", objectFit: "contain", backgroundColor: "white" },
  ".ls-output-preview table": { borderCollapse: "collapse", fontSize: "var(--ls-text-xs)" },
  ".ls-output-preview td": { padding: "0 var(--ls-space-2)", borderBottom: "1px solid var(--ls-menu-border)" },
  ".ls-output-preview pre": { margin: "0", maxHeight: "10em", overflow: "auto", whiteSpace: "pre-wrap" },
  ".ls-output-meta": { color: "var(--ls-fg-muted)", margin: "0" },
});

/** The preview's element; object URLs it makes are added to `urls` for the tooltip to revoke. */
function renderPreview(preview: OutputPreview | undefined, urls: string[]): HTMLElement {
  const box = renderElement("div", { class: "ls-output-preview" });
  if (!preview) { box.append(renderElement("p", { class: "ls-output-meta", text: "The copy is not in the project yet." })); return box; }
  switch (preview.kind) {
    case "image": {
      const url = URL.createObjectURL(new Blob([preview.bytes as Uint8Array<ArrayBuffer>], { type: preview.mime }));
      urls.push(url);
      box.append(renderElement("img", { src: url, alt: "Preview of the linked output" }));
      break;
    }
    case "pdf": box.append(renderElement("p", { class: "ls-output-meta", text: `PDF, ${Math.ceil(preview.bytes.length / 1024)} KB` })); break;
    case "table": box.append(renderElement("table", {}, ...preview.rows.slice(0, PREVIEW_ROWS + 1).map((row) => renderElement("tr", {}, ...row.map((cell) => renderElement("td", { text: cell })))))); break;
    case "values": box.append(renderElement("table", {}, ...preview.entries.map(([key, value]) => renderElement("tr", {}, renderElement("td", { text: key }), renderElement("td", { text: String(value) }))))); break;
    case "text": box.append(renderElement("pre", { text: preview.text })); break;
  }
  return box;
}

interface Runtime { links: OutputLinks; deps: OutputLinkSupport; guarded: Guard; refresh(view: EditorView): Promise<void>; running: Map<string, AbortController> }

/** Run: the source's command, then a toast with what it updated; while it runs the button cancels it. */
async function runSource(rt: Runtime, view: EditorView, source: string, button: HTMLButtonElement): Promise<void> {
  const running = rt.running.get(source);
  if (running) { running.abort(); return; }
  const controller = new AbortController();
  rt.running.set(source, controller);
  button.textContent = "Cancel";
  button.classList.add("ls-busy");
  try {
    const { updated, result } = await rt.links.run(source, controller.signal);
    if (result.status === "finished") { showToast(`${updated.length} output${updated.length === 1 ? "" : "s"} updated`, "info"); }
    if (result.status === "declined") { showToast(`The command of ${source} did not run.`, "info"); }
  } finally {
    rt.running.delete(source);
    button.textContent = "Run";
    button.classList.remove("ls-busy");
    await rt.refresh(view);
  }
}

/** Link to code: the folder of this computer's clone; a folder of another repository asks before it is kept. */
async function linkToCode(rt: Runtime, view: EditorView, source: string): Promise<void> {
  const { folder, mismatch } = await rt.links.linkSource(source);
  if (folder === undefined) { return; }
  if (mismatch && !await askDialog("Link to another repository?", `${source} was linked from ${mismatch.expected}, but ${folder} is a clone of ${mismatch.actual}.`, "Link anyway")) {
    await rt.deps.sources.unlink(source);
    return;
  }
  await rt.refresh(view);
}

/** Source settings…: this computer's folder and command for a source, changed or unlinked. */
async function sourceSettings(rt: Runtime, view: EditorView, source: string): Promise<void> {
  const here = await rt.deps.sources.status(source);
  if (!here) { return; }
  const shared = (await rt.links.read()).file.sources[source]?.run;
  const command = here.command ?? shared;
  const choice = await showDialog({
    title: `${source} on this computer`, severity: "info", message: `Folder: ${here.folder}\nCommand: ${command ?? "none"}`,
    buttons: [{ id: "unlink", label: "Unlink", danger: true }, { id: "folder", label: "Change folder…" }, { id: "command", label: "Change command…", primary: true }],
  });
  if (choice === "command") {
    const next = await askInputBox({ title: `Command for ${source}`, prompt: `Runs in ${here.folder}. Empty uses the project's command${shared ? ` (${shared})` : ""}.`, value: command ?? "" });
    if (next !== undefined) { await rt.deps.sources.setCommand(source, next.trim() === "" || next.trim() === shared ? undefined : next.trim()); }
  }
  if (choice === "folder") { await linkToCode(rt, view, source); }
  if (choice === "unlink") { await rt.deps.sources.unlink(source); }
  await rt.refresh(view);
}

/** The buttons that fit the link's state on this computer. */
async function renderButtons(rt: Runtime, view: EditorView, resolved: ResolvedOutputReference): Promise<HTMLElement> {
  const { link, status } = resolved;
  const actions = renderElement("div", { class: "ls-origin-tip-actions" });
  const button = (label: string, primary: boolean, run: (button: HTMLButtonElement) => Promise<void>): void => {
    const element = renderElement("button", { type: "button", class: primary ? "ls-btn ls-btn-primary" : "ls-btn", text: label });
    element.addEventListener("click", () => void rt.guarded.run(() => run(element)));
    actions.append(element);
  };
  const here = await rt.deps.sources.status(link.source).catch(() => undefined);
  if (!here) {
    button("Link to code", true, () => linkToCode(rt, view, link.source));
    return actions;
  }
  const hasCommand = Boolean(here.command ?? (await rt.links.read()).file.sources[link.source]?.run);
  button(rt.running.has(link.source) ? "Cancel" : "Run", hasCommand, (element) => runSource(rt, view, link.source, element));
  if (status.state === "stale" || status.copyMissing) { button("Update", !hasCommand, async () => { await rt.links.update(link.id); await rt.refresh(view); }); }
  button("Source settings…", false, () => sourceSettings(rt, view, link.source));
  return actions;
}

function tooltipFor(rt: Runtime, view: EditorView, mark: OutputMark): Tooltip {
  const { link, sentence } = mark.resolved;
  return {
    pos: mark.from, end: mark.to, above: true,
    create: () => {
      const urls: string[] = [];
      const updated = [link.by ? `Updated by ${link.by}` : "Updated", formatRelativeTime(link.updated)].filter(Boolean).join(" · ");
      const dom = renderElement("div", { class: "ls-origin-tip ls-output-tip" },
        renderElement("p", { class: "ls-output-meta", text: `${link.source} › ${link.path}` }),
        renderElement("p", { class: "ls-output-meta", text: link.updated ? updated : "" }),
        renderElement("p", { class: "ls-dialog-msg", text: sentence }));
      void rt.links.preview(link).then((preview) => dom.prepend(renderPreview(preview, urls)), () => undefined);
      void renderButtons(rt, view, mark.resolved).then((actions) => dom.append(actions), () => undefined);
      return { dom, destroy: () => { for (const url of urls) URL.revokeObjectURL(url); } };
    },
  };
}

/** The editor's linked outputs; `language` is the file's, `path` its project-relative path. */
export function createEditorOutputLinks(support: OutputLinkSupport, options: { language: "latex" | "typst"; path: string; logger: ILogger }): EditorOutputLinks {
  let closed = false;
  const links = createOutputLinks({ ...support, logger: options.logger, format: options.language });
  const { replace, field } = createMarksField<OutputMark>();
  const decorations = EditorView.decorations.compute([field], (state) => Decoration.set(
    state.field(field).filter((mark) => mark.to > mark.from && mark.to <= state.doc.length).map((mark) => {
      const look = mark.resolved.status.state === "stale" || mark.resolved.status.state === "missing" ? ` ls-origin-${mark.resolved.status.state}` : "";
      return Decoration.mark({ class: `ls-output-ref${look}` }).range(mark.from, mark.to);
    }), true));
  const rt: Runtime = { links, deps: support, guarded: createGuard(options.logger, MODULE, "update the output"), refresh: async () => undefined, running: new Map() };
  const hover = hoverTooltip((view, pos) => {
    const mark = view.state.field(field).find((candidate) => candidate.to > candidate.from && pos >= candidate.from && pos <= candidate.to);
    return mark ? tooltipFor(rt, view, mark) : null;
  });
  const refresh = createLinkRefresh<OutputMark>(
    async (text) => {
      links.invalidate();
      return (await links.resolve(text, options.path)).map((resolved) => ({ from: resolved.reference.start, to: resolved.reference.end, resolved }));
    },
    { set: (view, marks) => view.dispatch({ effects: replace.of(marks) }) }, () => closed,
    (error) => void options.logger.error(MODULE, error, { action: "refreshOutputLinks" }));
  rt.refresh = refresh;
  return {
    extension: [field, decorations, hover, linkTheme, outputTheme],
    refresh,
    close() { closed = true; for (const controller of rt.running.values()) controller.abort(); },
    actionsFor: (view) => ({
      insert: () => rt.guarded("link the output", async () => {
        const picked = await pickOutputLink(links, support.sources, options.language, options.path);
        if (!picked) return;
        const { insert } = await links.create(picked);
        if (insert.block) { insertBlock(view, insert.text); } else { view.dispatch(view.state.replaceSelection(insert.text)); view.focus(); }
        if (options.language === "latex" && picked.kind === "table" && !loadsBooktabs(view.state.doc.toString())) showToast("Add \\usepackage{booktabs} to the preamble.", "info");
        await refresh(view);
      }),
    }),
  };
}
