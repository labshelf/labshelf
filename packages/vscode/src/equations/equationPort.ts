// Builds the reader's equation port for VS Code: the arXiv source over an e-print cache in the library folder, then the pix2tex source and its install when the host supplies them; the AI key offer stays false until the AI session fills it.
import {
  EPRINT_CACHE_DIR, createArxivEquationSource, createEquationExtractor,
  type EprintCache, type EquationPort, type EquationSource, type FetchLike, type ILogger, type LibraryFileSystem, type PaperRecord,
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
  /** The pix2tex of this host; absent where it cannot run (the browser reader). */
  pix2tex?: Pix2texHost;
}

/** What the port needs of pix2tex: its source, whether to offer the install, and the install itself. */
export interface Pix2texHost {
  source: EquationSource;
  offer(): Promise<"install" | "none">;
  install: NonNullable<EquationPort["installPix2tex"]>;
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

/** @returns the port the reader extracts equations through: the arXiv source, then pix2tex when the host has it; no AI key is offered yet. */
export function createVsCodeEquationPort(deps: EquationPortDeps): EquationPort {
  const fetch: FetchLike = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init?.headers, "User-Agent": `LabShelf-VSCode/${deps.version}` } });
  const arxiv = createArxivEquationSource({ recordOf: deps.recordOf, fetch, cache: createEprintCache(deps), logger: deps.logger });
  const { pix2tex } = deps;
  return createEquationExtractor({
    sources: pix2tex ? [arxiv, pix2tex.source] : [arxiv],
    offers: { pix2tex: pix2tex ? () => pix2tex.offer() : async () => "none", aiKey: () => false },
    logger: deps.logger,
    ...(pix2tex ? { installPix2tex: pix2tex.install } : {}),
  });
}
