// Tests finding the cite keys behind the links and citations of a real LaTeX build, with hyperref and through SyncTeX.
import * as fs from "node:fs";
import * as path from "node:path";

import { findCiteKeysAt, findCiteKeysOnLine, type CitationSources } from "../../../src/writing/quotes";
import { parseSynctex, findSourcePosition } from "../../../src/writing/synctex";
import { pdfLinks } from "../../support/pdfLinks";

const fixture = (name: string): string => path.join(__dirname, "fixtures", name);
const links = pdfLinks(fixture("hyperref-cites.pdf"));
const tex = fs.readFileSync(fixture("hyperref-cites.tex"), "utf8");
const index = parseSynctex(fs.readFileSync(fixture("hyperref-cites.synctex"), "utf8"), "/work/project");

const latex: CitationSources = {
  format: "latex",
  sourceLineAt: async (point) => {
    const source = findSourcePosition(index, point);
    return source?.file === "/work/project/hyperref-cites.tex" ? { text: tex, line: source.line } : undefined;
  },
};

describe("findCiteKeysAt on a LaTeX build", () => {
  it("reads each hyperref citation link's key from its destination name", async () => {
    const keys = await Promise.all(links.map((link) => findCiteKeysAt({ area: link.area, link: true, dest: link.dest as string }, latex)));
    expect(keys).toEqual([["smith2020"], ["doe19"], []]);
  });

  it("finds nothing for a LaTeX link without a destination name", async () => {
    expect(await findCiteKeysAt({ area: links[0]!.area, link: true }, latex)).toEqual([]);
  });

  it("finds every key of the \\cite on the source line behind citation text, as a build without hyperref needs", async () => {
    const [smith, doe] = links;
    expect(await findCiteKeysAt({ area: smith!.area, link: false }, latex)).toEqual(["smith2020", "doe19"]);
    expect(await findCiteKeysAt({ area: doe!.area, link: false }, latex)).toEqual(["smith2020", "doe19"]);
  });

  it("finds nothing through SyncTeX when the host has no SyncTeX data", async () => {
    expect(await findCiteKeysAt({ area: links[0]!.area, link: false }, { format: "latex" })).toEqual([]);
    expect(await findCiteKeysAt({ area: links[0]!.area, link: false }, { format: "latex", sourceLineAt: async () => undefined })).toEqual([]);
  });
});

describe("findCiteKeysOnLine", () => {
  const text = "\\cite{a}\n% \\cite{hidden}\nSee \\cite{b, c} and \\citep{b}.\n\\cite{d,\n  e}";

  it("lists the keys cited on one line once each, skipping comments", () => {
    expect(findCiteKeysOnLine("latex", { text, line: 1 })).toEqual(["a"]);
    expect(findCiteKeysOnLine("latex", { text, line: 2 })).toEqual([]);
    expect(findCiteKeysOnLine("latex", { text, line: 3 })).toEqual(["b", "c"]);
  });

  it("assigns a key list split over lines to the line of each key", () => {
    expect(findCiteKeysOnLine("latex", { text, line: 4 })).toEqual(["d"]);
    expect(findCiteKeysOnLine("latex", { text, line: 5 })).toEqual(["e"]);
  });

  it("finds nothing past the last line", () => {
    expect(findCiteKeysOnLine("latex", { text, line: 9 })).toEqual([]);
  });
});
