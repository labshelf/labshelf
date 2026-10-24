// Builds paper menus from the host capabilities.
import { PAPERS_DIR } from "../../../library/index.js";
import { PAPER_STATUSES, STATUS_LABEL, isPrePublication } from "../../../model/index.js";
import { showMenu, type MenuAnchor, type MenuEntry } from "../../../ui/dom/index.js";
import { listPapersUnder, type ListPaper } from "../../viewModel/index.js";
import {
  attachPdf, confirmFindBetterPdf, confirmRemove, copyCitation, findPdf, fixableIds, hostFileAction, makeSearchable, openPaper, pickMoveTarget, promptAddTags, setPaperStatus,
} from "../flows/index.js";
import { KEY_HINT, type UiContext } from "../uiContext.js";

function openEntries(ctx: UiContext, p: ListPaper): MenuEntry[] {
  const lastPage = ctx.store.get().stats[p.id]?.lastPage ?? 0;
  const entries: MenuEntry[] = [{
    icon: "book-open", label: lastPage > 1 ? `Continue Reading (p. ${lastPage})` : "Open PDF", hint: "Enter",
    disabled: !p.hasPdf, onSelect: () => openPaper(ctx, p.id),
  }];
  if (ctx.caps.openExternal) entries.push({ icon: "external", label: "Open in Default PDF App", disabled: !p.hasPdf, onSelect: () => hostFileAction(ctx, "paper.openExternal", p.id) });
  if (ctx.caps.findPdf && !p.hasPdf) entries.push({ icon: "search", label: "Find PDF", onSelect: () => findPdf(ctx, p.id) });
  if (ctx.caps.findPdf && p.hasPdf && isPrePublication(p.pdfVersion)) {
    entries.push({ icon: "search", label: "Find Published Version…", onSelect: () => { void confirmFindBetterPdf(ctx, p.id); } });
  }
  if (ctx.caps.attachPdf) entries.push({ icon: "paperclip", label: "Attach PDF…", onSelect: () => attachPdf(ctx, p.id) });
  return [...entries, "separator"];
}

function copyEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  return [
    { icon: "key", label: ids.length > 1 ? `Copy ${ids.length} Cite Keys` : "Copy Cite Key", hint: `${KEY_HINT.mod}C`, onSelect: () => copyCitation(ctx, ids, "key") },
    { icon: "quote", label: "Copy BibTeX", onSelect: () => copyCitation(ctx, ids, "bibtex") },
    { label: "Copy APA Reference", onSelect: () => copyCitation(ctx, ids, "apa") },
    "separator",
  ];
}

function statusEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  const byId = new Map(ctx.store.get().papers.map((p) => [p.id, p]));
  return [...PAPER_STATUSES.map((status, i): MenuEntry => ({
    lead: `<span class="ls-dot s-${status}"></span>`,
    checked: ids.every((id) => byId.get(id)?.status === status),
    label: `Mark as ${STATUS_LABEL[status]}`,
    hint: `${KEY_HINT.alt}${i + 1}`,
    onSelect: () => setPaperStatus(ctx, ids, status),
  })), "separator"];
}

function organizeEntries(ctx: UiContext, ids: string[], one: ListPaper | null): MenuEntry[] {
  const entries: MenuEntry[] = [];
  entries.push({ icon: "tag", label: ids.length > 1 ? `Tag ${ids.length} Papers…` : "Add Tag…", onSelect: () => { void promptAddTags(ctx, ids); } });
  entries.push({ icon: "folder-move", label: "Move to…", onSelect: () => { void pickMoveTarget(ctx, ids); } });
  if (ctx.caps.spaces) entries.push({ icon: "folder", label: "Add to Space…", onSelect: () => ctx.transport.post({ type: "paper.addToSpace", ids }) });
  if (one && ctx.caps.reveal) entries.push({ icon: "folder", label: ctx.labels.revealPaper ?? "Reveal Folder", onSelect: () => hostFileAction(ctx, "paper.reveal", one.id) });
  const fix = ctx.caps.textLayer ? fixableIds(ctx, ids) : [];
  if (fix.length) entries.push({ icon: "file-no-text", label: ids.length > 1 ? `Make ${fix.length} Searchable` : "Make Searchable (OCR)", onSelect: () => makeSearchable(ctx, fix) });
  if (one && ctx.caps.fetchMetadata) entries.push({ icon: "refresh", label: "Fetch Metadata Online", onSelect: () => hostFileAction(ctx, "paper.fetchMetadata", one.id) });
  if (one && (ctx.store.get().stats[one.id]?.annotations ?? 0) > 0) {
    entries.push({ icon: "download", label: "Export Annotations…", onSelect: () => hostFileAction(ctx, "annotations.export", one.id) });
  }
  return [...entries, "separator"];
}

function paperMenuEntries(ctx: UiContext, ids: string[]): MenuEntry[] {
  const s = ctx.store.get();
  const one = ids.length === 1 ? listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).find((p) => p.id === ids[0]) ?? null : null;
  return [
    ...(one ? openEntries(ctx, one) : []),
    ...copyEntries(ctx, ids),
    ...statusEntries(ctx, ids),
    ...organizeEntries(ctx, ids, one),
    {
      icon: "trash", danger: true, label: ids.length > 1 ? `Remove ${ids.length} Papers…` : "Remove from Library…", hint: KEY_HINT.remove,
      onSelect: () => { void confirmRemove(ctx, ids); },
    },
  ];
}

export function showPaperMenu(ctx: UiContext, at: MenuAnchor | HTMLElement, onClose?: () => void): void {
  const ids = [...ctx.store.get().selected];
  if (ids.length > 0) showMenu(at, paperMenuEntries(ctx, ids), onClose ? { onClose } : {});
}
