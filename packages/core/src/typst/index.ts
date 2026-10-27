/** Exports the runtime-neutral side of Typst: the pinned compiler and fonts, compiling to PDF, its problems and where its citations land, plus the headings scan from the language module.
 * It is the `@labshelf/core/typst` entry, kept out of the root barrel so typst.ts stays out of every bundle that does not compile Typst. */
export { deriveTypstProblems, openTypstSession, TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION, TypstSession } from "./typst.js";
export type {
  TypstBuildResult, TypstCitations, TypstCompileRequest, TypstCompileResult, TypstCompilerProblem, TypstFileAccess, TypstFontFile,
  TypstPackageResolver, TypstPackageSpec, TypstSessionOptions,
} from "./typst.js";
export { scanTypstHeadings } from "./language/index.js";
export type { TypstHeading } from "./language/index.js";
