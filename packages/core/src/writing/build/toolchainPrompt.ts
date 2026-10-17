// Asks the host's user about the LaTeX toolchain; core decides when to ask and the host decides the wording.
import type { LatexEngine } from "../project/index.js";
import type { TectonicAsset } from "../latex/toolchain/index.js";

export interface ToolchainPrompt {
  /** The first-run pick; undefined when the user dismisses it. `tectonic` is undefined on a system Tectonic does not support. */
  pickEngine(options: { texLiveInstalled: boolean; tectonic: TectonicAsset | undefined }): Promise<LatexEngine | undefined>;
  /** Whether to download the pinned Tectonic release. */
  confirmTectonicDownload(asset: TectonicAsset): Promise<boolean>;
  /** Shows the download's progress; aborting the signal cancels it and counts as declined. */
  downloading<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** TeX Live is missing for `engine`; true switches the project to Tectonic. */
  offerTectonic(engine: Exclude<LatexEngine, "tectonic">): Promise<boolean>;
}
