// Gives a file row its hover buttons and its context menu: open, reveal, copy the path and describe.
import { renderElement, askInputBox, showMenu, type MenuEntry } from "../../../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../../../ui/index.js";
import type { UiContext } from "../../uiContext.js";
import type { TrayEntry } from "./fileFacts.js";

type FileMessage = "paper.openFile" | "paper.revealFile" | "paper.copyFilePath";

interface FileAction { label: string; glyph: IconName; message: FileMessage; filesOnly: boolean }

const OPEN_TO_SIDE: FileAction = { label: "Open to the side", glyph: "open-to-side", message: "paper.openFile", filesOnly: true };
const REVEAL: FileAction = { label: "Reveal in folder", glyph: "folder-open", message: "paper.revealFile", filesOnly: false };
const COPY_PATH: FileAction = { label: "Copy path", glyph: "copy", message: "paper.copyFilePath", filesOnly: false };
const ACTIONS = [OPEN_TO_SIDE, REVEAL, COPY_PATH];

const offered = (e: TrayEntry): FileAction[] => ACTIONS.filter((a) => !a.filesOnly || e.kind !== "folder");

// A file listing is the only place a description lives; a missing or loading listing means none yet.
function currentDescription(ctx: UiContext, id: string, name: string): string {
  const state = ctx.store.get().files[id];
  return state?.status === "ready" ? state.files.find((f) => f.name === name)?.description ?? "" : "";
}

async function describe(ctx: UiContext, id: string, name: string): Promise<void> {
  const text = await askInputBox({ title: `Describe ${name}`, value: currentDescription(ctx, id, name), placeholder: "One line about this file" });
  if (text !== undefined) ctx.transport.post({ type: "paper.describeFile", id, name, description: text.trim() });
}

function menuEntries(ctx: UiContext, id: string, e: TrayEntry, activate: () => void): MenuEntry[] {
  const entries: MenuEntry[] = [{ icon: "file", label: "Open", onSelect: activate }];
  for (const a of offered(e)) entries.push({ icon: a.glyph, label: a.label, onSelect: () => ctx.transport.post({ type: a.message, id, name: e.name }) });
  // paper.pdf's description is the short note, edited inline in its row.
  if (e.kind !== "pdf") entries.push("separator", { icon: "edit", label: "Describe…", onSelect: () => { void describe(ctx, id, e.name); } });
  return entries;
}

/** Adds the hover buttons and the context menu to a file or folder row; the Note row keeps the paper's menu. */
export function addRowActions(ctx: UiContext, id: string, e: TrayEntry, row: HTMLElement, activate: () => void): void {
  if (e.kind === "note") return;
  const slot = row.querySelector<HTMLElement>(".file-actions");
  for (const a of offered(e)) {
    const button = renderElement("button", { class: "ls-icon-btn", type: "button", tabindex: "-1", "aria-label": a.label, title: a.label, html: renderIcon(a.glyph) });
    button.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ctx.transport.post({ type: a.message, id, name: e.name });
    });
    slot?.append(button);
  }
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    showMenu({ x: ev.clientX, y: ev.clientY }, menuEntries(ctx, id, e, activate));
  });
}
