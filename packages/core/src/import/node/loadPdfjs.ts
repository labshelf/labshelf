/** Loads pdf.js once for a Node host and runs its worker in-process; one loader per composition root. */
import type { PdfjsLoader, PdfjsModule, PdfLoadingTask } from "../pdf/index.js";
import { DiskBinaryDataFactory } from "./pdfjsFileFactory.js";
import { installElectronGlobals, patchFeatureTestPlatform } from "./pdfjsShims.js";
import { pdfjsDataOptions } from "./pdfjsOpenOptions.js";

export interface PdfjsLoaderOptions {
  /** The host is an Electron utility process (the VS Code extension host), which pdf.js does not recognise as Node. */
  electronShims?: boolean;
}

const WORKER_SPECIFIER = "pdfjs-dist/legacy/build/pdf.worker.mjs";

/**
 * Importing pdf.js is deferred to the first `load()`, so creating a loader costs nothing for callers that never open a PDF.
 * @returns a loader whose pdf.js import and worker registration happen once
 */
export function createPdfjsLoader(options: PdfjsLoaderOptions = {}): PdfjsLoader {
  const electron = options.electronShims === true;
  let loading: Promise<PdfjsModule> | undefined;
  // A failed import is not cached, so a later call can try again.
  const load = (): Promise<PdfjsModule> =>
    (loading ??= importPdfjs(electron).catch((error: unknown) => {
      loading = undefined;
      throw error;
    }));

  return {
    load,
    async getDocument(documentOptions) {
      const pdfjs = await load();
      const getDocument = pdfjs["getDocument"] as (options: Record<string, unknown>) => PdfLoadingTask;
      return getDocument({
        ...pdfjsDataOptions(),
        ...(electron ? { BinaryDataFactory: DiskBinaryDataFactory } : {}),
        ...documentOptions,
      });
    },
  };
}

async function importPdfjs(electron: boolean): Promise<PdfjsModule> {
  if (electron) {
    installElectronGlobals();
  }
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  if (electron) {
    patchFeatureTestPlatform(pdfjs);
  }
  await registerInProcessWorker(pdfjs);
  return pdfjs;
}

async function registerInProcessWorker(pdfjs: PdfjsModule): Promise<void> {
  const globals = globalThis as Record<string, unknown>;
  if (!(globals["pdfjsWorker"] as { WorkerMessageHandler?: unknown } | undefined)?.WorkerMessageHandler) {
    // pdfjs-dist ships no types for the worker entry; a variable specifier keeps tsc from looking for them.
    const specifier = WORKER_SPECIFIER;
    const worker = (await import(specifier)) as { WorkerMessageHandler?: unknown };
    globals["pdfjsWorker"] = { WorkerMessageHandler: worker.WorkerMessageHandler };
  }
  const workerOptions = pdfjs["GlobalWorkerOptions"] as { workerSrc?: string } | undefined;
  if (workerOptions && !workerOptions.workerSrc) {
    workerOptions.workerSrc = WORKER_SPECIFIER;
  }
}
