// Answers the compiled deck's Style panel: compiles a build copy of the deck in a candidate style outside the user's folder
// (Typst in memory, LaTeX in a cache folder under the project's build dir) and gives its PDF, cached by the panel's key.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger, LatexBuildResult, LatexToolchain, TexProvider } from "@labshelf/core";
import { runLatexBuild, type LatexBuildRequest, type ProjectBuildDeps } from "@labshelf/core/node";
import type { TypstBuildResult } from "@labshelf/core/typst";
import { runTypstBuild, type TypstBuildRequest } from "@labshelf/core/typst/node";
import type { ReadyProject } from "../projects/index.js";

const MODULE = "writing/deckStylePreview";
const FOLDER = "style-preview";
const KEPT_PDFS = 16;
/** Keys are the panel's short hashes; anything else would reach a file name. */
const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** The compilers the preview runs; the core builds by default, fakes in tests. */
export interface StylePreviewCompilers {
  typst(request: TypstBuildRequest): Promise<TypstBuildResult>;
  latex(request: LatexBuildRequest): Promise<LatexBuildResult>;
}

export interface StylePreviewServices {
  logger: ILogger;
  /** The project's build folder, as the builds use it. */
  buildDir(projectId: string): string;
  /** Finds the TeX of an engine; it never asks to install one. */
  tex: Pick<TexProvider, "resolve">;
  typst: ProjectBuildDeps["typst"];
  compilers?: StylePreviewCompilers;
}

export interface StylePreviewRequest {
  project: ReadyProject;
  /** The deck file, relative to the project folder with "/" separators. */
  root: string;
  /** What requests for one file supersede each other by. */
  path: string;
  text: string;
  key: string;
}

/** Gives the PDF bytes (base64) of the build copy, or undefined when it could not be built or a newer request replaced it. */
export type StylePreviewHandler = (request: StylePreviewRequest) => Promise<string | undefined>;

const exists = (file: string): Promise<boolean> => fs.stat(file).then(() => true, () => false);

async function readCached(file: string): Promise<string | undefined> {
  const bytes = await fs.readFile(file).catch(() => undefined);
  if (!bytes) { return undefined; }
  const now = new Date();
  await fs.utimes(file, now, now).catch(() => undefined);
  return bytes.toString("base64");
}

/** Deletes the oldest cached PDFs beyond the kept few. */
async function prune(dir: string): Promise<void> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".pdf"));
  const aged = await Promise.all(names.map(async (name) => ({ name, time: (await fs.stat(path.join(dir, name)).catch(() => undefined))?.mtimeMs ?? 0 })));
  const extra = aged.sort((a, b) => b.time - a.time).slice(KEPT_PDFS);
  await Promise.all(extra.map(({ name }) => fs.rm(path.join(dir, name), { force: true })));
}

/** TEXINPUTS with the main file's folder searched recursively first; the trailing delimiter keeps TeX's own search paths. */
function texInputsFor(folder: string, current: string | undefined): string {
  return `${folder}//${path.delimiter}${current ?? ""}`;
}

/** Compiles a Typst preview straight to the cache file; whether it succeeded. */
async function compileTypst(services: StylePreviewServices, compilers: StylePreviewCompilers, request: StylePreviewRequest, cache: string): Promise<boolean> {
  const { session, packages } = await services.typst.get(services.logger);
  const main = path.join(request.project.folder, request.root);
  const result = await compilers.typst({
    session, packages, projectFolder: request.project.folder, main: request.root, logger: services.logger,
    sources: new Map([[main, request.text]]), outputs: [cache],
  });
  return result.status === "succeeded";
}

/** Compiles a LaTeX preview in a scratch folder and moves its PDF to the cache file; whether it succeeded. */
async function compileLatex(services: StylePreviewServices, compilers: StylePreviewCompilers, request: StylePreviewRequest, dir: string, cache: string): Promise<boolean> {
  const { project, root } = request;
  const toolchain: LatexToolchain | "missing" = await services.tex.resolve(project.settings.engine ?? "pdflatex");
  if (toolchain === "missing") { return false; }
  const work = path.join(dir, request.key);
  const name = path.basename(root);
  try {
    await fs.mkdir(work, { recursive: true });
    await fs.writeFile(path.join(work, name), request.text);
    const inputs = texInputsFor(path.dirname(path.join(project.folder, root)), process.env["TEXINPUTS"]);
    const result = await compilers.latex({
      toolchain, projectFolder: work, main: name, outDir: work, signal: new AbortController().signal, logger: services.logger, env: { TEXINPUTS: inputs },
    });
    if (result.status !== "succeeded") { return false; }
    await fs.rename(result.pdf, cache);
    return true;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The handler of one extension: requests run one at a time, and a queued request is dropped when a newer one for the same file is queued. */
export function createStylePreviewHandler(services: StylePreviewServices): StylePreviewHandler {
  const compilers: StylePreviewCompilers = services.compilers ?? { typst: runTypstBuild, latex: runLatexBuild };
  const latest = new Map<string, number>();
  let counter = 0;
  let chain: Promise<unknown> = Promise.resolve();

  async function compile(request: StylePreviewRequest): Promise<string | undefined> {
    const dir = path.join(services.buildDir(request.project.settings.id), FOLDER);
    const cache = path.join(dir, `${request.key}.pdf`);
    const cached = await readCached(cache);
    if (cached !== undefined) { return cached; }
    try {
      await fs.mkdir(dir, { recursive: true });
      const built = request.project.settings.format === "typst" ? await compileTypst(services, compilers, request, cache) : await compileLatex(services, compilers, request, dir, cache);
      if (!built || !await exists(cache)) { return undefined; }
      await prune(dir);
      return await readCached(cache);
    } catch (error) {
      await services.logger.error(MODULE, error, { root: request.root, format: request.project.settings.format });
      return undefined;
    }
  }

  return async (request) => {
    if (!KEY.test(request.key)) { return undefined; }
    const dir = path.join(services.buildDir(request.project.settings.id), FOLDER);
    const cached = await readCached(path.join(dir, `${request.key}.pdf`));
    if (cached !== undefined) { return cached; }
    const id = ++counter;
    latest.set(request.path, id);
    const run = chain.then(async () => (latest.get(request.path) === id ? await compile(request) : undefined));
    chain = run.catch(() => undefined);
    try { return await run; } finally { if (latest.get(request.path) === id) { latest.delete(request.path); } }
  };
}
