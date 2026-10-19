// Creates the extension's one Typst compiler: the WASM from node_modules, the fonts in the extension's storage, and the Typst CLI's package folders.
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { TypstCompilerHost, typstPackageDirs } from "@labshelf/core/typst/node";

export function createTypstCompilerHost(storageDir: string): TypstCompilerHost {
  return new TypstCompilerHost({
    wasm: async () => new Uint8Array(await readFile(require.resolve("@myriaddreamin/typst-ts-web-compiler/wasm"))),
    fontsDir: path.join(storageDir, "typst", "fonts"),
    packageDirs: typstPackageDirs(),
    withFontDownload: (run) => Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Downloading Typst's default fonts (9 MB, once)" }, run,
    )),
  });
}
