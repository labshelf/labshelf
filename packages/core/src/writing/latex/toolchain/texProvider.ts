// Declares how a build finds a TeX installation and fills in a missing package.
import type { LatexEngine } from "../../project/index.js";
import type { LatexToolchain } from "./latexToolchain.js";

export interface TexProvider {
  /** The latexmk of `engine`, or "missing" when no TeX installation is found. */
  resolve(engine: LatexEngine): Promise<LatexToolchain | "missing">;
  /** Installs the TeX package that provides `fileName`; false when nothing was installed. */
  installMissing(fileName: string): Promise<boolean>;
}
