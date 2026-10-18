/** Verifies the parser of the `.lsstate` file a full build writes at each sectioning command. */
import { parseSectionStates } from "../../../../../src/writing/latex/build/section/index";

describe("parseSectionStates", () => {
  it("reads the command, absolute page, source place and every counter of each line", () => {
    const text = "section|1|3|main.tex|page=1 equation=0 section=0 figure=0\n"
      + "subsection|2|9|chapters/my intro.tex|page=2 equation=1 section=1 subsection=0 figure=1\n";
    expect(parseSectionStates(text)).toEqual({
      states: [
        { command: "section", absolutePage: 1, line: 3, file: "main.tex", counters: { page: 1, equation: 0, section: 0, figure: 0 } },
        { command: "subsection", absolutePage: 2, line: 9, file: "chapters/my intro.tex", counters: { page: 2, equation: 1, section: 1, subsection: 0, figure: 1 } },
      ],
      skipped: 0,
    });
  });

  it("keeps negative counters and counter names with @", () => {
    expect(parseSectionStates("part|4|1|main.tex|page=-2 @pps=3\n").states[0]!.counters).toEqual({ page: -2, "@pps": 3 });
  });

  it("skips and counts lines a crashed run left cut off or malformed, ignoring blank lines", () => {
    const text = "section|1|3|main.tex|page=1\n\nsection|2|7|main.t\nchapter|x|1|main.tex|page=1\nsection|2|8|main.tex|page=2 section=oops\n";
    expect(parseSectionStates(text)).toEqual({
      states: [{ command: "section", absolutePage: 1, line: 3, file: "main.tex", counters: { page: 1 } }],
      skipped: 3,
    });
  });

  it("reads Windows line ends", () => {
    expect(parseSectionStates("section|1|3|main.tex|page=1\r\n").states).toHaveLength(1);
  });
});
