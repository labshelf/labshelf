/** Verifies the parser of the `.lsstate` file a full build writes at each sectioning command. */
import { parseSectionStates } from "../../../../src/latex/build/section/index";

describe("parseSectionStates", () => {
  it("reads the command, absolute page, source place and every counter of each line", () => {
    const text = "section|1|3|main.tex|page=1 equation=0 section=0 figure=0\n"
      + "subsection|2|9|chapters/my intro.tex|page=2 equation=1 section=1 subsection=0 figure=1\n";
    expect(parseSectionStates(text)).toEqual({
      states: [
        { command: "section", absolutePage: 1, fillingPage: 1, line: 3, file: "main.tex", counters: { page: 1, equation: 0, section: 0, figure: 0 } },
        { command: "subsection", absolutePage: 2, fillingPage: 2, line: 9, file: "chapters/my intro.tex", counters: { page: 2, equation: 1, section: 1, subsection: 0, figure: 1 } },
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
      states: [{ command: "section", absolutePage: 1, fillingPage: 1, line: 3, file: "main.tex", counters: { page: 1 } }],
      skipped: 3,
    });
  });

  it("takes the absolute page and page counter from each command's landing record, matched by record order", () => {
    const text = "section|1|3|main.tex|page=1 section=0\nsection|1|9|main.tex|page=1 section=1\n"
      + "P|1|1|1\nP|2|2|2\nsection|2|20|main.tex|page=2 section=2\n";
    expect(parseSectionStates(text)).toEqual({
      states: [
        { command: "section", absolutePage: 1, fillingPage: 1, line: 3, file: "main.tex", counters: { page: 1, section: 0 } },
        { command: "section", absolutePage: 2, fillingPage: 1, line: 9, file: "main.tex", counters: { page: 2, section: 1 } },
        { command: "section", absolutePage: 2, fillingPage: 2, line: 20, file: "main.tex", counters: { page: 2, section: 2 } },
      ],
      skipped: 0,
    });
  });

  it("keeps a cut-off command line's slot, so later landing records still match their command", () => {
    const text = "section|1|3|main.t\nsection|4|9|main.tex|page=4\nP|2|5|5\nP|x|1\n";
    expect(parseSectionStates(text)).toEqual({
      states: [{ command: "section", absolutePage: 5, fillingPage: 4, line: 9, file: "main.tex", counters: { page: 5 } }],
      skipped: 2,
    });
  });

  it("reads Windows line ends", () => {
    expect(parseSectionStates("section|1|3|main.tex|page=1\r\n").states).toHaveLength(1);
  });
});


it("recognizes only explicitly recorded empty-page boundaries", () => {
  const text = "section|1|3|main.tex|page=1\nB|1\nP|1|1|1\nsection|1|8|main.tex|page=1\n";
  const parsed = parseSectionStates(text);
  expect(parsed.skipped).toBe(0);
  expect(parsed.states.map((state) => state.pageBoundary === true)).toEqual([true, false]);
});

it("does not trust a boundary without the heading's shipout record", () => {
  const parsed = parseSectionStates("section|1|3|main.tex|page=1\nB|1\n");
  expect(parsed.states[0]?.pageBoundary).toBeUndefined();
});
