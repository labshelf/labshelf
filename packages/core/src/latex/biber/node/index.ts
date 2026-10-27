/** Exports the Node side of biber: reading its WASM assets from a folder and running it for latexmk.
 * The helper imports it directly so managed TeX stays out of its bundle; latex/node re-exports it for every other Node user. */
export { findBiberAssetsInFolder, runBiber } from "./biber.js";
