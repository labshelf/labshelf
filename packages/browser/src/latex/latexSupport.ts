// Combines LaTeX highlighting, completion and the \begin auto-close into one editor extension.
import { autocompletion } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { PaperRecord } from "@labshelf/core";
import { citationCompletion } from "./citationCompletion";
import { closeEnvironmentOnEnter } from "./environmentClose";
import type { ProjectLabel } from "./projectLabels";
import { latexCommandCompletion } from "./latexCommandCompletion";
import { referenceCompletion } from "./referenceCompletion";

export interface LatexSupportDeps {
  labels(): readonly ProjectLabel[];
  papers(): Promise<readonly PaperRecord[]>;
}

export function latexSupport(deps: LatexSupportDeps): Extension {
  return [
    StreamLanguage.define(stex),
    autocompletion({ override: [citationCompletion(deps.papers), referenceCompletion(deps.labels), latexCommandCompletion] }),
    // Runs before the default Enter, which would only insert the newline.
    Prec.high(keymap.of([{ key: "Enter", run: closeEnvironmentOnEnter }])),
  ];
}
