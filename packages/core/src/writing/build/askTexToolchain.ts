// Asks the host's user how to set up TeX; core decides when to ask and the host decides the wording.
import type { TexInstallKind } from "../../latex/toolchain/index.js";

// The managed TeX install cannot be cancelled once it starts, so progress carries no abort signal.
export interface TexSetupAsk {
  /** Asks which LaTeX to install when none is found; undefined declines. */
  chooseInstall(): Promise<TexInstallKind | undefined>;
  /** Runs long TeX work (an install, a package) with visible progress. */
  progress<T>(title: string, run: (report: (message: string) => void) => Promise<T>): Promise<T>;
}
