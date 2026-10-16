// Opens the extension's one Typst compiler on first use: the WASM from node_modules, Typst's default fonts (downloaded once) and the Typst package folders.
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { openTypstSession, type TypstSession } from "@labshelf/core/typst";
import { loadTypstFonts, missingTypstFonts, nodeTypstFiles, typstPackageDirs, TypstPackageStore } from "@labshelf/core/typst/node";

const MODULE = "writing/typst";

export interface TypstCompiler {
  session: TypstSession;
  packages: TypstPackageStore;
}

async function fonts(storageDir: string, logger: ILogger): Promise<Uint8Array[]> {
  if ((await missingTypstFonts(storageDir)).length === 0) { return loadTypstFonts(storageDir, { logger }); }
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Downloading Typst's default fonts (9 MB, once)" },
    () => loadTypstFonts(storageDir, { logger }),
  );
}

export class TypstCompilerHost {
  private opening: Promise<TypstCompiler> | undefined;

  constructor(private readonly storageDir: string) {}

  /** The compiler; a failed open, such as a font download while offline, is tried again on the next call. */
  get(logger: ILogger): Promise<TypstCompiler> {
    if (!this.opening) {
      const opening = this.open(logger);
      this.opening = opening;
      opening.catch(() => { if (this.opening === opening) { this.opening = undefined; } });
    }
    return this.opening;
  }

  private async open(logger: ILogger): Promise<TypstCompiler> {
    const started = Date.now();
    const wasm = new Uint8Array(await readFile(require.resolve("@myriaddreamin/typst-ts-web-compiler/wasm")));
    const packages = new TypstPackageStore(typstPackageDirs());
    const session = await openTypstSession({ wasm, fonts: await fonts(this.storageDir, logger), files: nodeTypstFiles, packages });
    await logger.log("INFO", MODULE, "Opened the Typst compiler", { ms: Date.now() - started });
    return { session, packages };
  }
}
