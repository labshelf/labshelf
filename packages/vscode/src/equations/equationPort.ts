// Builds the reader's equation port for VS Code: the arXiv source over an e-print cache in the library folder, and offers that report none until the pix2tex and AI sessions fill them.
import {
  EPRINT_CACHE_DIR, createArxivEquationSource, createEquationExtractor,
  type EprintCache, type EquationPort, type FetchLike, type ILogger, type LibraryFileSystem, type PaperRecord,
} from "@labshelf/core";

export interface EquationPortDeps {
  /** The adapter of the open library, which the cache writes through. */
  fs: Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile" | "ensureDir">;
  join: (base: string, ...segments: string[]) => string;
  /** The library folder; the e-prints live under its `.research/sources/arxiv/`. */
  root: string;
  /** Reads a paper's record from the library; undefined for an unknown paper. */
  recordOf(paperId: string): Promise<Pick<PaperRecord, "doi" | "url"> | undefined>;
  logger: ILogger;
  /** The extension version, for the User-Agent arXiv sees. */
  version: string;
}

// An old-style arXiv id has a slash (hep-th/9901001), which must not become a folder.
const cacheFileName = (arxivId: string): string => `${arxivId.replace(/[^A-Za-z0-9._-]/g, "_")}.eprint`;

function createEprintCache(deps: Pick<EquationPortDeps, "fs" | "join" | "root">): EprintCache {
  const dir = deps.join(deps.root, ...EPRINT_CACHE_DIR.split("/"));
  const fileOf = (arxivId: string) => deps.join(dir, cacheFileName(arxivId));
  return {
    async read(arxivId) {
      const file = fileOf(arxivId);
      return (await deps.fs.stat(file))?.isFile ? deps.fs.readFile(file) : undefined;
    },
    async write(arxivId, bytes) {
      await deps.fs.ensureDir(dir);
      await deps.fs.writeFile(fileOf(arxivId), bytes);
    },
  };
}

/** @returns the port the reader extracts equations through: the arXiv source only, and no pix2tex or AI key offered yet. */
export function createVsCodeEquationPort(deps: EquationPortDeps): EquationPort {
  const fetch: FetchLike = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init?.headers, "User-Agent": `LabShelf-VSCode/${deps.version}` } });
  const arxiv = createArxivEquationSource({ recordOf: deps.recordOf, fetch, cache: createEprintCache(deps), logger: deps.logger });
  return createEquationExtractor({
    sources: [arxiv],
    offers: { pix2tex: async () => "none", aiKey: () => false },
    logger: deps.logger,
  });
}
