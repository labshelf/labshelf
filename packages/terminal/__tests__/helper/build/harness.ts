// Builds a mirrored project over a temp folder with a fake latexmk, and collects the frames the build handlers send.
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ILogger } from "@labshelf/core";
import type { ToHelperMessage, ToPageMessage } from "@labshelf/core/helper";

import { createBuildHandlers, type TexProvider } from "../../../src/helper/build/index";

// Writes main.log and main.pdf into -outdir= by the `%FAKE:<mode>` line of the main file, and records its arguments.
const FAKE_LATEXMK = `#!${process.execPath}
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("-outdir=")).slice("-outdir=".length);
const main = args[args.length - 1];
const base = path.basename(main, path.extname(main));
const mode = (/%FAKE:(\\w+)/.exec(fs.readFileSync(main, "utf8")) || [])[1] || "ok";
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(out, "runs.jsonl"), JSON.stringify(args) + "\\n");
const log = (text) => fs.writeFileSync(path.join(out, base + ".log"), "This is pdfTeX\\n" + text);
if (mode === "ok") {
  const pdf = Buffer.alloc(1300 * 1024);
  for (let i = 0; i < pdf.length; i++) pdf[i] = (i * 31 + 7) % 251;
  fs.writeFileSync(path.join(out, base + ".pdf"), pdf);
  log("Output written on " + base + ".pdf\\n");
} else if (mode === "missing") {
  log("! LaTeX Error: File \`foo.sty' not found.\\n\\nType X to quit or <RETURN> to proceed,\\nor enter new name. (Default extension: sty)\\n\\nl.3 \\\\usepackage{foo}\\n");
  process.exitCode = 12;
} else if (mode === "minted") {
  log("! Package minted Error: You must invoke LaTeX with the -shell-escape flag.\\n\\nSee the minted package documentation for explanation.\\n\\nl.4 \\\\begin{document}\\n");
  process.exitCode = 12;
} else if (mode === "hang") {
  fs.writeFileSync(path.join(out, "started"), "");
  setInterval(() => {}, 1000);
}
`;

export interface BuildHarness {
  root: string;
  texDir: string;
  srcDir: string;
  buildDir: string;
  tex: { resolve: jest.Mock; installMissing: jest.Mock };
  logger: { log: jest.Mock; error: jest.Mock };
  handlers: ReturnType<typeof createBuildHandlers>;
  sent: ToPageMessage[];
  /** Writes the project's main file with the fake latexmk's mode. */
  project(mode: "ok" | "missing" | "minted" | "hang"): Promise<void>;
  send(type: "build" | "cancel", id: string, extra?: Record<string, unknown>): Promise<void>;
  /** Resolves once the build `id` has sent `built` and, when it succeeded, its last `pdf` chunk. */
  finished(id: string): Promise<ToPageMessage[]>;
  cleanup(): Promise<void>;
}

const PROJECT = "thesis";

function isDone(frames: ToPageMessage[]): boolean {
  const built = frames.find((f) => f.type === "built");
  if (built?.type !== "built") { return false; }
  if (built.status !== "succeeded") { return true; }
  const last = frames.at(-1);
  return last?.type === "pdf" && last.chunk.index === last.chunk.count - 1;
}

export async function createBuildHarness(): Promise<BuildHarness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "labshelf-build-")));
  const projectsRoot = join(root, "projects");
  const texDir = join(root, "tex", "bin");
  const srcDir = join(projectsRoot, PROJECT, "src");
  await mkdir(texDir, { recursive: true });
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(texDir, "latexmk"), FAKE_LATEXMK);
  await chmod(join(texDir, "latexmk"), 0o755);
  const tex = {
    resolve: jest.fn(async (engine: string) => ({ engine, executable: join(texDir, "latexmk") })),
    installMissing: jest.fn(async () => true),
  };
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const handlers = createBuildHandlers({
    projectsRoot, sourceDir: () => srcDir, tex: tex as unknown as TexProvider, logger: logger as unknown as ILogger,
  });
  const sent: ToPageMessage[] = [];
  const waiters: Array<() => void> = [];
  const push = (frame: ToPageMessage): void => { sent.push(frame); waiters.splice(0).forEach((wake) => wake()); };
  const savedPath = process.env["PATH"];
  return {
    root, texDir, srcDir, buildDir: join(projectsRoot, PROJECT, "build"), tex, logger, handlers, sent,
    project: (mode) => writeFile(join(srcDir, "main.tex"), `%FAKE:${mode}\n\\documentclass{article}\n`),
    send: (type, id, extra = {}) => handlers[type](
      { v: 1, id, type, projectId: PROJECT, ...(type === "build" && { main: "main.tex", engine: "pdflatex" }), ...extra } as ToHelperMessage,
      push,
    ),
    finished: (id) => new Promise((resolve) => {
      const check = (): void => {
        const frames = sent.filter((f) => f.id === id);
        if (isDone(frames)) { resolve(frames); } else { waiters.push(check); }
      };
      check();
    }),
    async cleanup() {
      process.env["PATH"] = savedPath;
      await rm(root, { recursive: true, force: true });
    },
  };
}
