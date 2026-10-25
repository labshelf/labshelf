import type { CitationEntry } from "@labshelf/core";

import { withCitationFixes } from "../../../../src/writing/preview/citations/withCitationFixes";
import { readPublishedVenue } from "../../../../src/writing/preview/citations/updateBibEntry";
import type { CitationFixDeps } from "../../../../src/writing/preview/citations/citationFixDeps";
import { fakeLogger } from "../../../support/writingFixtures";

jest.mock("../../../../src/writing/preview/citations/updateBibEntry", () => ({ readPublishedVenue: jest.fn(async () => undefined), updateBibEntry: jest.fn() }));
jest.mock("../../../../src/writing/preview/citations/addBibliographyToLibrary", () => ({ addBibliographyToLibrary: jest.fn() }));

const paper = { id: "p" } as NonNullable<CitationEntry["paper"]>;
const bib = { key: "k" } as unknown as NonNullable<CitationEntry["bib"]>;

function deps(shelfKeys: CitationFixDeps["shelfKeys"]): CitationFixDeps {
  return { projectFolder: "/proj", logger: fakeLogger(), shelfKeys } as unknown as CitationFixDeps;
}

describe("withCitationFixes", () => {
  beforeEach(() => (readPublishedVenue as jest.Mock).mockResolvedValue(undefined));

  it("suggests a shelf key for a missing citation", async () => {
    const out = await withCitationFixes(deps(async () => [{ key: "smith2020", authors: ["Smith"], year: "2020" }]), [{ key: "smith2021" }]);
    expect(out[0]?.fix).toEqual({ kind: "replace", suggestion: "smith2020" });
  });

  it("leaves a missing citation without fix when nothing resembles it", async () => {
    const out = await withCitationFixes(deps(async () => []), [{ key: "zzz" }]);
    expect(out[0]?.fix).toBeUndefined();
  });

  it("offers adding a bib-only entry to the library", async () => {
    const out = await withCitationFixes(deps(async () => []), [{ key: "k", bib }]);
    expect(out[0]?.fix).toEqual({ kind: "add" });
  });

  it("offers a venue update for a known published venue", async () => {
    (readPublishedVenue as jest.Mock).mockResolvedValue("Nature");
    const out = await withCitationFixes(deps(async () => []), [{ key: "k", paper, bib }]);
    expect(out[0]?.fix).toEqual({ kind: "update", venue: "Nature" });
  });

  it("logs a failing lookup and leaves the entry without fix", async () => {
    const d = deps(async () => { throw new Error("boom"); });
    const out = await withCitationFixes(d, [{ key: "k" }]);
    expect(out[0]?.fix).toBeUndefined();
    expect(d.logger.log).toHaveBeenCalled();
  });
});
