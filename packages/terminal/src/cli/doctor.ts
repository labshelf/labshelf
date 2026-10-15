// `labshelf doctor`: checks everything the terminal app depends on, without needing a working library.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { libraryLayout, relativeTime } from "@labshelf/core";

import type { TerminalConfig } from "../app/index.js";
import { hasCommand } from "../platform/index.js";
import { createTokenStore, resolveTerminalOAuthClient } from "../sync/index.js";
import { detectImageProtocol } from "../tui/index.js";
import { sharedConfigDir, sharedConfigPath } from "@labshelf/core/node";
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
  line(true, "config", `${sharedConfigPath()}${config.libraryRoot ? "" : " (no libraryRoot yet)"}`);
  if (!root) {
    line(false, "library", "not configured — run `labshelf init <path>` (use the folder VS Code uses)");
    essentialMissing = true;
  } else {
    const layout = libraryLayout(root, path.join);
    const exists = await fs.stat(layout.papersRoot()).then((s) => s.isDirectory(), () => false);
    line(exists, "library", `${root} (from ${rootSource})`);
    if (!exists) { essentialMissing = true; }
    const lock = await fs.readFile(layout.lockPath(), "utf8").catch(() => undefined);
    if (lock) { line("warn", "sync lock", `held: ${lock.replace(/\s+/g, " ").slice(0, 120)}`); }
    const last = await fs.readFile(layout.lastRunPath(), "utf8").then((t) => JSON.parse(t) as { finishedAt?: string; app?: string }, () => undefined);
    line(last ? true : "warn", "last sync", last?.finishedAt ? `${relativeTime(last.finishedAt) || "never"} by ${last.app}` : "never (by an app that records it)");
  }
  const client = resolveTerminalOAuthClient();
  line(client ? true : "warn", "drive client", client ? `configured (${client.clientId.slice(0, 12)}…)` : "missing: set up credentials/google-desktop.json and rebuild, or set LABSHELF_GOOGLE_CLIENT_ID/SECRET to a client of the same Google Cloud project");
  const store = createTokenStore();
  const tokens = await store.load().catch(() => null);
  line(tokens ? true : "warn", "drive sign-in", tokens ? `signed in (tokens in ${store.kind})` : `signed out — run \`labshelf auth login\` (tokens go to ${store.kind})`);
  const protocol = detectImageProtocol(process.env, process.env["LABSHELF_IMAGES"] ?? config.terminal?.images ?? "auto");
  line(protocol !== "none" ? true : "warn", "thumbnails", protocol !== "none"
    ? `${protocol} protocol (${process.env["TERM_PROGRAM"] ?? process.env["TERM"]})`
    : "this terminal shows no images (kitty, Ghostty, iTerm2, WezTerm do; LABSHELF_IMAGES=iterm forces one)");
  line(hasCommand("pdftoppm") ? true : "warn", "pdftoppm", hasCommand("pdftoppm") ? "found" : "not found — thumbnails use pdfjs (slower); brew install poppler");
  const clipboard = process.platform === "darwin" ? hasCommand("pbcopy") : hasCommand("wl-copy") || hasCommand("xclip") || hasCommand("xsel");
  line(clipboard ? true : "warn", "clipboard", clipboard ? "system clipboard" : "no clipboard tool; using OSC 52 escapes");
  line(true, "config dir", sharedConfigDir());
  return essentialMissing ? 1 : 0;
}
