/** Contract of the Unpaywall resolver: the best open-access copy first, then publisher before repository copies. */
import { unpaywallResolver } from "../../../../src/import/pdfFinder/openAccess";
import { json, makeContext, makeFindingHarness } from "../../../support/pdfFindingHarness";

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

  it("notes each location's version label for its URLs, and keeps the first label for a repeated URL", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => json({
      best_oa_location: { url_for_pdf: "https://repo.example/best.pdf", version: "acceptedVersion" },
      oa_locations: [
        { url_for_pdf: "https://repo.example/best.pdf", version: "submittedVersion" },
        { url_for_pdf: "https://pub.example/oa.pdf", url: "https://pub.example/landing", version: "publishedVersion" },
        { url_for_pdf: "https://pre.example/p.pdf", version: "submittedVersion" },
        { url_for_pdf: "https://odd.example/p.pdf", version: "somethingElse" },
        { url_for_pdf: "https://none.example/p.pdf" },
      ],
    });
    const ctx = makeContext({ doi: "10.1/x" });
    await unpaywallResolver.resolve(ctx, h.env);
    expect(Object.fromEntries(ctx.versions!)).toEqual({
      "https://repo.example/best.pdf": "accepted",
      "https://pub.example/oa.pdf": "published",
      "https://pub.example/landing": "published",
      "https://pre.example/p.pdf": "preprint",
    });
  });

  it("keeps no pre-publication label on a publisher-hosted copy", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => json({
      best_oa_location: { url_for_pdf: "https://journals.plos.org/p.pdf", host_type: "publisher", version: "submittedVersion" },
      oa_locations: [{ url_for_pdf: "https://pub.example/vor.pdf", host_type: "publisher", version: "publishedVersion" }],
    });
    const ctx = makeContext({ doi: "10.1/x" });
    await unpaywallResolver.resolve(ctx, h.env);
    expect(Object.fromEntries(ctx.versions!)).toEqual({ "https://pub.example/vor.pdf": "published" });
  });

  it("leaves the versions unset when Unpaywall labels nothing", async () => {
    const h = makeFindingHarness();
    h.routes[URL_FOR] = () => json({ best_oa_location: { url_for_pdf: "https://repo.example/best.pdf" } });
    const ctx = makeContext({ doi: "10.1/x" });
    await unpaywallResolver.resolve(ctx, h.env);
    expect(ctx.versions).toBeUndefined();
  });
});
