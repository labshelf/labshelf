// Assembles what a build run needs from the terminal: the build queue with its dependencies, the source watcher and Ctrl-C.
import * as os from "node:os";
import * as path from "node:path";

import { createProjectData, type TexInstallKind, type TexSetupPrompt } from "@labshelf/core";
import { createSharedTexProvider, createDeviceLocalLayout, NodeLibraryFileSystem, ProjectBuildQueue } from "@labshelf/core/node";

import type { AppContext } from "../../compositionRoot.js";
import type { ReadyProject } from "./findProject.js";
import { withPrompt } from "../ask.js";
import { watch } from "node:fs";

// PDFs, logs and aux files are written by the build itself, so only sources trigger a rebuild.
const SOURCE = /\.(tex|typ|bib|sty|cls)$/i;
const HIDDEN_FOLDER = /(^|[\\/])\./;
const DEBOUNCE_MS = 200;

/** @returns a function that stops watching */
function watchSources(folder: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(folder, { recursive: true, persistent: true }, (_event, file) => {
    if (typeof file !== "string" || !SOURCE.test(file) || HIDDEN_FOLDER.test(file)) { return; }
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });
  return () => { clearTimeout(timer); watcher.close(); };
}

/** Resolves to the typed answer, or undefined when input ends. */
type Ask = Parameters<Parameters<typeof withPrompt>[0]>[0];

const QUESTION = "LaTeX is not installed. Install Light (TinyTeX, ~100 MB, adds packages on demand) or Full (TeX Live, ~5 GB, offline)? [l/f/N] ";

const CHOICES: Readonly<Record<string, TexInstallKind>> = { l: "tinytex", light: "tinytex", f: "texlive", full: "texlive" };

export function terminalTexSetupPrompt(ask: Ask | undefined): TexSetupPrompt {
  return {
    async chooseInstall() {
      if (!ask) { return undefined; }
      return CHOICES[(await ask(QUESTION))?.trim().toLowerCase() ?? ""];
    },

    async progress(title, run) {
      process.stderr.write(`${title}…`);
      const live = process.stderr.isTTY;
      if (!live) { process.stderr.write("\n"); }
      try {
        return await run((message) => { if (live && message) { process.stderr.write(`\r\x1b[K${title}… ${message}`); } });
      } finally {
        if (live) { process.stderr.write("\n"); }
      }
    },
  };
}

export type BuildContext = Pick<AppContext, "logger" | "paths">;

export interface BuildEnvironment {
  queue: Pick<ProjectBuildQueue, "cancelAll"> & { request(project: ReadyProject): ReturnType<ProjectBuildQueue["request"]> };
  /** @returns a function that stops watching */
  watchSources(folder: string, onChange: () => void): () => void;
  /** Resolves on Ctrl-C; called only by `--watch`, so a one-shot build keeps the default Ctrl-C. */
  interrupted(): Promise<void>;
}

/** The terminal's answer channel: absent when stdin or stderr is not a terminal, so questions are declined. */
export function processAsk(): Ask | undefined {
  return process.stdin.isTTY && process.stderr.isTTY ? (question) => withPrompt((ask) => ask(question)) : undefined;
}

const rejectTypst = (): Promise<never> => Promise.reject(new Error("Typst projects cannot be built from the terminal yet."));

export function terminalBuildEnvironment(ctx: BuildContext, tty: { ask: Ask | undefined }): BuildEnvironment {
  const data = createProjectData({
    fs: new NodeLibraryFileSystem(), path, logger: ctx.logger, deviceDirs: createDeviceLocalLayout(ctx.paths.root),
  });
  return {
    queue: new ProjectBuildQueue({
      logger: ctx.logger,
      prompt: terminalTexSetupPrompt(tty.ask),
      tex: createSharedTexProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger: ctx.logger, fetchImpl: fetch }),
      projects: data,
      typst: { get: rejectTypst },
    }),
    watchSources,
    interrupted: () => new Promise((resolve) => { process.once("SIGINT", () => resolve()); }),
  };
}
