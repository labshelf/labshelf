// Asks the toolchain questions of a build on the terminal; without a terminal to answer on, every question is declined.
import { engineLabel, TECTONIC_VERSION, type LatexEngine, type TectonicAsset, type ToolchainPrompt } from "@labshelf/core";

import { withPrompt } from "../setup/index.js";

/** Resolves to the typed answer, or undefined when input ends. */
export type Ask = Parameters<Parameters<typeof withPrompt>[0]>[0];

const yes = (answer: string | undefined) => /^y(es)?$/i.test(answer ?? "");

export function terminalToolchainPrompt(ask: Ask | undefined): ToolchainPrompt {
  return {
    async pickEngine({ texLiveInstalled, tectonic }) {
      if (!ask) { return undefined; }
      const options: Array<{ engine: LatexEngine; text: string }> = [
        ...(tectonic ? [{ engine: "tectonic" as const, text: `${engineLabel("tectonic")} (downloads about ${tectonic.sizeMb} MB once)` }] : []),
        { engine: "pdflatex", text: `TeX Live (latexmk)${texLiveInstalled ? "" : ", not installed"}` },
      ];
      const list = options.map((option, index) => `  ${index + 1}) ${option.text}`).join("\n");
      const answer = await ask(`How should LabShelf build LaTeX projects?\n${list}\nChoose 1-${options.length}: `);
      return options[Number(answer) - 1]?.engine;
    },

    async confirmTectonicDownload(asset: TectonicAsset) {
      if (!ask) { return false; }
      return yes(await ask(`Download Tectonic ${TECTONIC_VERSION} (about ${asset.sizeMb} MB) from github.com/tectonic-typesetting/tectonic? [y/N] `));
    },

    // A terminal has no cancel button, so the download runs to its end or to Ctrl-C.
    downloading: (run) => run(new AbortController().signal),

    async offerTectonic(engine) {
      if (!ask) { return false; }
      return yes(await ask(`${engineLabel(engine)} needs TeX Live, which is not installed. Use Tectonic instead (it runs only XeLaTeX)? [y/N] `));
    },
  };
}
