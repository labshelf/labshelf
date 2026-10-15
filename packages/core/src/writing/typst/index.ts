/** Exports the runtime-neutral side of Typst: the pinned compiler and fonts, compiling to PDF and its problems.
 * It is the `@labshelf/core/typst` entry, kept out of the root barrel so typst.ts stays out of every bundle that does not compile Typst. */
export { TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION } from "./typstRelease.js";
export type { TypstFontFile } from "./typstRelease.js";
export { typstProblems } from "./typstProblems.js";
export type { TypstDiagnostic } from "./typstProblems.js";
export { openTypstSession, TypstSession } from "./typstSession.js";
export type {
  TypstCompileRequest, TypstCompileResult, TypstFileAccess, TypstPackageResolver, TypstPackageSpec, TypstSessionOptions,
} from "./typstSession.js";
