/** Loads pdf.js for a Node host: the package lookup, the getDocument options, the Electron shims and the in-process loader. */
import { readFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import type { PdfjsLoader, PdfjsModule, PdfLoadingTask } from "../pdf/index.js";

/**
 * `require` is the CommonJS one under Jest and the createRequire shim the bundles define at the top of their output.
 * @returns the absolute path of pdfjs-dist/package.json, or undefined when it cannot be resolved
 */
export function resolvePdfjsPackageJson(): string | undefined {
  try {
    return typeof require === "function" ? require.resolve("pdfjs-dist/package.json") : undefined;
  } catch {
    return undefined;
  }
}

function resolvePdfjsPackageDir(): string | undefined {
  const packageJson = resolvePdfjsPackageJson();
  return packageJson ? dirname(packageJson) : undefined;
}

/**
 * Without the CMap and standard-font tables, text drawn with CID or non-embedded fonts extracts as blanks, which
 * starves the metadata heuristics. `useWorkerFetch: false` keeps the in-process worker from fetch()ing the paths.
 * @returns options to spread into getDocument
 */
export function createPdfjsOptions(): Record<string, unknown> {
  const base = { verbosity: 0, isEvalSupported: false };
  const root = resolvePdfjsPackageDir();
  if (!root) {
    return base;
  }
  return {
    ...base,
    cMapUrl: join(root, "cmaps") + sep,
    cMapPacked: true,
    standardFontDataUrl: join(root, "standard_fonts") + sep,
    wasmUrl: join(root, "wasm") + sep,
    useWorkerFetch: false,
  };
}

// Mirrors pdf.js' BaseBinaryDataFactory, which it does not export.
export class PdfjsFileFactory {
  private readonly roots: Record<string, string | null>;

  constructor(options: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.roots = {
      cMapUrl: options.cMapUrl ?? null,
      standardFontDataUrl: options.standardFontDataUrl ?? null,
      wasmUrl: options.wasmUrl ?? null,
    };
  }

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const root = this.roots[kind];
    if (!root) {
      throw new Error(`Ensure that the \`${kind}\` API parameter is provided.`);
    }
    return new Uint8Array(await readFile(`${root}${filename}`));
  }
}

// Makes pdf.js usable inside an Electron utility process such as the VS Code extension host.
// PLATFORM: pdf.js tests for Node at import time, an Electron utility process fails that test, and pdf.js then reads navigator and DOMMatrix, which do not exist there.
const PLATFORM_BY_OS: Record<string, string> = {
  linux: "Linux x86_64",
  darwin: "MacIntel",
  win32: "Win32",
};

/** Installs the globals pdf.js reads while its module loads: navigator and a DOMMatrix stub. */
export function installElectronGlobals(): void {
  const globals = globalThis as Record<string, unknown>;
  ensureNavigator(globals);
  if (typeof globals["DOMMatrix"] === "undefined") {
    globals["DOMMatrix"] = createDomMatrixStub();
  }
}

/** Caches FeatureTest.platform so pdf.js never reads an undefined navigator after it has loaded. */
export function updateFeatureTestPlatform(pdfjs: Record<string, unknown>): void {
  const featureTest = pdfjs["FeatureTest"] as Record<string, unknown> | undefined;
  const shadow = pdfjs["shadow"] as ((obj: object, prop: string, value: unknown) => void) | undefined;
  if (!featureTest || !shadow) {
    return;
  }
  try {
    void featureTest["platform"];
  } catch {
    shadow(featureTest, "platform", {
      isAndroid: false,
      isLinux: true,
      isMac: false,
      isWindows: false,
      isFirefox: false,
    });
  }
}

function ensureNavigator(globals: Record<string, unknown>): void {
  const platform = PLATFORM_BY_OS[process.platform] ?? "Linux x86_64";
  const userAgent = `Node.js ${process.version}`;
  const descriptor = Object.getOwnPropertyDescriptor(globals, "navigator");
  // Node's own navigator is a getter whose first read prints a migration warning; it already has both fields.
  if (descriptor?.get) return;
  const current = descriptor?.value as { platform?: unknown; userAgent?: unknown } | undefined;
  try {
    if (current && typeof current === "object") {
      if (typeof current.platform !== "string") {
        Object.defineProperty(current, "platform", { value: platform, configurable: true });
      }
      if (typeof current.userAgent !== "string") {
        Object.defineProperty(current, "userAgent", { value: userAgent, configurable: true });
      }
    } else {
      Object.defineProperty(globals, "navigator", { value: { platform, userAgent, language: "en-US" }, configurable: true });
    }
  } catch {
    // A read-only navigator already carries its fields; patchFeatureTestPlatform covers the rest.
  }
}

// pdf.js needs the constructor and the 2D fields at module load time, nothing more.
function createDomMatrixStub(): new (init?: number[] | string) => unknown {
  class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;

    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length >= 6) {
        this.a = init[0] ?? 1; this.b = init[1] ?? 0;
        this.c = init[2] ?? 0; this.d = init[3] ?? 1;
        this.e = init[4] ?? 0; this.f = init[5] ?? 0;
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
        this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
      }
    }

    multiply(_other: DOMMatrix): DOMMatrix { return new DOMMatrix(); }
    preMultiplySelf(_other: DOMMatrix): this { return this; }
    multiplySelf(_other: DOMMatrix): this { return this; }
    invertSelf(): this { return this; }
    translate(_tx = 0, _ty = 0): DOMMatrix { return new DOMMatrix(); }
    scale(_sx = 1, _sy = 1): DOMMatrix { return new DOMMatrix(); }
    transformPoint(point?: { x?: number; y?: number }): { x: number; y: number; z: number; w: number } {
      return { x: point?.x ?? 0, y: point?.y ?? 0, z: 0, w: 1 };
    }
  }
  return DOMMatrix;
}

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
        ...createPdfjsOptions(),
        ...(electron ? { BinaryDataFactory: PdfjsFileFactory } : {}),
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
    updateFeatureTestPlatform(pdfjs);
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
