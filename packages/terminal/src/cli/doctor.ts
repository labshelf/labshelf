// Runs `labshelf doctor`, checking everything the terminal app depends on without needing a working library.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createLibraryLayout } from "@labshelf/core";

import type { TerminalConfig } from "../config.js";
import { hasCommand } from "../platform/index.js";
import { detectImageProtocol } from "../screen/index.js";
import { resolveSharedConfigDir, resolveSharedConfigPath } from "@labshelf/core/node";
import type { Output } from "./usage.js";

/**
 * @returns the exit code (1 when something essential is missing)
 */
export async function runDoctor(root: string | undefined, rootSource: string, config: TerminalConfig, io: Output): Promise<number> {
  let essentialMissing = false;
  const line = (ok: boolean | "warn", label: string, detail: string): void => {
    io.out(`${ok === true ? "ok  " : ok === "warn" ? "warn" : "FAIL"}  ${label.padEnd(16)} ${detail}`);
  };
  const major = Number(process.versions.node.split(".")[0]);
  line(major >= 22, "node", process.version);
  if (major < 22) { essentialMissing = true; }
  line(true, "config", `${resolveSharedConfigPath()}${config.libraryRoot ? "" : " (no libraryRoot yet)"}`);
  if (!root) {
    line(false, "library", "not configured — run `labshelf init <path>` (use the folder VS Code uses)");
    essentialMissing = true;
  } else {
    const layout = createLibraryLayout(root, path.join);
    const exists = await fs.stat(layout.papersRoot()).then((s) => s.isDirectory(), () => false);
    line(exists, "library", `${root} (from ${rootSource})`);
    if (!exists) { essentialMissing = true; }
  }
  const protocol = detectImageProtocol(process.env, process.env["LABSHELF_IMAGES"] ?? config.terminal?.images ?? "auto");
  line(protocol !== "none" ? true : "warn", "thumbnails", protocol !== "none"
    ? `${protocol} protocol (${process.env["TERM_PROGRAM"] ?? process.env["TERM"]})`
    : "this terminal shows no images (kitty, Ghostty, iTerm2, WezTerm do; LABSHELF_IMAGES=iterm forces one)");
  line(hasCommand("pdftoppm") ? true : "warn", "pdftoppm", hasCommand("pdftoppm") ? "found" : "not found — thumbnails use pdfjs (slower); brew install poppler");
  const clipboard = process.platform === "darwin" ? hasCommand("pbcopy") : hasCommand("wl-copy") || hasCommand("xclip") || hasCommand("xsel");
  line(clipboard ? true : "warn", "clipboard", clipboard ? "system clipboard" : "no clipboard tool; using OSC 52 escapes");
  line(true, "config dir", resolveSharedConfigDir());
  return essentialMissing ? 1 : 0;
}
