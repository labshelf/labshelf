// Tests finding the cite keys behind the links and citations of a real LaTeX build, with hyperref and through SyncTeX.
import * as fs from "node:fs";
import * as path from "node:path";

import { citedKeysAt, keysOnLine, type CitationSources } from "../../../src/writing/quotes";
import { parseSynctex, sourceAt } from "../../../src/writing/synctex";
import { pdfLinks } from "../../support/pdfLinks";

const fixture = (name: string): string => path.join(__dirname, "fixtures", name);
const links = pdfLinks(fixture("hyperref-cites.pdf"));
const tex = fs.readFileSync(fixture("hyperref-cites.tex"), "utf8");
const index = parseSynctex(fs.readFileSync(fixture("hyperref-cites.synctex"), "utf8"), "/work/project");

const latex: CitationSources = {
  format: "latex",
  sourceLineAt: async (point) => {
    const source = sourceAt(index, point);
    return source?.file === "/work/project/hyperref-cites.tex" ? { text: tex, line: source.line } : undefined;
  },
};

describe("citedKeysAt on a LaTeX build", () => {
  it("reads each hyperref citation link's key from its destination name", async () => {
    const keys = await Promise.all(links.map((link) => citedKeysAt({ area: link.area, link: true, dest: link.dest as string }, latex)));
    expect(keys).toEqual([["smith2020"], ["doe19"], []]);
  });

  it("finds nothing for a LaTeX link without a destination name", async () => {
    expect(await citedKeysAt({ area: links[0]!.area, link: true }, latex)).toEqual([]);
  });

  it("finds every key of the \\cite on the source line behind citation text, as a build without hyperref needs", async () => {
    const [smith, doe] = links;
    expect(await citedKeysAt({ area: smith!.area, link: false }, latex)).toEqual(["smith2020", "doe19"]);
    expect(await citedKeysAt({ area: doe!.area, link: false }, latex)).toEqual(["smith2020", "doe19"]);
  });

  it("finds nothing through SyncTeX when the host has no SyncTeX data", async () => {
    expect(await citedKeysAt({ area: links[0]!.area, link: false }, { format: "latex" })).toEqual([]);
    expect(await citedKeysAt({ area: links[0]!.area, link: false }, { format: "latex", sourceLineAt: async () => undefined })).toEqual([]);
  });
});

describe("keysOnLine", () => {
  const text = "\\cite{a}\n% \\cite{hidden}\nSee \\cite{b, c} and \\citep{b}.\n\\cite{d,\n  e}";

  it("lists the keys cited on one line once each, skipping comments", () => {
    expect(keysOnLine("latex", { text, line: 1 })).toEqual(["a"]);
    expect(keysOnLine("latex", { text, line: 2 })).toEqual([]);
    expect(keysOnLine("latex", { text, line: 3 })).toEqual(["b", "c"]);
  });

  it("assigns a key list split over lines to the line of each key", () => {
    expect(keysOnLine("latex", { text, line: 4 })).toEqual(["d"]);
    expect(keysOnLine("latex", { text, line: 5 })).toEqual(["e"]);
  });

  it("finds nothing past the last line", () => {
    expect(keysOnLine("latex", { text, line: 9 })).toEqual([]);
  });
});
