/** Exports the runtime-neutral side of Typst: the pinned compiler and fonts, compiling to PDF, its problems and where its citations land.
 * It is the `@labshelf/core/typst` entry, kept out of the root barrel so typst.ts stays out of every bundle that does not compile Typst. */
export { TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION } from "./typstRelease.js";
export type { TypstFontFile } from "./typstRelease.js";
export type { TypstBuildResult } from "./typstBuildResult.js";
export type { TypstCitations } from "./typstCitationProbe.js";
export { deriveTypstProblems } from "./deriveTypstProblems.js";
export type { TypstCompilerProblem } from "./deriveTypstProblems.js";
export { openTypstSession, TypstSession } from "./typstSession.js";
export type {
  TypstCompileRequest, TypstCompileResult, TypstFileAccess, TypstPackageResolver, TypstPackageSpec, TypstSessionOptions,
} from "./typstSession.js";
export { scanTypstHeadings } from "./language/syntax/index.js";
export type { TypstHeading } from "./language/syntax/index.js";
