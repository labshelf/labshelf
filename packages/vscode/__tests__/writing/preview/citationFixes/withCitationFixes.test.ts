import type { CitationEntry } from "@labshelf/core";

import { withCitationFixes } from "../../../../src/writing/preview/citationFixes/withCitationFixes";
import { publishedVenueOf } from "../../../../src/writing/preview/citationFixes/updateBibEntry";
import type { CitationFixDeps } from "../../../../src/writing/preview/citationFixes/citationFixDeps";
import { fakeLogger } from "../../../support/writingFixtures";

jest.mock("../../../../src/writing/preview/citationFixes/updateBibEntry", () => ({ publishedVenueOf: jest.fn(async () => undefined), updateBibEntry: jest.fn() }));
jest.mock("../../../../src/writing/preview/citationFixes/addBibToLibrary", () => ({ addBibToLibrary: jest.fn() }));

const paper = { id: "p" } as NonNullable<CitationEntry["paper"]>;
const bib = { key: "k" } as unknown as NonNullable<CitationEntry["bib"]>;

function deps(shelfKeys: CitationFixDeps["shelfKeys"]): CitationFixDeps {
  return { projectFolder: "/proj", logger: fakeLogger(), shelfKeys } as unknown as CitationFixDeps;
}

describe("withCitationFixes", () => {
  beforeEach(() => (publishedVenueOf as jest.Mock).mockResolvedValue(undefined));

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
    (publishedVenueOf as jest.Mock).mockResolvedValue("Nature");
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
