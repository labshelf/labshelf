// Copies an opened share's papers into a fresh library folder, skipping papers the library already holds by DOI or arXiv id.
import { extractPaperIdentifiers } from "../import/index.js";
import { deriveCiteKeySlug, createFolder, deriveMetadataFields, checkFolderName, createPaper, type MutationContext } from "../library/index.js";
import type { PaperRecord } from "../model/index.js";
import type { OpenedShare } from "./openShare.js";
import type { SharedPaper } from "./shareManifest.js";

export interface ImportSharedPapersOptions {
  ctx: MutationContext;
  share: OpenedShare;
  /** The folder the share's folder is created in. */
  parentDir: string;
  /** The papers the library holds, for duplicates and free cite keys. */
  known: readonly Pick<PaperRecord, "id" | "doi" | "url">[];
  onProgress?: (done: number, total: number) => void;
}

export interface SharedImportSummary {
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
export async function importSharedPapers({ ctx, share, parentDir, known, onProgress }: ImportSharedPapersOptions): Promise<SharedImportSummary> {
  const byIdentity = new Map(known.flatMap((paper) => identityKeys(paper).map((key) => [key, paper.id] as const)));
  const taken = known.map((paper) => paper.id);
  const summary: SharedImportSummary = { added: [], duplicates: [], missingPdfs: [] };
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
