/** Verifies the pre-submission check on a real pdfTeX build, read through what real pdf.js reports for it. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { checkProject } from "../../../../src/writing/checks/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { replayLoader } from "../../../support/replayPdfjs";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const FIXTURES = path.join(__dirname, "..", "fixtures");
const PDF = path.join(FIXTURES, "check.pdf");

async function projectWithFixtureSource(): Promise<string> {
  const folder = await makeTempDir();
  await fs.copyFile(path.join(FIXTURES, "check.tex"), path.join(folder, "check.tex"));
  return folder;
}

describe("checkProject", () => {
  it("flags the page limit, the author in the PDF metadata, a Type 3 font, a 25 dpi image and an unresolved reference", async () => {
    const folder = await projectWithFixtureSource();
    const { loader, destroy } = replayLoader(PDF);
    const logger = fakeLogger();
    const findings = await checkProject({ folder, pdfPath: PDF, settings: { pages: 9, anonymous: true } }, loader, logger);
    expect(findings.map(({ rule, severity, location }) => [rule, severity, location])).toEqual([
      ["pages", "error", { kind: "pdf" }],
      ["anonymity", "error", { kind: "pdf" }],
      ["references", "error", { kind: "pdf", page: 1 }],
      ["fonts", "warning", { kind: "pdf", page: 1 }],
      ["images", "warning", { kind: "pdf", page: 1 }],
    ]);
    expect(findings[0]!.message).toBe("The paper has 10 pages (no References heading found, so every page counts); the limit is 9.");
    expect(findings[1]!.message).toContain("Author field names an author (Jane Doe)");
    expect(findings[4]!.message).toContain("prints at 25 dpi");
    expect(destroy).toHaveBeenCalled();
    expect(logger.logs).toEqual([expect.objectContaining({ level: "INFO", module: "writing/checks" })]);
  });

  it("passes the same PDF against a camera-ready with room to spare, but still warns about the layout", async () => {
    const folder = await projectWithFixtureSource();
    const findings = await checkProject({ folder, pdfPath: PDF, settings: { pages: 10, anonymous: false } }, replayLoader(PDF).loader, fakeLogger());
    expect(findings.map((finding) => finding.rule)).toEqual(["references", "fonts", "images"]);
  });

  it("rejects a missing PDF and logs the path", async () => {
    const folder = await projectWithFixtureSource();
    const logger = fakeLogger();
    const pdfPath = path.join(folder, "missing.pdf");
    await expect(checkProject({ folder, pdfPath, settings: undefined }, replayLoader(PDF).loader, logger)).rejects.toThrow(/ENOENT/);
    expect(logger.errors).toEqual([{ module: "writing/checks", context: { folder, pdf: pdfPath } }]);
  });
});
