// The browser reader's equation port: arXiv source fetched from the extension page, cached in the library's file system.
import {
  EPRINT_CACHE_DIR,
  createArxivEquationSource,
  createEquationExtractor,
  type EprintCache,
  type EquationPort,
  type ILogger,
  type LibraryFileSystem,
  type PaperRecord,
} from "@labshelf/core";

// The cache keeps raw e-print bytes at `.research/sources/arxiv/<id>` in whichever store the library uses (folder or IndexedDB).
function createEprintCache(fs: LibraryFileSystem): EprintCache {
  const pathOf = (arxivId: string): string => `${EPRINT_CACHE_DIR}/${arxivId}`;
  return {
    async read(arxivId) {
      const path = pathOf(arxivId);
      if (!(await fs.stat(path))?.isFile) return undefined;
      return fs.readFile(path);
    },
    async write(arxivId, bytes) {
      const path = pathOf(arxivId);
      // Old arXiv ids contain a slash, which makes a sub-folder.
      await fs.ensureDir(path.slice(0, path.lastIndexOf("/")));
      await fs.writeFile(path, bytes);
    },
  };
}

/** The reader's equation port for one open paper; no pix2tex or AI key is offered in the browser yet. */
export function createBrowserEquationPort(deps: { fs: LibraryFileSystem; paper: PaperRecord; logger: ILogger }): EquationPort {
  const { fs, paper, logger } = deps;
  const source = createArxivEquationSource({
    recordOf: async (paperId) => (paperId === paper.id ? paper : undefined),
    // INVARIANT: the global fetch is called as a bare function; as a method of another object it throws Illegal invocation.
    fetch: (url, init) => fetch(url, init),
    cache: createEprintCache(fs),
    logger,
  });
  return createEquationExtractor({
    sources: [source],
    offers: { pix2tex: async () => "none", aiKey: () => false },
    logger,
  });
}
