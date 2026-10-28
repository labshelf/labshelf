// Answers the library UI's paper changes shared by every host (tags, note, move, remove, the detail pane) over the LibraryUiHost port each app builds.
import type { PaperRecord } from "../model/index.js";
import type { HostToUi, PaperDetails } from "./protocol/index.js";
import { deriveCleanTags, formatKeptFieldNotice, moveNotice, removeNotice, titleResolver, type BatchError } from "./copy.js";

/** What the shared paper handlers need from the app hosting the library UI. */
export interface LibraryUiHost {
  /** The records of `ids` that exist, in the order given. */
  papers(ids: readonly string[]): Promise<readonly PaperRecord[]>;
  post(message: HostToUi): void | Promise<void>;
  notice(kind: "info" | "ok" | "error", text: string): void;
  /** Pushes the library to the UI again after a change; a no-op where the library pushes its own changes. */
  refresh(): Promise<void>;
  /** `add` and `remove` are already trimmed. */
  editTags(ids: readonly string[], add: string[], remove: string[]): Promise<{ failed: readonly BatchError[] }>;
  /** @returns false when the paper is not in the library */
  setNote(id: string, note: string): Promise<boolean>;
  trashPapers(papers: readonly PaperRecord[]): Promise<{ done: readonly string[]; failed: readonly BatchError[] }>;
  movePapers(ids: readonly string[], target: string): Promise<{ done: readonly string[]; failed: readonly BatchError[] }>;
  /** The folder name a move notice shows, or undefined for the library root. */
  folderName(target: string): string | undefined;
  details(paper: PaperRecord): Promise<PaperDetails>;
}

export async function setPaperTags(host: LibraryUiHost, ids: readonly string[], add: readonly string[], remove: readonly string[]): Promise<void> {
  const { failed } = await host.editTags(ids, deriveCleanTags(add), deriveCleanTags(remove));
  await host.refresh();
  const first = failed[0];
  if (first) host.notice("error", formatKeptFieldNotice("tags", failed.length, first.error));
}

export async function setPaperNote(host: LibraryUiHost, id: string, note: string): Promise<void> {
  if (!(await host.setNote(id, note))) { host.notice("error", "The note could not be saved — the paper is not in the library"); return; }
  await host.refresh();
}

/** Moves paper folders under `target`; the titles in the notice are looked up after the move. */
export async function movePaperFolders(host: LibraryUiHost, ids: readonly string[], target: string): Promise<void> {
  const { done, failed } = await host.movePapers(ids, target);
  if (done.length) await host.refresh();
  const notice = moveNotice(done.length, failed, host.folderName(target), titleResolver(await host.papers(ids)));
  if (notice) host.notice(notice.kind, notice.text);
}

export async function removePapers(host: LibraryUiHost, ids: readonly string[]): Promise<void> {
  const papers = await host.papers(ids);
  const { done, failed } = await host.trashPapers(papers);
  await host.refresh();
  const notice = removeNotice(done, failed, titleResolver(papers));
  if (notice) host.notice(notice.kind, notice.text);
}

export async function sendPaperDetails(host: LibraryUiHost, id: string): Promise<void> {
  const [paper] = await host.papers([id]);
  if (!paper) return;
  await host.post({ type: "details", id, details: await host.details(paper) });
}
