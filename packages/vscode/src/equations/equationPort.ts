// Builds the reader's equation port for VS Code: the arXiv source over an e-print cache in the library folder, then the pix2tex source and its install when the host supplies them, then the AI vision source over the host's key store; the AI key offer is true while no key is stored.
import {
  EPRINT_CACHE_DIR, createAiVisionSource, createArxivEquationSource, createEquationExtractor,
  type AiCredentialStore, type EprintCache, type EquationPort, type EquationSource, type FetchLike, type ILogger, type LibraryFileSystem, type PaperRecord, type PostFetch,
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
  /** The AI keys of this host; the AI source runs over its store. */
  ai?: AiKeyHost;
}

/** What the port needs of the AI keys: the store the source reads, whether a key is stored (kept in memory, so it answers at once), and the dialog that adds one. */
export interface AiKeyHost {
  credentials: AiCredentialStore;
  hasKey(): boolean;
  /** Asks for the provider, then the key; true when a key was stored. */
  addKey(): Promise<boolean>;
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

/** @returns the port the reader extracts equations through: the arXiv source, then pix2tex and the AI vision source when the host has them; the AI key is offered while none is stored. */
export function createVsCodeEquationPort(deps: EquationPortDeps): EquationPort {
  const fetch: FetchLike = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init?.headers, "User-Agent": `LabShelf-VSCode/${deps.version}` } });
  const arxiv = createArxivEquationSource({ recordOf: deps.recordOf, fetch, cache: createEprintCache(deps), logger: deps.logger });
  const { pix2tex, ai } = deps;
  const postFetch: PostFetch = (url, init) => globalThis.fetch(url, { method: init.method, headers: init.headers, body: init.body, ...(init.signal ? { signal: init.signal } : {}) });
  const sources: EquationSource[] = [arxiv];
  if (pix2tex) { sources.push(pix2tex.source); }
  if (ai) { sources.push(createAiVisionSource({ credentials: ai.credentials, fetch: postFetch, logger: deps.logger })); }
  return createEquationExtractor({
    sources,
    offers: { pix2tex: pix2tex ? () => pix2tex.offer() : async () => "none", aiKey: () => (ai ? !ai.hasKey() : false) },
    logger: deps.logger,
    ...(pix2tex ? { installPix2tex: pix2tex.install } : {}),
    ...(ai ? { addAiKey: () => ai.addKey() } : {}),
  });
}
