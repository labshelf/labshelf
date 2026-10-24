/** Contract of the publisher rule table: every rule gives its verified examples' PDF URLs, and rules never overlap. */
import { PUBLISHER_RULES, pdfUrlsForDoi, pdfUrlsForLanding } from "../../../../src/import/pdfFinder/rules/index";

const isDoi = (from: string): boolean => from.startsWith("10.");

describe("publisher rule table", () => {
  it.each(PUBLISHER_RULES.map((r) => [r.platform, r] as const))("%s gives the PDF URL of each example", (_, rule) => {
    for (const { from, pdf } of rule.examples) {
      expect(isDoi(from) ? pdfUrlsForDoi(from) : pdfUrlsForLanding(from)).toContain(pdf);
    }
  });

  it.each(PUBLISHER_RULES.map((r) => [r.platform, r] as const))("%s has an example for each part it declares", (_, rule) => {
    expect(rule.examples.some((e) => isDoi(e.from))).toBe(!!rule.doi);
    expect(rule.examples.some((e) => !isDoi(e.from))).toBe(!!rule.landing);
  });

  it.each(PUBLISHER_RULES.map((r) => [r.platform, r] as const))("%s does not read its own PDF URL as a landing page", (_, rule) => {
    for (const { pdf } of rule.examples) expect(pdfUrlsForLanding(pdf).filter((u) => u !== pdf)).toEqual([]);
  });

  it("names each platform once and gives each DOI prefix to one platform", () => {
    const platforms = PUBLISHER_RULES.map((r) => r.platform);
    expect(new Set(platforms).size).toBe(platforms.length);
    const prefixes = PUBLISHER_RULES.flatMap((r) => r.doi?.prefixes ?? []);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("knows nothing about a DOI or page outside the table", () => {
    // Elsevier keys PDFs by the PII, so its DOI alone gives nothing.
    expect(pdfUrlsForDoi("10.1016/0196-6774(82)90007-4")).toEqual([]);
    expect(pdfUrlsForLanding("https://example.org/doi/abs/10.1145/3065386")).toEqual([]);
    expect(pdfUrlsForLanding("not a url")).toEqual([]);
  });

  it("builds the PDF on the host the landing page came from", () => {
    expect(pdfUrlsForLanding("https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2019GL085378")).toEqual([
      "https://agupubs.onlinelibrary.wiley.com/doi/pdfdirect/10.1029/2019GL085378",
    ]);
  });
});
