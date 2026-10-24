/** Contract of candidateVersion: a preprint server's address, then the publisher rule, then an aggregator's label, which the article's own links never take. */
import { candidateVersion, isPreprintServerUrl } from "../../../../src/import/pdfFinder/resolvers/index";
import { makeContext } from "../../../support/pdfFindingHarness";

describe("candidateVersion", () => {
  it("uses the label a lookup noted for an aggregator's URL", () => {
    const ctx = makeContext({ versions: new Map([["https://x.example/a.pdf", "accepted"]]) });
    expect(candidateVersion(ctx, "unpaywall", "https://x.example/a.pdf")).toBe("accepted");
    expect(candidateVersion(ctx, "openalex", "https://x.example/a.pdf")).toBe("accepted");
  });

  it.each(["page", "landing"])("ignores aggregator labels on a %s link, which is the publisher's own file", (resolver) => {
    const url = "https://journals.plos.org/plosmedicine/article/file?id=10.1371/journal.pmed.0020124&type=printable";
    expect(candidateVersion(makeContext({ versions: new Map([[url, "preprint"]]) }), resolver, url)).toBeUndefined();
  });

  it("calls a preprint server's URL a preprint whatever an aggregator labelled it", () => {
    const url = "https://arxiv.org/pdf/2301.00001";
    expect(candidateVersion(makeContext({ versions: new Map([[url, "published"]]) }), "openalex", url)).toBe("preprint");
  });

  it.each([
    "https://arxiv.org/pdf/2301.00001",
    "https://arxiv.org/abs/hep-th/9711200v2",
    "https://www.biorxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf",
    "https://medrxiv.org/content/10.1101/2020.01.01.123456v1.full.pdf",
  ])("calls %s a preprint", (url) => {
    expect(candidateVersion(makeContext(), "unpaywall", url)).toBe("preprint");
    expect(isPreprintServerUrl(url)).toBe(true);
  });

  it("calls a publisher rule's URL published, even when the host is unknown", () => {
    expect(candidateVersion(makeContext(), "publisher", "https://dl.acm.org/doi/pdf/10.1145/1.2")).toBe("published");
  });

  it("calls a preprint server's URL a preprint even from the publisher resolver", () => {
    expect(candidateVersion(makeContext(), "publisher", "https://www.biorxiv.org/content/x.pdf")).toBe("preprint");
  });

  it("leaves any other URL from any other resolver unlabelled", () => {
    expect(candidateVersion(makeContext(), "unpaywall", "https://repo.example/a.pdf")).toBeUndefined();
    expect(candidateVersion(makeContext({ versions: new Map() }), "page", "https://repo.example/a.pdf")).toBeUndefined();
  });

  it("does not treat a lookalike host or a malformed URL as a preprint server", () => {
    expect(isPreprintServerUrl("https://notbiorxiv.org/a.pdf")).toBe(false);
    expect(isPreprintServerUrl("https://biorxiv.org.evil.example/a.pdf")).toBe(false);
    expect(isPreprintServerUrl("not a url")).toBe(false);
  });
});
