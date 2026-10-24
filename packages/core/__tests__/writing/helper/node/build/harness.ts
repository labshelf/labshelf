// Builds a mirrored project over a temp folder with a fake latexmk or the real Typst compiler, and collects the frames the build handlers send.
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ILogger } from "../../../../../src/ports/index.js";
import { PROTOCOL_VERSION, type ToPageMessage } from "../../../../../src/writing/helper/index.js";

import { createBuildHandlers } from "../../../../../src/writing/helper/node/build/index";
import { createHelperProjects, type HelperProjects } from "../../../../../src/writing/helper/node/projects/index";
import type { ManagedTexProvider } from "../../../../../src/latex/toolchain/node/managedTex/index";
import { TypstPackageStore } from "../../../../../src/writing/typst/node/index";
import type { TypstSession } from "../../../../../src/writing/typst/index";
import { openTestSession, TYPST_TEST_FONT_SETTING } from "../../../../support/typstFixtures";

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

export interface BuildHarness {
  root: string;
  texDir: string;
  buildDir: string;
  tex: { resolve: jest.Mock; installMissing: jest.Mock };
  logger: { log: jest.Mock; error: jest.Mock };
  /** Opens the real Typst compiler once per harness; tests may replace it. */
  typst: { get: jest.Mock };
  /** The font-download wrapper the handlers gave the Typst compiler. */
  withFontDownload<T>(run: () => Promise<T>): Promise<T>;
  handlers: ReturnType<typeof createBuildHandlers>;
  projects: HelperProjects;
  sent: ToPageMessage[];
  /** The payload a `pages` message carried. */
  payloadOf(message: ToPageMessage): Uint8Array | undefined;
  /** Sets the unsaved text of main.tex: the fake latexmk's mode line, then the chunks, one PDF page each. */
  project(mode: "ok" | "missing" | "minted" | "hang", ...pages: string[]): Promise<void>;
  /** Sets the unsaved text of main.typ, after a line that picks the one font the test compiler has. */
  typstSource(body: string): Promise<void>;
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
  let session: Promise<TypstSession> | undefined;
  const packages = new TypstPackageStore({ data: join(dataDir, "typst-packages", "local"), cache: join(dataDir, "typst-packages", "cache") });
  const typst = { get: jest.fn(async () => ({ session: await (session ??= openTestSession(packages)), packages })) };
  let withFontDownload: BuildHarness["withFontDownload"] = () => Promise.reject(new Error("the handlers never opened the Typst compiler"));
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const projects = createHelperProjects({ libraryRoot: library, logger: logger as unknown as ILogger });
  await projects.open(PROJECT, `writing/${PROJECT}`);
  const handlers = createBuildHandlers({
    dataDir, projects, tex: tex as unknown as ManagedTexProvider, logger: logger as unknown as ILogger,
    openTypst: (wrap) => { withFontDownload = wrap; return typst; },
  });
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
    root, texDir, buildDir: join(dataDir, "projects", PROJECT, "build"), tex, typst, logger, handlers, projects, sent,
    withFontDownload: (run) => withFontDownload(run),
    payloadOf: (message) => payloads.get(message),
    async project(mode, ...pages) {
      const text = `%FAKE:${mode}\n${(pages.length > 0 ? pages : ["page"]).join("\n\\newpage\n")}\n`;
      version += 1;
      await projects.edit(PROJECT, "main.tex", version, { text });
    },
    async typstSource(body) {
      version += 1;
      await projects.edit(PROJECT, "main.typ", version, { text: `${TYPST_TEST_FONT_SETTING}${body}` });
    },
    compile: (id, extra = {}) => handlers.compile({ v: PROTOCOL_VERSION, id, type: "compile", projectId: PROJECT, main: "main.tex", mode: "full", engine: "pdflatex", ...extra }, push),
    cancel: (id) => handlers.cancel({ v: PROTOCOL_VERSION, id, type: "cancel", projectId: PROJECT }, push),
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
