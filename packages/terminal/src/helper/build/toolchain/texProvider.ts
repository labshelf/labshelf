// Declares how the build handler finds a TeX installation and, in later providers, fills in a missing package.
import type { LatexToolchain } from "@labshelf/core";
import type { HelperEngine } from "@labshelf/core/helper";

export interface TexProvider {
  /** The latexmk of `engine`, or "missing" when no TeX installation is found. */
  resolve(engine: HelperEngine): Promise<LatexToolchain | "missing">;
  /** Installs the TeX package that provides `fileName`; false when nothing was installed. */
  installMissing(fileName: string): Promise<boolean>;
}
