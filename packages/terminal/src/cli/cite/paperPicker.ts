// Runs the fuzzy paper picker on the given terminal and resolves with the chosen paper, or undefined on cancel.
import type { PaperRecord } from "@labshelf/core";

import { Terminal } from "../../tui/index.js";
import type { CiteTty } from "./devTty.js";
import { initialPicker, stepPicker, type PickerState } from "./pickerState.js";
import { drawPicker } from "./pickerView.js";

/** The terminal is restored before the promise settles, so the caller prints on a clean screen. */
export function pickPaper(papers: readonly PaperRecord[], tty: CiteTty): Promise<PaperRecord | undefined> {
  return new Promise((resolve) => {
    const terminal = new Terminal(tty.input, tty.output);
    let state: PickerState = initialPicker();
    const paint = (): void => {
      const { cols, rows } = terminal.size();
      terminal.draw(drawPicker(papers, state, cols, rows));
    };
    const finish = (paper: PaperRecord | undefined): void => {
      terminal.leave();
      resolve(paper);
    };
    terminal.listen((event) => {
      const step = stepPicker(papers, state, event);
      if (step.kind === "pick") { finish(step.paper); return; }
      if (step.kind === "cancel") { finish(undefined); return; }
      state = step.state;
      paint();
    }, paint);
    terminal.enter();
    paint();
  });
}
