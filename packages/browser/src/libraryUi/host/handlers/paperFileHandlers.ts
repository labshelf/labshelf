// Answers the file tray of a paper: lists its folder, describes, opens and copies the path of one entry.
import { PDF_FILE, formatError, type LibraryFileSystem, type PaperRecord } from "@labshelf/core";
import { bx } from "../../../platform";
import { createLibraryFileSystem } from "../../../storage";
import type { HostContext } from "../hostContext";
import { writeClipboard } from "./paperHandlers";

export interface PaperFileHandlers {
  list(id: string): Promise<void>;
  describe(id: string, name: string, description: string): Promise<void>;
  open(id: string, name: string): Promise<void>;
  copyPath(id: string, name: string): Promise<void>;
}

// CONTRACT: documents/contracts/library-ui-host.md#rules
// File messages name one direct entry of the paper folder, so a name that leaves it is refused.
function isEntryName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/");
}

/** The paper and entry a file message names, or undefined after telling the user and logging why. */
function resolveEntry(ctx: HostContext, id: string, name: string, action: string): PaperRecord | undefined {
  const [paper] = ctx.papers([id]);
  if (paper && isEntryName(name)) return paper;
  void ctx.log.log("WARN", "libraryUi", "File message refused", { action, id, name, knownPaper: !!paper });
  ctx.notice("error", paper ? `"${name}" is not a file of this paper.` : "That paper is no longer in the library.");
  return undefined;
}

async function listFiles(ctx: HostContext, id: string): Promise<void> {
  const [paper] = ctx.papers([id]);
  if (!paper) {
    void ctx.log.log("WARN", "libraryUi", "File listing asked for an unknown paper", { id });
    ctx.endpoint.post({ type: "files", id, state: { status: "failed", message: "That paper is no longer in the library." } });
    return;
  }
  ctx.endpoint.post({ type: "files", id, state: await ctx.mutations.listFiles(paper) });
}

async function describeFile(ctx: HostContext, id: string, name: string, description: string): Promise<void> {
  const paper = resolveEntry(ctx, id, name, "describe");
  if (!paper) return;
  try {
    const written = await ctx.mutations.describeFile({ id: paper.id, path: paper.path }, name, description);
    if (!written) throw new Error(`no paper in ${paper.path}`);
  } catch (err) {
    void ctx.log.error("libraryUi", err, { action: "describeFile", id, name });
    ctx.notice("error", `Could not save the description — ${formatError(err)}`);
    return;
  }
  await ctx.snapshots.refresh();
  await listFiles(ctx, id);
}

async function openFile(ctx: HostContext, fs: LibraryFileSystem, openPdf: (id: string) => Promise<void>, id: string, name: string): Promise<void> {
  const paper = resolveEntry(ctx, id, name, "open");
  if (!paper) return;
  if (name === PDF_FILE) { await openPdf(id); return; }
  const path = `${paper.path}/${name}`;
  const bytes = (await fs.stat(path)) ? await fs.readFile(path) : undefined;
  if (!bytes) {
    void ctx.log.log("WARN", "libraryUi", "File to open is missing", { id, name });
    ctx.notice("error", `"${name}" is no longer in this paper's folder.`);
    return;
  }
  // PLATFORM: the blob URL lives as long as this page, which the new tab needs while it loads.
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  await bx.tabs.create({ url });
}

/** `openPdf` is the reader route paper.pdf takes, the same one the paper's Open uses. */
export function createPaperFileHandlers(ctx: HostContext, openPdf: (id: string) => Promise<void>): PaperFileHandlers {
  const fs = createLibraryFileSystem();
  return {
    list: (id) => listFiles(ctx, id),
    describe: (id, name, description) => describeFile(ctx, id, name, description),
    open: (id, name) => openFile(ctx, fs, openPdf, id, name),
    async copyPath(id, name) {
      const paper = resolveEntry(ctx, id, name, "copyPath");
      if (paper) await writeClipboard(ctx, `${paper.path}/${name}`);
    },
  };
}
