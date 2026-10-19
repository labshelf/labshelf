// Opens an app's one Typst compiler on first use: the WASM the app supplies, Typst's default fonts (downloaded once) and the package folders.
import type { ILogger } from "../../../ports/index.js";
import { openTypstSession, type TypstSession } from "../typstSession.js";
import { nodeTypstFiles } from "./typstFileAccess.js";
import { loadTypstFonts, missingTypstFonts } from "./typstFonts.js";
import { TypstPackageStore, type TypstPackageDirs } from "./typstPackages.js";

const MODULE = "writing/typst";

export interface TypstCompiler {
  session: TypstSession;
  packages: TypstPackageStore;
}

export interface TypstCompilerHostOptions {
  wasm(): Promise<Uint8Array>;
  /** The folder the default fonts are kept in, one subfolder per Typst version. */
  fontsDir: string;
  packageDirs: TypstPackageDirs;
  /** Wraps the font download, which only the first open of a fresh install runs, so the app can show it. */
  withFontDownload?<T>(run: () => Promise<T>): Promise<T>;
}

export class TypstCompilerHost {
  private opening: Promise<TypstCompiler> | undefined;

  constructor(private readonly options: TypstCompilerHostOptions) {}

  /** The compiler; a failed open, such as a font download while offline, is tried again on the next call. */
  get(logger: ILogger): Promise<TypstCompiler> {
    if (!this.opening) {
      const opening = this.open(logger);
      this.opening = opening;
      opening.catch(() => { if (this.opening === opening) { this.opening = undefined; } });
    }
    return this.opening;
  }

  private async fonts(logger: ILogger): Promise<Uint8Array[]> {
    const { fontsDir, withFontDownload } = this.options;
    const load = (): Promise<Uint8Array[]> => loadTypstFonts(fontsDir, { logger });
    if ((await missingTypstFonts(fontsDir)).length === 0 || !withFontDownload) { return load(); }
    return withFontDownload(load);
  }

  private async open(logger: ILogger): Promise<TypstCompiler> {
    const started = Date.now();
    const wasm = await this.options.wasm();
    const packages = new TypstPackageStore(this.options.packageDirs);
    const session = await openTypstSession({ wasm, fonts: await this.fonts(logger), files: nodeTypstFiles, packages });
    await logger.log("INFO", MODULE, "Opened the Typst compiler", { ms: Date.now() - started });
    return { session, packages };
  }
}
