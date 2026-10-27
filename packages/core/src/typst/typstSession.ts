/** Compiles Typst documents to PDF with the WASM compiler, one compile at a time, reading files through an injected access port. */
import { createTypstCompiler, initOptions, loadFonts, type TypstCompiler } from "@myriaddreamin/typst.ts";

import { createCitationProbeSource, PROBE_FILE, PROBE_LABEL, readProbeAnswer, type TypstCitations } from "./typstCitationProbe.js";
import type { TypstCompilerProblem } from "./deriveTypstProblems.js";
import { formatError } from "../errors/index.js";

/** Synchronous file access: the compiler asks for files in the middle of a compile and cannot await. Paths are compiler paths. */
export interface TypstFileAccess {
  getMTime(path: string): Date | undefined;
  isFile(path: string): boolean | undefined;
  getRealPath(path: string): string | undefined;
  readAll(path: string): Uint8Array | undefined;
}

export interface TypstPackageSpec {
  namespace: string;
  name: string;
  version: string;
}

export interface TypstPackageResolver {
  /** The compiler path of the package's folder, or `undefined` when it is not available yet. Synchronous, like file access. */
  resolve(spec: TypstPackageSpec): string | undefined;
}

export interface TypstSessionOptions {
  /** The bytes of `typst_ts_web_compiler_bg.wasm`. */
  wasm: Uint8Array;
  fonts: readonly Uint8Array[];
  files: TypstFileAccess;
  packages: TypstPackageResolver;
}

export interface TypstCompileRequest {
  /** The project root and the main file, as compiler paths. */
  root: string;
  main: string;
  /** Unsaved text by compiler path; it shadows the files on disk for this compile only. */
  sources: ReadonlyMap<string, string>;
}

export interface TypstCompileResult {
  pdf?: Uint8Array;
  diagnostics: TypstCompilerProblem[];
  /** Where each citation of the PDF landed; present with `pdf`. */
  citations?: TypstCitations;
}

export class TypstSession {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly compiler: TypstCompiler) {}

  /** Compiles after every earlier request has finished; the compiler holds one set of shadowed sources at a time. */
  compile(request: TypstCompileRequest): Promise<TypstCompileResult> {
    const run = this.queue.then(() => this.compileNow(request));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async compileNow(request: TypstCompileRequest): Promise<TypstCompileResult> {
    this.compiler.resetShadow();
    for (const [path, text] of request.sources) { this.compiler.addSource(path, text); }
    const result = await this.compiler.compile({ root: request.root, mainFilePath: request.main, format: 1, diagnostics: "full" });
    const diagnostics = (result.diagnostics ?? []) as TypstCompilerProblem[];
    if (!result.result) { return { diagnostics }; }
    return { pdf: result.result, diagnostics, citations: await this.citations(request) };
  }

  // A second compile through a probe file, so the PDF itself never carries the probe's metadata; Typst reuses the main's layout.
  private async citations(request: TypstCompileRequest): Promise<TypstCitations> {
    const root = request.root.endsWith("/") ? request.root.slice(0, -1) : request.root;
    if (!request.main.startsWith(`${root}/`)) { return { failure: `The main file ${request.main} is outside the root ${request.root}.` }; }
    const probe = `${root}/${PROBE_FILE}`;
    this.compiler.addSource(probe, createCitationProbeSource(request.main.slice(root.length)));
    try {
      return await this.compiler.runWithWorld({ mainFilePath: probe, root: request.root }, async (world) => {
        const compiled = await world.compile({ diagnostics: "full" });
        if (compiled.hasError) { return { failure: `The citation probe did not compile: ${JSON.stringify(compiled.diagnostics)?.slice(0, 300)}` }; }
        return readProbeAnswer(await world.query({ selector: `<${PROBE_LABEL}>`, field: "value" }));
      });
    } catch (error) {
      return { failure: formatError(error) };
    }
  }
}

export async function openTypstSession(options: TypstSessionOptions): Promise<TypstSession> {
  const compiler = createTypstCompiler();
  await compiler.init({
    getModule: () => options.wasm,
    beforeBuild: [
      loadFonts([...options.fonts], { assets: false }),
      initOptions.withAccessModel(options.files),
      initOptions.withPackageRegistry({ resolve: (spec: TypstPackageSpec) => options.packages.resolve(spec) }),
    ],
  });
  return new TypstSession(compiler);
}
