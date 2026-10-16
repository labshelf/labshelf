// Reports which template build engines this machine can run without installing or downloading anything.
import { tectonicAsset, type AvailableEngines, type TemplateEngine } from "@labshelf/core";
import { findExecutable } from "@labshelf/core/node";
import { TYPST_VERSION } from "@labshelf/core/typst";

const TEX_LIVE_ENGINES: readonly TemplateEngine[] = ["pdflatex", "lualatex", "xelatex"];

export async function detectEngines(): Promise<AvailableEngines> {
  const engines = new Set<TemplateEngine>(["typst"]);
  if (tectonicAsset(process.platform, process.arch)) { engines.add("tectonic"); }
  if (await findExecutable("latexmk")) {
    for (const engine of TEX_LIVE_ENGINES) {
      if (await findExecutable(engine)) { engines.add(engine); }
    }
  }
  return { engines, typstVersion: TYPST_VERSION };
}
