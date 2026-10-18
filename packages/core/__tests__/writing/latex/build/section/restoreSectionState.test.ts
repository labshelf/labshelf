/** Verifies the TeX that restores the counters a full build captured before a section. */
import { restoreSectionState } from "../../../../../src/writing/latex/build/section/index";

describe("restoreSectionState", () => {
  it("sets every captured counter, the page included, skipping counters the document does not define", () => {
    const state = { command: "section", absolutePage: 3, fillingPage: 3, line: 12, file: "main.tex", counters: { page: 3, section: 2, "@pps": 1 } };
    expect(restoreSectionState(state)).toBe(
      "\\ifcsname c@page\\endcsname\\setcounter{page}{3}\\fi\n"
      + "\\ifcsname c@section\\endcsname\\setcounter{section}{2}\\fi\n"
      + "\\ifcsname c@@pps\\endcsname\\setcounter{@pps}{1}\\fi\n",
    );
  });

  it("renders nothing for a state without counters", () => {
    expect(restoreSectionState({ command: "part", absolutePage: 1, fillingPage: 1, line: 1, file: "main.tex", counters: {} })).toBe("");
  });
});
