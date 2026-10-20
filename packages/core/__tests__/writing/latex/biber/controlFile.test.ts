/** Verifies the control file's version and data sources are read as biber reads them. */
import * as fs from "node:fs";
import * as path from "node:path";

import { parseControlFile } from "../../../../src/writing/latex/biber/index";

describe("parseControlFile", () => {
  it("reads the version and the file data source of a biblatex control file", () => {
    const parsed = parseControlFile(fs.readFileSync(path.join(__dirname, "fixtures/main.bcf"), "utf8"));
    expect(parsed).toEqual({ version: "3.11", dataSources: [{ path: "refs.bib", type: "file" }] });
  });

  it("decodes XML escapes, keeps the source type and lists a resource once", () => {
    const xml = `<?xml version="1.0"?>\n<bcf:controlfile version="3.10" bltxversion="3.20" xmlns:bcf="x">
      <bcf:bibdata section="0"><bcf:datasource type="file" datatype="bibtex" glob="false">A &amp; B's refs.bib</bcf:datasource>
      <bcf:datasource type="remote" datatype="bibtex">https://example.org/r.bib</bcf:datasource></bcf:bibdata>
      <bcf:bibdata section="1"><bcf:datasource type="file" datatype="bibtex">A &amp; B's refs.bib</bcf:datasource></bcf:bibdata>
    </bcf:controlfile>`;
    expect(parseControlFile(xml)).toEqual({
      version: "3.10",
      dataSources: [{ path: "A & B's refs.bib", type: "file" }, { path: "https://example.org/r.bib", type: "remote" }],
    });
  });

  it("has no version when the root element is missing", () => {
    expect(parseControlFile("<x/>")).toEqual({ version: undefined, dataSources: [] });
  });
});
