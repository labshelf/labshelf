/** Compiles Typst documents to PDF with the WASM compiler, one compile at a time, reading files through an injected access port. */
import { createTypstCompiler, initOptions, loadFonts, type TypstCompiler } from "@myriaddreamin/typst.ts";

import type { TypstDiagnostic } from "./typstProblems.js";

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
  diagnostics: TypstDiagnostic[];
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
    return { ...(result.result ? { pdf: result.result } : {}), diagnostics: (result.diagnostics ?? []) as TypstDiagnostic[] };
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
