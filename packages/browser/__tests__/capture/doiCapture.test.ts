/** A DOI alone becomes a paper draft: the capture flow resolves its metadata and checks the library. */
const mockDraftFromFacts = jest.fn();
jest.mock("../../src/capture/captureService", () => ({ draftFromFacts: (...a: unknown[]) => mockDraftFromFacts(...a) }));

import { draftFromDoi } from "../../src/capture/doiCapture";

const log = { log: async () => undefined, error: async () => undefined };

it("hands the capture flow page facts that carry only the DOI and count as a paper", async () => {
  const draft = { ids: { doi: "10.1/a" } };
  mockDraftFromFacts.mockResolvedValue(draft);

  expect(await draftFromDoi(log, "10.1/a")).toBe(draft);

  expect(mockDraftFromFacts).toHaveBeenCalledWith(log, {
    pageUrl: "https://doi.org/10.1/a", ids: { doi: "10.1/a" }, metadata: {}, structured: false, pdfCandidates: [], isPaper: true,
  }, {});
});
