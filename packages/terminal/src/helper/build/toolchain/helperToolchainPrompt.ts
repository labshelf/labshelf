// Answers core's toolchain questions without a user: the engine comes from the page and Tectonic is never used.
import type { ToolchainPrompt } from "@labshelf/core";
import type { HelperEngine } from "@labshelf/core/helper";

export function helperToolchainPrompt(engine: HelperEngine): ToolchainPrompt {
  return {
    pickEngine: () => Promise.resolve(engine),
    confirmTectonicDownload: () => Promise.resolve(false),
    downloading: () => Promise.reject(new Error("LabShelf Helper never downloads Tectonic.")),
    offerTectonic: () => Promise.resolve(false),
  };
}
