// The browser reader's equation port: arXiv source fetched from the extension page, cached in the library's file system, then pix2tex through LabShelf Helper when the page has one, then an AI provider with a key kept in this browser.
import {
  EPRINT_CACHE_DIR,
  createAiVisionSource,
  createArxivEquationSource,
  createEquationExtractor,
  formatError,
  type AiCredentialStore,
  type AiProvider,
  type EprintCache,
  type EquationPort,
  type EquationSource,
  type ILogger,
  type LibraryFileSystem,
  type PaperRecord,
} from "@labshelf/core";
import { helperCanOcr, type HelperState, type ILatexHelper } from "@labshelf/core/helper";

// The cache keeps raw e-print bytes at `.research/sources/arxiv/<id>` in whichever store the library uses (folder or IndexedDB).
export function createEprintCache(fs: LibraryFileSystem): EprintCache {
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

const MODULE = "browser.equations";
const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai"];

/** The helper's status, connecting once when it is not known yet; a rejected connect counts as no helper. */
async function statusOf(helper: ILatexHelper, logger: ILogger): Promise<HelperState | undefined> {
  const known = helper.status();
  if (known !== undefined) return known;
  try {
    return await helper.connect();
  } catch (error) {
    void logger.log("WARN", MODULE, "LabShelf Helper is unreachable for equations", { error: formatError(error) });
    return undefined;
  }
}

/** The pix2tex of the page's helper: its source, the offer that follows the helper's state, and the install. */
function createHelperPix2tex(helperOf: () => ILatexHelper, logger: ILogger, openHelperSetup: (() => void) | undefined): {
  source: EquationSource;
  offer: () => Promise<"install" | "installHelper" | "none">;
  install: NonNullable<EquationPort["installPix2tex"]>;
} {
  // Set when the helper's ocr said pix2tex is not installed; cleared by a finished install.
  let missing = false;
  const capable = async (): Promise<boolean> => helperCanOcr(await statusOf(helperOf(), logger));
  const source: EquationSource = {
    id: "pix2tex",
    available: capable,
    async read(request, _onProgress, signal) {
      const result = await helperOf().ocr(request.png, signal ?? new AbortController().signal);
      if (result.ok) return { latex: result.latex };
      if (result.reason === "missing") {
        missing = true;
        return undefined;
      }
      throw new Error(result.message);
    },
  };
  return {
    source,
    async offer() {
      if (!(await capable())) return "installHelper";
      return missing ? "install" : "none";
    },
    async install(onProgress) {
      if (!(await capable())) {
        openHelperSetup?.();
        return false;
      }
      await helperOf().installPix2tex((progress) => onProgress(progress.message, progress.fraction));
      missing = false;
      return true;
    },
  };
}

/**
 * The AI vision source over the browser's key store, with the flag the extractor's synchronous `aiKey` offer reads: it is
 * refreshed at creation, by each `available` check and by `addAiKey`, which the reader's inline form calls after it stored a key.
 */
function createBrowserAiSource(credentials: AiCredentialStore, logger: ILogger): {
  source: EquationSource;
  offer: () => boolean;
  addAiKey: NonNullable<EquationPort["addAiKey"]>;
} {
  const ai = createAiVisionSource({
    credentials,
    // INVARIANT: the global fetch is called as a bare function; as a method of another object it throws Illegal invocation.
    fetch: (url, init) => fetch(url, init),
    logger,
  });
  let hasKey = false;
  const refresh = async (): Promise<boolean> => {
    const keys = await Promise.all(AI_PROVIDERS.map((provider) => credentials.get(provider)));
    hasKey = keys.some((key) => key !== undefined && key.trim() !== "");
    return hasKey;
  };
  refresh().catch((error: unknown) => {
    void logger.log("WARN", MODULE, "The stored AI keys could not be read", { error: formatError(error) });
  });
  return {
    source: { ...ai, available: async (request) => (hasKey = await ai.available(request)) },
    offer: () => !hasKey,
    addAiKey: refresh,
  };
}

/** The reader's equation port for one open paper: arXiv source, then pix2tex through the page's helper when `helper` is given, then the AI source when `credentials` is given. */
export function createBrowserEquationPort(deps: { fs: LibraryFileSystem; paper: PaperRecord; logger: ILogger; helper?: () => ILatexHelper; openHelperSetup?: () => void; credentials?: AiCredentialStore }): EquationPort {
  const { fs, paper, logger, helper, openHelperSetup, credentials } = deps;
  const source = createArxivEquationSource({
    recordOf: async (paperId) => (paperId === paper.id ? paper : undefined),
    // INVARIANT: the global fetch is called as a bare function; as a method of another object it throws Illegal invocation.
    fetch: (url, init) => fetch(url, init),
    cache: createEprintCache(fs),
    logger,
  });
  const pix2tex = helper ? createHelperPix2tex(helper, logger, openHelperSetup) : undefined;
  const ai = credentials ? createBrowserAiSource(credentials, logger) : undefined;
  return createEquationExtractor({
    sources: [source, ...(pix2tex ? [pix2tex.source] : []), ...(ai ? [ai.source] : [])],
    offers: { pix2tex: pix2tex ? pix2tex.offer : async () => "none", aiKey: ai ? ai.offer : () => false },
    logger,
    ...(ai ? { addAiKey: ai.addAiKey } : {}),
    installPix2tex: async (onProgress) => {
      if (pix2tex) return pix2tex.install(onProgress);
      openHelperSetup?.();
      return false;
    },
  });
}
