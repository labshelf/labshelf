// Finds or creates the project folder a share connection mirrors, waits for a joined share's index to name its kind, and writes a history restore into the share.
import type { ILogger } from "../../ports/index.js";
import type { ProjectCatalogContext } from "../../writing/project/index.js";
import { COMMENTS_PATH, importCommentsFile } from "../commentsFile.js";
import { readFileText, isSafeSharePath, setFileText } from "../sharedFiles.js";
import { readQmdDocText, setQmdDocText } from "../../qmd/index.js";
import { readShareIndexDocFiles, readShareIndexDocSettings, readShareIndexDocKind } from "../shareIndexDoc.js";
import { type ShareSession } from "../docSync.js";
import { joinShare, startShare } from "../../share/index.js";

const JOIN_TIMEOUT_MS = 120_000;

/** The share is of a kind this version cannot open, so nothing is created for it. */
export class UnknownShareKindError extends Error {
  constructor(readonly kind: unknown) {
    super(`The share is a ${String(kind)}, which this version of LabShelf cannot open. Update LabShelf and join again.`);
    this.name = "UnknownShareKindError";
  }
}

/** Rejects with UnknownShareKindError, on abort, or when no peer answers in JOIN_TIMEOUT_MS. */
export function ensureShareIndexDocReady(session: ShareSession, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error?: Error): void => {
      clearTimeout(timer);
      session.index.off("update", check);
      signal.removeEventListener("abort", onAbort);
      if (error) { reject(error); } else { resolve(); }
    };
    const check = (): void => {
      const kind = readShareIndexDocKind(session.index);
      if (!kind.ok && kind.error === "unknownShareKind") { settle(new UnknownShareKindError(kind.kind)); return; }
      if (kind.ok && readShareIndexDocSettings(session.index).size > 0) { settle(); }
    };
    const onAbort = (): void => settle(new Error("Joining was cancelled"));
    const timer = setTimeout(() => settle(new Error("No member of the share answered in 2 minutes; ask one to open the project and try again")), JOIN_TIMEOUT_MS);
    session.index.on("update", check);
    signal.addEventListener("abort", onAbort);
    if (signal.aborted) { onAbort(); } else { check(); }
  });
}

/** `share` turns a project into a share, `resume` reconnects a shared one, `join` creates the project of a share in the library. */
export type ShareStart = { mode: "share" | "resume"; folder: string } | { mode: "join"; signal: AbortSignal };

/** Where projects live: the catalog that creates a joined one, and the library root it goes under. */
export interface ShareProjects {
  context: ProjectCatalogContext;
  libraryRoot: string;
}

export interface PlacedProject {
  folder: string;
  /** The id of the project a join created; undefined for share and resume, whose caller already knows it. */
  joinedId: string | undefined;
}

/** Seeds the share's comments map from the project's comments.qmd, which the map stands for from then on. */
async function importComments({ fs, paths }: ProjectCatalogContext, folder: string, session: ShareSession, logger: ILogger): Promise<void> {
  const file = paths.join(folder, ...COMMENTS_PATH.split("/"));
  // PLATFORM: adapters report a missing file differently (ENOENT, a bridge `createNotFoundAnswer`, a plain Error), so absence is asked of `exists`.
  if (!(await fs.exists(file))) { return; }
  const text = await fs.readText(file);
  const added = importCommentsFile(session.index, text);
  if (added === undefined) {
    void logger.log("WARN", "collab", "comments.qmd is not valid, so its threads are not shared", { folder, path: COMMENTS_PATH });
    return;
  }
  void logger.log("INFO", "collab", "Shared the project's comment threads", { folder, threads: added });
}

export async function ensureSharedProject(
  { context, libraryRoot }: ShareProjects, shareId: string, session: ShareSession, start: ShareStart,
): Promise<PlacedProject> {
  if (start.mode === "join") {
    await ensureShareIndexDocReady(session, start.signal);
    const joined = await joinShare(context, { libraryRoot, shareId, index: session.index });
    return { folder: joined.folder, joinedId: joined.id };
  }
  if (start.mode === "share") {
    await startShare(context, { folder: start.folder, shareId, index: session.index });
    await importComments(context, start.folder, session, context.logger);
  }
  return { folder: start.folder, joinedId: undefined };
}

const LOG_MODULE = "collab.restore";

export interface ApplyRestoredFilesOptions {
  session: Pick<ShareSession, "index" | "openDoc">;
  /** The text a shared path holds after the restore, or null when the restore removed the file. */
  restored(path: string): Promise<string | null>;
  /** The transaction origin of the edits; not the disk origin, which the node mirror skips and so would never send to peers. */
  origin: unknown;
  logger: ILogger;
}

export async function applyRestoredFiles({ session, restored, origin, logger }: ApplyRestoredFilesOptions): Promise<void> {
  const files = readShareIndexDocFiles(session.index);
  const textPaths = [...files.entries()]
    .filter(([path, entry]) => (entry.kind === "text" || entry.kind === "qmd") && isSafeSharePath(path)).map(([path]) => path);
  const removed: string[] = [];
  let updated = 0;
  for (const path of textPaths) {
    const next = await restored(path);
    if (next === null) { removed.push(path); continue; }
    const doc = session.openDoc(path);
    const qmd = files.get(path)?.kind === "qmd";
    if ((qmd ? readQmdDocText(doc) : readFileText(doc).toString()) === next) { continue; }
    if (qmd) { setQmdDocText(doc, next, origin); } else { setFileText(doc, next, origin); }
    updated += 1;
  }
  if (removed.length > 0) {
    session.index.transact(() => { for (const path of removed) { files.delete(path); } }, origin);
  }
  void logger.log("INFO", LOG_MODULE, "Applied a history restore to the shared project", { updated, removed: removed.length });
}
