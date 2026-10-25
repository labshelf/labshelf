// Tests that a Typst compile reports where its citations land, so the links of the real PDF map back to their cite keys.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { findCiteKeysAt } from "../../src/writing/quotes";
import { readProbeAnswer } from "../../src/typst/typstCitationProbe";
import type { TypstSession } from "../../src/typst/index";
import { deriveTypstCompilerPath } from "../../src/typst/node/index";
import { pdfLinks } from "../support/pdfLinks";
import { cleanupTempDirs, makeTempDir } from "../support/tempDirs";
import { openTestSession, TYPST_TEST_FONT_SETTING } from "../support/typstFixtures";

afterEach(cleanupTempDirs);

let session: TypstSession;
beforeAll(async () => { session = await openTestSession({ resolve: () => undefined }); });

const BIB = "@article{smith2020, author={Smith, A}, title={A paper}, journal={J}, year={2020}}\n"
  + "@article{doe19, author={Doe, B}, title={Another}, journal={J}, year={2019}}\n";

async function compileProject(main: string, text: string) {
  const folder = await makeTempDir();
  const mainFile = path.join(folder, main);
  await fs.mkdir(path.dirname(mainFile), { recursive: true });
  await fs.writeFile(path.join(path.dirname(mainFile), "refs.bib"), BIB);
  await fs.writeFile(mainFile, text);
  const result = await session.compile({ root: deriveTypstCompilerPath(folder), main: deriveTypstCompilerPath(mainFile), sources: new Map() });
  const pdfFile = path.join(folder, "out.pdf");
  await fs.writeFile(pdfFile, result.pdf!);
  return { result, links: pdfLinks(pdfFile) };
}

const DOCUMENT = `${TYPST_TEST_FONT_SETTING}#set page(height: 10cm)
#set heading(numbering: "1.")
= Intro <intro>
See @smith2020 and @doe19, as in @intro.
#pagebreak()
Again #cite(<smith2020>).
#bibliography("refs.bib")
#pagebreak()
`;

describe("Typst citation positions", () => {
  it("maps every citation link of the PDF to its key and every other link to none", async () => {
    const { result, links } = await compileProject("main.typ", DOCUMENT);
    const cites = result.citations && "cites" in result.citations ? result.citations.cites : [];
    expect(cites.map((cite) => [cite.key, cite.at.page])).toEqual([["smith2020", 1], ["doe19", 1], ["smith2020", 2]]);
    const keys = await Promise.all(links.map((link) => findCiteKeysAt({ area: link.area, link: true }, { format: "typst", typstCites: cites })));
    expect(keys.filter((found) => found.length > 0)).toEqual([["smith2020"], ["doe19"], ["smith2020"]]);
    // The heading reference and the bibliography's back links are links too, and cite nothing.
    expect(keys.filter((found) => found.length === 0).length).toBe(links.length - 3);
  });

  it("finds the citations of a main file in a subfolder of the project", async () => {
    const { result } = await compileProject("paper/main.typ", `${TYPST_TEST_FONT_SETTING}See @doe19.\n#bibliography("refs.bib")\n`);
    expect(result.citations).toEqual({ cites: [{ key: "doe19", at: expect.objectContaining({ page: 1 }) }] });
  });

  it("reports no citations for a document that cites nothing", async () => {
    const { result } = await compileProject("main.typ", `${TYPST_TEST_FONT_SETTING}Hi`);
    expect(result.citations).toEqual({ cites: [] });
  });
});

describe("readProbeAnswer", () => {
  it("reads the probe's metadata value", () => {
    expect(readProbeAnswer([[{ key: "a", page: 1, x: 2, y: 3 }]])).toEqual({ cites: [{ key: "a", at: { page: 1, x: 2, y: 3 } }] });
  });

  it.each([[[]], [[[{ key: "a", page: 1, x: "2pt", y: 3 }]]], [[[{ page: 1, x: 2, y: 3 }]]], ["nope"]])("reports a failure for %j", (answer) => {
    expect(readProbeAnswer(answer)).toEqual({ failure: expect.any(String) });
  });
});
