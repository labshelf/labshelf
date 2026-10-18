// Pins the file names a download gets from untrusted manifest fields: one safe segment each, unique within the .zip.
import { pdfFileName, zipEntryNames, zipFileName } from "../../src/share/downloadNames";

describe("download names", () => {
  it("names a PDF after the cite key, keeping only safe characters", () => {
    expect(pdfFileName({ id: "x", citeKey: "vaswani2017attention" })).toBe("vaswani2017attention.pdf");
    expect(pdfFileName({ id: "x", citeKey: "../../etc/passwd" })).toBe("etc_passwd.pdf");
    expect(pdfFileName({ id: "fallback", citeKey: "" })).toBe("fallback.pdf");
    expect(pdfFileName({ id: "...", citeKey: "///" })).toBe("paper.pdf");
  });

  it("keeps names in a .zip unique", () => {
    expect(zipEntryNames(["a.pdf", "a.pdf", "b.pdf", "a.pdf"])).toEqual(["a.pdf", "a-2.pdf", "b.pdf", "a-3.pdf"]);
  });

  it("names the .zip after the folder", () => {
    expect(zipFileName("Reading group")).toBe("Reading group.zip");
    expect(zipFileName("..")).toBe("shared papers.zip");
  });
});
