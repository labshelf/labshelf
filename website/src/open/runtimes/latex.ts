// LaTeX in the browser through texlyre-busytex (TeX Live 2026, pdflatex, AGPL-3.0 like LabShelf). Its engine and TeX Live packages live
// in the labshelf-assets R2 bucket and the website Worker serves them same-origin at /busytex/<version>/ (its Worker script must be
// same-origin with the page); the wrapper loads as a chunk on the first compile. One runner per page; an abort terminates it.
import { BUSYTEX_VERSION } from "./busytexManifest.js";
import type { BrowserCompileInput, BrowserCompileResult } from "./compileTypes.js";
import { deriveBusytexCompile, deriveLatexDiagnostics } from "./latexInputs.js";

type Busytex = typeof import("texlyre-busytex");

interface Engine { runner: InstanceType<Busytex["BusyTexRunner"]>; pdflatex: InstanceType<Busytex["PdfLatex"]> }

const BASE = `/busytex/${BUSYTEX_VERSION}`;

let engine: Promise<Engine> | undefined;
let queue: Promise<unknown> = Promise.resolve();
/** The progress callback of the compile running now; the runner's download callback is fixed when it is built. */
let progress: BrowserCompileInput["onProgress"];

function openEngine(): Promise<Engine> {
  engine ??= (async () => {
    const { BusyTexRunner, PdfLatex } = await import("texlyre-busytex");
    const runner = new BusyTexRunner({
      busytexBasePath: BASE,
      engineMode: "combined",
      preloadDataPackages: [`${BASE}/texlive-basic.js`],
      catalogDataPackages: [`${BASE}/texlive-recommended.js`],
      onDownloadProgress: ({ loaded, total, percent }) => progress?.({ loaded, total, percent }),
    });
    try { await runner.initialize(); } catch (error) { runner.terminate(); throw error; }
    return { runner, pdflatex: new PdfLatex(runner) };
  })().catch((error: unknown) => { engine = undefined; throw error; });
  return engine;
}

/** Stops the engine (its Worker included); the next compile starts a new one. */
function closeEngine(): void {
  const closing = engine;
  engine = undefined;
  void closing?.then(({ runner }) => runner.terminate(), () => undefined);
}

/** Settles with `work`, or rejects with the signal's reason as soon as it aborts, terminating the engine. */
function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) { return work; }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { closeEngine(); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function compileNow(input: BrowserCompileInput, signal: AbortSignal | undefined): Promise<BrowserCompileResult> {
  signal?.throwIfAborted();
  progress = input.onProgress;
  try {
    let open: Engine;
    try { open = await abortable(openEngine(), signal); }
    catch (error) {
      signal?.throwIfAborted();
      return { diagnostics: [{ severity: "error", message: `The browser LaTeX engine could not load: ${errorText(error)}`, file: input.main }] };
    }
    let result: Awaited<ReturnType<Engine["pdflatex"]["compile"]>>;
    try { result = await abortable(open.pdflatex.compile(deriveBusytexCompile(input)), signal); }
    catch (error) {
      signal?.throwIfAborted();
      // A timeout or a crash leaves the engine's Worker in an unknown state; the next compile starts a new one.
      closeEngine();
      return { diagnostics: [{ severity: "error", message: `The browser LaTeX engine failed: ${errorText(error)}`, file: input.main }] };
    }
    const pdf = result.pdf && result.pdf.length > 0 ? result.pdf : undefined;
    const diagnostics = deriveLatexDiagnostics(result.log ?? "", pdf !== undefined);
    return pdf ? { pdf, diagnostics } : { diagnostics };
  } finally {
    progress = undefined;
  }
}

/** Compiles one LaTeX project with pdflatex after any compile already running; aborting `signal` rejects with its reason and stops the engine. */
export function compileLatex(input: BrowserCompileInput, signal?: AbortSignal): Promise<BrowserCompileResult> {
  const run = queue.then(() => compileNow(input, signal));
  queue = run.catch(() => undefined);
  return run;
}
