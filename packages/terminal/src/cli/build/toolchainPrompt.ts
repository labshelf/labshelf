// Asks how to install LaTeX on the terminal and shows install progress on stderr; without a terminal to answer on, the question is declined.
import type { TexInstallKind, TexSetupPrompt } from "@labshelf/core";

import { withPrompt } from "../setup/index.js";

/** Resolves to the typed answer, or undefined when input ends. */
export type Ask = Parameters<Parameters<typeof withPrompt>[0]>[0];

const QUESTION = "LaTeX is not installed. Install Light (TinyTeX, ~100 MB, adds packages on demand) or Full (TeX Live, ~5 GB, offline)? [l/f/N] ";

const CHOICES: Readonly<Record<string, TexInstallKind>> = { l: "tinytex", light: "tinytex", f: "texlive", full: "texlive" };

export function terminalTexSetupPrompt(ask: Ask | undefined): TexSetupPrompt {
  return {
    async chooseInstall() {
      if (!ask) { return undefined; }
      return CHOICES[(await ask(QUESTION))?.trim().toLowerCase() ?? ""];
    },

    async progress(title, run) {
      process.stderr.write(`${title}…`);
      const live = process.stderr.isTTY;
      if (!live) { process.stderr.write("\n"); }
      try {
        return await run((message) => { if (live && message) { process.stderr.write(`\r\x1b[K${title}… ${message}`); } });
      } finally {
        if (live) { process.stderr.write("\n"); }
      }
    },
  };
}
