/** Contract of the PMC resolver: the newest version of the article in the open-data bucket, nothing else. */
import { pmcResolver } from "../../../../src/import/pdfFinder/openAccess";
import { makeContext, makeFindingHarness } from "../../../support/pdfFindingHarness";

const BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com";
const listing = (...keys: string[]): Response => new Response(`<ListBucketResult>${keys.map((k) => `<Key>${k}</Key>`).join("")}</ListBucketResult>`);

describe("pmcResolver", () => {
  it("lists the bucket by the dotted PMCID prefix and returns the highest version", async () => {
    const h = makeFindingHarness();
    h.routes[`${BUCKET}/?list-type=2&prefix=PMC5586528.&max-keys=100`] = () => listing(
      "PMC5586528.1/PMC5586528.1.pdf", "PMC5586528.1/PMC5586528.1.xml", "PMC5586528.10/PMC5586528.10.pdf", "PMC5586528.2/PMC5586528.2.pdf",
    );
    expect(await pmcResolver.resolve(makeContext({ pmcid: "5586528" }), h.env)).toEqual([`${BUCKET}/PMC5586528.10/PMC5586528.10.pdf`]);
  });

  it("proposes nothing for a PMC article the bucket does not hold, and never the walled PMC page", async () => {
    const h = makeFindingHarness();
    h.routes[`${BUCKET}/?list-type=2&prefix=PMC123.&max-keys=100`] = () => listing();
    expect(await pmcResolver.resolve(makeContext({ pmcid: "PMC123" }), h.env)).toEqual([]);
  });

  it("does nothing without a PMCID", async () => {
    const h = makeFindingHarness();
    expect(await pmcResolver.resolve(makeContext({ doi: "10.1/x" }), h.env)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it("logs one warning when the bucket answers an error", async () => {
    const h = makeFindingHarness();
    h.routes[`${BUCKET}/?list-type=2&prefix=PMC123.&max-keys=100`] = () => new Response("slow down", { status: 503 });
    expect(await pmcResolver.resolve(makeContext({ pmcid: "PMC123" }), h.env)).toEqual([]);
    expect(h.logs).toEqual([expect.objectContaining({ level: "WARN", module: "pdfFinding", context: expect.objectContaining({ status: 503 }) })]);
  });
});
