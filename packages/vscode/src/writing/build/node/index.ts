/** Exports the Node side of the build: the LaTeX build registration, the toolchain setup it needs and the core build deps. */
export { registerLatexBuild } from "./registerLatexBuild.js";
export { ensureToolchain } from "./ensureToolchain.js";
export { projectBuildDeps, type ProjectBuildDepsSource } from "./projectBuildDeps.js";
export { sessionLogger } from "./sessionLogger.js";
export { createVscodeTex } from "./sharedTex.js";
