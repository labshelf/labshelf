// Builds a mirrored project over a temp folder with a fake latexmk, and collects the frames the build handlers send.
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ILogger } from "../../../../../src/ports/index.js";
import type { ToPageMessage } from "../../../../../src/writing/helper/index.js";

import { createBuildHandlers } from "../../../../../src/writing/helper/node/build/index";
import { createHelperProjects, type HelperProjects } from "../../../../../src/writing/helper/node/projects/index";
import type { ManagedTexProvider } from "../../../../../src/writing/latex/toolchain/node/managed/index";

// Writes main.log and main.pdf into -outdir= by the `%FAKE:<mode>` line of the main file, and records its arguments.
// An ok build writes one real PDF page per `\newpage`-separated chunk of the main file, so a page's content follows its text.
const FAKE_LATEXMK = `#!${process.execPath}
const fs = require("fs"), path = require("path");
const { PDFDocument } = require(${JSON.stringify(require.resolve("pdf-lib"))});
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("-outdir=")).slice("-outdir=".length);
const main = args[args.length - 1];
const base = path.basename(main, path.extname(main));
const mode = (/%FAKE:(\\w+)/.exec(fs.readFileSync(main, "utf8")) || [])[1] || "ok";
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(out, "runs.jsonl"), JSON.stringify(args) + "\\n");
const log = (text) => fs.writeFileSync(path.join(out, base + ".log"), "This is pdfTeX\\n" + text);
async function writePdf() {
  const chunks = fs.readFileSync(main, "utf8").replace(/^%FAKE.*$/m, "").split("\\\\newpage");
  const pdf = await PDFDocument.create();
  for (const chunk of chunks) pdf.addPage().drawText(chunk.replace(/\\s+/g, " ").trim() || "empty", { x: 20, y: 700, size: 12 });
  fs.writeFileSync(path.join(out, base + ".pdf"), await pdf.save());
  log("Output written on " + base + ".pdf\\n");
}
if (mode === "ok") {
  writePdf();
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

// Stands for `tinymist compile --root . <main> <out>`: the `//FAKE:<mode>` line of the main file picks ok, warn or fail.
const FAKE_TINYMIST = `#!${process.execPath}
const fs = require("fs");
const { PDFDocument } = require(${JSON.stringify(require.resolve("pdf-lib"))});
const [, , , main, out] = process.argv.slice(2);
const mode = (/\\/\\/FAKE:(\\w+)/.exec(fs.readFileSync(main, "utf8")) || [])[1] || "ok";
fs.appendFileSync(out + ".runs", JSON.stringify(process.argv.slice(2)) + "\\n");
if (mode === "fail") {
  process.stderr.write("error: unknown variable: x\\n  ┌─ " + main + ":3:2\\n  │\\n3 │ #x\\n  │  ^\\n");
  process.exitCode = 1;
} else {
  if (mode === "warn") process.stderr.write("warning: unused import\\n  ┌─ " + main + ":1:9\\n");
  PDFDocument.create().then(async (pdf) => { pdf.addPage().drawText("typst", { x: 20, y: 700, size: 12 }); fs.writeFileSync(out, await pdf.save()); });
}
`;

export interface BuildHarness {
  root: string;
  texDir: string;
  buildDir: string;
  tex: { resolve: jest.Mock; installMissing: jest.Mock };
  logger: { log: jest.Mock; error: jest.Mock };
  tinymist: { resolve: jest.Mock; ensure: jest.Mock };
  servers: { start: jest.Mock };
  handlers: ReturnType<typeof createBuildHandlers>;
  projects: HelperProjects;
  sent: ToPageMessage[];
  /** The payload a `pages` message carried. */
  payloadOf(message: ToPageMessage): Uint8Array | undefined;
  /** Sets the unsaved text of main.tex: the fake latexmk's mode line, then the chunks, one PDF page each. */
  project(mode: "ok" | "missing" | "minted" | "hang", ...pages: string[]): Promise<void>;
  /** Sets the unsaved text of main.typ; its `//FAKE:` line makes the fake Tinymist succeed, warn or fail. */
  typst(mode: "ok" | "warn" | "fail"): Promise<void>;
  compile(id: string, extra?: Record<string, unknown>): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Resolves once the request `id` has ended: `built` without a success, `pages`, or an `error`. */
  finished(id: string): Promise<ToPageMessage[]>;
  cleanup(): Promise<void>;
}

const PROJECT = "thesis";

function isDone(frames: ToPageMessage[]): boolean {
  if (frames.some((f) => f.type === "error" || f.type === "pages")) { return true; }
  const built = frames.find((f) => f.type === "built");
  return built?.type === "built" && built.status !== "succeeded";
}

export async function createBuildHarness(): Promise<BuildHarness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "labshelf-build-")));
  const dataDir = join(root, "data");
  const library = join(root, "library");
  const texDir = join(root, "tex", "bin");
  await mkdir(texDir, { recursive: true });
  await mkdir(join(library, "writing", PROJECT), { recursive: true });
  await writeFile(join(texDir, "latexmk"), FAKE_LATEXMK);
  await chmod(join(texDir, "latexmk"), 0o755);
  const tex = {
    resolve: jest.fn(async (engine: string) => ({ engine, executable: join(texDir, "latexmk") })),
    installMissing: jest.fn(async () => true),
    install: jest.fn(), status: jest.fn(), installAllPackages: jest.fn(),
  };
  const tinymistPath = join(root, "tinymist");
  await writeFile(tinymistPath, FAKE_TINYMIST);
  await chmod(tinymistPath, 0o755);
  const tinymist = { resolve: jest.fn(async () => tinymistPath), ensure: jest.fn(async () => tinymistPath) };
  const servers = { start: jest.fn(async () => undefined) };
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const projects = createHelperProjects({ libraryRoot: library, logger: logger as unknown as ILogger });
  await projects.open(PROJECT, `writing/${PROJECT}`);
  const handlers = createBuildHandlers({ dataDir, projects, tex: tex as unknown as ManagedTexProvider, tinymist, servers, logger: logger as unknown as ILogger });
  const sent: ToPageMessage[] = [];
  const payloads = new Map<ToPageMessage, Uint8Array>();
  const waiters: Array<() => void> = [];
  const push = (frame: ToPageMessage, payload?: Uint8Array): void => {
    sent.push(frame);
    if (payload) { payloads.set(frame, payload); }
    waiters.splice(0).forEach((wake) => wake());
  };
  let version = 0;
  return {
    root, texDir, buildDir: join(dataDir, "projects", PROJECT, "build"), tex, tinymist, servers, logger, handlers, projects, sent,
    payloadOf: (message) => payloads.get(message),
    async project(mode, ...pages) {
      const text = `%FAKE:${mode}\n${(pages.length > 0 ? pages : ["page"]).join("\n\\newpage\n")}\n`;
      version += 1;
      await projects.edit(PROJECT, "main.tex", version, { text });
    },
    async typst(mode) {
      version += 1;
      await projects.edit(PROJECT, "main.typ", version, { text: `//FAKE:${mode}\n= Title\n` });
    },
    compile: (id, extra = {}) => handlers.compile({ v: 2, id, type: "compile", projectId: PROJECT, main: "main.tex", mode: "full", engine: "pdflatex", ...extra }, push),
    cancel: (id) => handlers.cancel({ v: 2, id, type: "cancel", projectId: PROJECT }, push),
    finished: (id) => new Promise((resolve) => {
      const check = (): void => {
        const frames = sent.filter((f) => f.id === id);
        if (isDone(frames)) { resolve(frames); } else { waiters.push(check); }
      };
      check();
    }),
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
