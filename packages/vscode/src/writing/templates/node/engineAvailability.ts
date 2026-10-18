// Reports which template build engines this machine can run without installing or downloading anything.
import { LATEX_ENGINES, type AvailableEngines, type TemplateEngine } from "@labshelf/core";
import type { ToolchainDeps } from "@labshelf/core/node";
import { TYPST_VERSION } from "@labshelf/core/typst";

export async function detectEngines(tex: ToolchainDeps["tex"]): Promise<AvailableEngines> {
  const engines = new Set<TemplateEngine>(["typst"]);
  for (const engine of LATEX_ENGINES) {
    if (await tex.resolve(engine) !== "missing") { engines.add(engine); }
  }
  return { engines, typstVersion: TYPST_VERSION };
}
