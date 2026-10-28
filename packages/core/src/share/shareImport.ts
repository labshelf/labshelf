// Copies the papers of an opened share into a fresh library folder, skipping papers the library already holds, and runs that for a pasted or opened share link as a typed outcome the host shows.
import { extractPaperIdentifiers } from "../import/index.js";
import { deriveCiteKeySlug, createFolder, deriveMetadataFields, checkFolderName, createPaper, type MutationContext } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import { type OpenedShare, openShare, type OpenShareError } from "./shareFlows.js";
import type { SharedPaper } from "./shareCrypto.js";
import { parseShareLink } from "./shareLink.js";
import type { ShareReader } from "./shareBackend.js";

export interface ImportSharedPapersOptions {
  ctx: MutationContext;
  share: OpenedShare;
  /** The folder the share's folder is created in. */
  parentDir: string;
  /** The papers the library holds, for duplicates and free cite keys. */
  known: readonly Pick<PaperRecord, "id" | "doi" | "url">[];
  onProgress?: (done: number, total: number) => void;
}

export interface SharedImportOutcome {
  /** Undefined when every paper was already in the library, so no folder was made. */
  folder?: string;
  added: PaperRecord[];
  duplicates: { title: string; existingId: string }[];
  /** Titles of the papers imported without the PDF the share names, since it could not be read. */
  missingPdfs: string[];
}

const FALLBACK_FOLDER = "Shared papers";
const MODULE = "share";

function identityKeys(paper: Pick<PaperRecord, "doi" | "url">): string[] {
  const ids = extractPaperIdentifiers(paper);
  return [ids.doi && `doi:${ids.doi.toLowerCase()}`, ids.arxivId && `arxiv:${ids.arxivId.toLowerCase()}`].filter((key): key is string => Boolean(key));
}

/** The share's folder name, from untrusted text: a name a folder cannot take is replaced, a taken one gets " 2", " 3", … */
async function freeFolder(ctx: MutationContext, parentDir: string, wanted: string): Promise<string> {
  const base = checkFolderName(wanted) ? FALLBACK_FOLDER : wanted.trim();
  let name = base;
  for (let n = 2; await ctx.fs.exists(ctx.paths.join(parentDir, name)); n++) { name = `${base} ${n}`; }
  return createFolder(ctx, parentDir, name);
}

async function pdfOf(share: OpenedShare, paper: SharedPaper, ctx: MutationContext): Promise<Uint8Array | undefined> {
  const loaded = await share.loadPdf(paper);
  if (loaded.ok) { return loaded.bytes; }
  if (loaded.error !== "noPdf") {
    await ctx.logger.log("WARN", MODULE, "Imported a shared paper without its PDF", { paperId: paper.metadata.id, error: loaded.error, detail: loaded.detail });
  }
  return undefined;
}

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
export async function importSharedPapers({ ctx, share, parentDir, known, onProgress }: ImportSharedPapersOptions): Promise<SharedImportOutcome> {
  const byIdentity = new Map(known.flatMap((paper) => identityKeys(paper).map((key) => [key, paper.id] as const)));
  const taken = known.map((paper) => paper.id);
  const summary: SharedImportOutcome = { added: [], duplicates: [], missingPdfs: [] };
  const { papers } = share.manifest;
  for (const [index, paper] of papers.entries()) {
    const { metadata } = paper;
    const keys = identityKeys(metadata);
    const existingId = keys.map((key) => byIdentity.get(key)).find((id) => id !== undefined);
    if (existingId) {
      summary.duplicates.push({ title: metadata.title, existingId });
    } else {
      summary.folder ??= await freeFolder(ctx, parentDir, share.manifest.folder);
      const pdf = await pdfOf(share, paper, ctx);
      if (!pdf && paper.pdf) { summary.missingPdfs.push(metadata.title); }
      const record = await createPaper(ctx, taken, summary.folder, {
        // The cite key names a folder, so only its key characters survive.
        citeKey: deriveCiteKeySlug(metadata.citeKey) || deriveCiteKeySlug(metadata.title) || "paper",
        fields: { title: metadata.title, ...deriveMetadataFields(metadata) },
        pdf,
        sourceName: `share link "${share.manifest.folder}"`,
      });
      taken.push(record.id);
      for (const key of keys) { byIdentity.set(key, record.id); }
      summary.added.push(record);
    }
    onProgress?.(index + 1, papers.length);
  }
  await ctx.logger.log("INFO", MODULE, "Imported a share", {
    shareId: share.link.shareId, folder: summary.folder, added: summary.added.length, duplicates: summary.duplicates.length, missingPdfs: summary.missingPdfs.length,
  });
  return summary;
}

export interface ImportShareLinkOptions extends Omit<ImportSharedPapersOptions, "share"> {
  text: string;
  readerFor: (relayUrl: string) => ShareReader;
}

/** `refused` carries the parse error of a link that does not parse; `withAnnotations` says the share held annotations. */
export type ImportShareLinkResult =
  | { status: "refused"; error: string }
  | { status: "openFailed"; error: OpenShareError }
  | { status: "imported"; summary: SharedImportOutcome; withAnnotations: boolean };

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
/** Rejects only when writing the papers fails; a bad, revoked or unreachable link is a typed result. */
export async function importShareLink(options: ImportShareLinkOptions): Promise<ImportShareLinkResult> {
  const { text, ctx, readerFor } = options;
  const parsed = parseShareLink(text);
  if (!parsed.ok) {
    await ctx.logger.log("WARN", MODULE, "Refused a share link that does not parse", { error: parsed.error });
    return { status: "refused", error: parsed.error };
  }
  const opened = await openShare(text, readerFor);
  if (!opened.ok) {
    const context = { shareId: parsed.link.shareId, relayUrl: parsed.link.relayUrl, error: opened.error, detail: opened.detail };
    await ctx.logger.log("WARN", MODULE, "Could not open a share link", context);
    return { status: "openFailed", error: opened.error };
  }
  let summary: SharedImportOutcome;
  try {
    summary = await importSharedPapers({ ...options, share: opened.share });
  } catch (error) {
    await ctx.logger.error(MODULE, error, { action: "import the shared papers", shareId: parsed.link.shareId, relayUrl: parsed.link.relayUrl });
    throw error;
  }
  const withAnnotations = opened.share.manifest.papers.some((paper) => (paper.annotations?.length ?? 0) > 0);
  return { status: "imported", summary, withAnnotations };
}
