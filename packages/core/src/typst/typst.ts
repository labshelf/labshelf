// Runtime-neutral Typst: the pinned compiler and fonts, the compile session, the citation probe, the build result and the compiler's problems.
import { createTypstCompiler, initOptions, loadFonts, type TypstCompiler } from "@myriaddreamin/typst.ts";

import { formatError } from "../errors/index.js";
import type { BuildProblem, LocatedProblem } from "../latex/index.js";
import type { TypstCitation } from "../writing/quotes/index.js";

// Pins the Typst compiler LabShelf ships and the default fonts it loads, so a document renders the same in every app.

// INVARIANT: the Typst inside @myriaddreamin/typst-ts-web-compiler 0.7.0; the two change together.
export const TYPST_VERSION = "0.14.2";

export const TYPST_FONT_BASE_URL = `https://raw.githubusercontent.com/typst/typst-assets/v${TYPST_VERSION}/files/fonts/`;

export interface TypstFontFile {
  file: string;
  sha256: string;
}

/** Typst's default text fonts: the ones the CLI embeds, which the WASM compiler does not. */
export const TYPST_FONTS: readonly TypstFontFile[] = [
  { file: "DejaVuSansMono-Bold.ttf", sha256: "bce60f1b4421acd9ea51ba6623d7024ecbe6817a953e3654df62a5e6bdf8f769" },
  { file: "DejaVuSansMono-BoldOblique.ttf", sha256: "91713a71d550bba22c2a6b2bb2a9ad8f9a159e12e4e9f0a5b2677998ba21213e" },
  { file: "DejaVuSansMono-Oblique.ttf", sha256: "742097840c541870e8d6dc5c9b37bb1ceeea6c0dedd1d475faf903ef9df734b0" },
  { file: "DejaVuSansMono.ttf", sha256: "b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582" },
  { file: "LibertinusSerif-Bold.otf", sha256: "0264914210ed51b3231ebc92ce529e9f2e166ba9eebf0cd4a579558690a27b64" },
  { file: "LibertinusSerif-BoldItalic.otf", sha256: "47a665259f09f554f5d133d7718cdad43ff462c6a6b2328f38023465e62d57ce" },
  { file: "LibertinusSerif-Italic.otf", sha256: "9a393d63d6e05f620d3dc0190dfd35a8ede58c0808cf0fc9de7fcb9c723e4c24" },
  { file: "LibertinusSerif-Regular.otf", sha256: "fcf06307a77367394fcb0ccb241e59eea70dba3d732be309647611224679c733" },
  { file: "LibertinusSerif-Semibold.otf", sha256: "a4b3f28e85881db34695c1f005e4c79233a6caf3a2bd286c9b418c025fb99308" },
  { file: "LibertinusSerif-SemiboldItalic.otf", sha256: "397f0d7aba35ae6a988948ae046c14c6b1e0d270fcc6e292b8bc29fd625c6101" },
  { file: "NewCM10-Bold.otf", sha256: "d86a61b9956e038b51d172f0030660caf404e1adf5a3d93266ef1790c37c1a99" },
  { file: "NewCM10-BoldItalic.otf", sha256: "ad0b8aa45ef116f5016d51aeb90aca2a7fa3640a14d3ef9c15b9e74d1a51a041" },
  { file: "NewCM10-Italic.otf", sha256: "ecc561ea03eb21f9623a7c99a6a17e371cf8eddc53039bc347380f40ce6c4d77" },
  { file: "NewCM10-Regular.otf", sha256: "79feac95755b8df2f0be45f55bdaf6c2b3b08f58b1f67518401cf235423e0b84" },
  { file: "NewCMMath-Bold.otf", sha256: "9cf39c5665ca73d4d5921628798126daa7eec4db3b83e0ca617c224d0c0ddd56" },
  { file: "NewCMMath-Book.otf", sha256: "765b14d6f8a8d3e9b319f168cc1b10dd89df38d34108e75b44013904bb173218" },
  { file: "NewCMMath-Regular.otf", sha256: "ad746f5307fed53d8e5d7d201f5054abe73f1f47c51040767d898e3481c6e648" },
];

