/** Contract of the Unpaywall resolver: the best open-access copy first, then publisher before repository copies. */
import { unpaywallResolver } from "../../../../../src/import/pdfFinding/resolvers/index";
import { json, makeContext, makeFindingHarness } from "../../../../support/pdfFindingHarness";

const URL_FOR = "https://api.unpaywall.org/v2/10.1%2Fx?email=me%40uni.edu";

describe("unpaywallResolver", () => {
  it("asks with the contact email and returns the best copy, then the others by host type", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => json({
      best_oa_location: { url_for_pdf: "https://repo.example/best.pdf" },
      oa_locations: [
        { url_for_pdf: "https://repo.example/best.pdf", host_type: "repository" },
        { url_for_pdf: "https://pub.example/oa.pdf", host_type: "publisher" },
        { url: "https://other.example/scan.pdf?x=1", host_type: "repository" },
        { url: "https://other.example/landing", host_type: "repository" },
      ],
    });
    expect(await unpaywallResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([
      "https://repo.example/best.pdf", "https://pub.example/oa.pdf", "https://other.example/scan.pdf?x=1",
    ]);
  });

  it("logs one warning when the lookup fails", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => { throw new TypeError("offline"); };
    expect(await unpaywallResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([]);
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", context: { url: URL_FOR, error: "offline" } })]);
  });
});
