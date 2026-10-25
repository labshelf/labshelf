/** Contract of next-hop reading: an HTML answer on a known platform's landing page leads to the rule's PDF URL. */
import { extractNextHopsFromHtml } from "../../../../src/import/pdfFinder/client/hops";

describe("nextHopsFromHtml", () => {
  it("follows the publisher rule for a landing page a hop reaches", () => {
    expect(extractNextHopsFromHtml("<html><body>Abstract</body></html>", "https://ieeexplore.ieee.org/document/726791")).toEqual([
      "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=726791",
    ]);
  });

  it("skips the supplements a paywalled article page links", () => {
    const supplement = "https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fnature14236/MediaObjects/41586_2015_BFnature14236_MOESM122_ESM.pdf";
    const page = `<html><head><meta name="citation_pdf_url" content="${supplement}"></head><body>Abstract</body></html>`;
    expect(extractNextHopsFromHtml(page, "https://example.org/paper")).toEqual([]);
  });

  it("proposes nothing for a page outside the table that offers no link", () => {
    expect(extractNextHopsFromHtml("<html><body>Abstract</body></html>", "https://example.org/paper")).toEqual([]);
  });

  describe("viewer markup on a mirror's answer", () => {
    const page = (body: string): string[] => extractNextHopsFromHtml(`<html><body>${body}</body></html>`, "https://mirror.example/10.1/x");

    it("follows an embed or iframe src, making a protocol-relative address absolute", () => {
      expect(page('<embed type="application/pdf" src="//cdn.example/files/x.pdf#navpanes=0">')).toEqual(["https://cdn.example/files/x.pdf#navpanes=0"]);
      expect(page('<iframe id="pdf" src="//cdn.example/files/x.pdf#navpanes=0"></iframe>')).toEqual(["https://cdn.example/files/x.pdf#navpanes=0"]);
      expect(page('<embed src="/files/x.pdf">')).toEqual(["https://mirror.example/files/x.pdf"]);
    });

    it("follows a script that sets location.href to a PDF", () => {
      expect(page('<script>location.href="//cdn.example/files/x.pdf"</script>')).toEqual(["https://cdn.example/files/x.pdf"]);
    });

    it("follows a download anchor to a PDF", () => {
      expect(page('<a href="/files/x.pdf">Click here to download</a>')).toEqual(["https://mirror.example/files/x.pdf"]);
    });
  });
});