// Writes the Typst source that reports where a document's citations land, and reads its answer.

/** Where a build's citations landed, or why that is not known. */
export type TypstCitations = { cites: TypstCitation[] } | { failure: string };

// TRAP: the compiler only shadows this path in memory; a project file with the same name would be hidden for the probe compile.
const PROBE_FILE = "__labshelf_citations__.typ";
const PROBE_LABEL = "labshelf-citations";

const typstString = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The probe includes the main file and appends invisible metadata, so the citations it reports sit where the main's own compile
 * puts them; `mainFromRoot` starts with `/`, which Typst resolves against the project root.
 */
function createCitationProbeSource(mainFromRoot: string): string {
  return [
    `#include ${typstString(mainFromRoot)}`,
    "#context [#metadata(query(cite).map(c => {",
    "  let at = c.location().position()",
    "  (key: str(c.key), page: at.page, x: at.x.pt(), y: at.y.pt())",
    `})) <${PROBE_LABEL}>]`,
    "",
  ].join("\n");
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function toCite(item: unknown): TypstCitation | undefined {
  if (typeof item !== "object" || item === null) { return undefined; }
  const { key, page, x, y } = item as Record<string, unknown>;
  if (typeof key !== "string" || !isFiniteNumber(page) || !Number.isInteger(page) || !isFiniteNumber(x) || !isFiniteNumber(y)) { return undefined; }
  return { key, at: { page, x, y } };
}

/** Reads the query result for the probe's label: one metadata value holding every citation. */
export function readProbeAnswer(answer: unknown): TypstCitations {
  if (!Array.isArray(answer) || answer.length !== 1 || !Array.isArray(answer[0])) {
    return { failure: `Unexpected citation query result: ${JSON.stringify(answer)?.slice(0, 200)}` };
  }
  const cites = (answer[0] as unknown[]).map(toCite);
  return cites.every((cite) => cite !== undefined)
    ? { cites: cites as TypstCitation[] }
    : { failure: "A citation in the query result has no key or position." };
}

// Describes the outcome of compiling a Typst project: the PDF and citation placements on success, the problems on failure.
export type TypstBuildResult =
  /** `cites` is empty when the citation probe failed; the failure is logged. */
  | { status: "succeeded"; pdf: string; problems: LocatedProblem[]; cites: TypstCitation[] }
  | { status: "failed"; problems: LocatedProblem[] };

// Turns the Typst compiler's diagnostics into build problems on project files.

/** A diagnostic as typst.ts reports it with `diagnostics: "full"`. */
export interface TypstCompilerProblem {
  /** `namespace/name:version` when the diagnostic is inside a package, else empty. */
  package: string;
  path: string;
  severity: string;
  /** `startLine:startColumn-endLine:endColumn`, zero-based; empty when the diagnostic has no span. */
  range: string;
  message: string;
}

function startLine(range: string): number | undefined {
  const match = /^(\d+):\d+/.exec(range);
  return match ? Number(match[1]) + 1 : undefined;
}

/** `resolvePath` maps a compiler path to a file path; a problem inside a package is placed on `mainFile`.
 * Hints are dropped: they are call traces ("import") that point at the line already shown with the error. */
export function deriveTypstProblems(
  diagnostics: readonly TypstCompilerProblem[],
  mainFile: string,
  resolvePath: (compilerPath: string) => string,
): (BuildProblem & { file: string })[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "warning").map((diagnostic) => {
    const severity = diagnostic.severity === "error" ? "error" : "warning";
    if (diagnostic.package !== "" || diagnostic.path === "") {
      const where = diagnostic.package === "" ? "" : ` (in package ${diagnostic.package})`;
      return { severity, message: `${diagnostic.message}${where}`, file: mainFile };
    }
    const line = startLine(diagnostic.range);
    return { severity, message: diagnostic.message, file: resolvePath(diagnostic.path), ...(line === undefined ? {} : { line }) };
  });
}

// Compiles Typst documents to PDF with the WASM compiler, one compile at a time, reading files through an injected access port.

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
