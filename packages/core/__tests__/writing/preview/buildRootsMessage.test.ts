/** Verifies the preview's build-roots message: the limits and chrome fields it carries, their key order, and the check-limits patch a reader change writes. */
import { createBuildRootsMessage, deriveCheckLimitsPatch } from "../../../src/writing/preview/index";
import type { PreviewBuildRoot } from "../../../src/reader";

const ROOT: PreviewBuildRoot = { path: "main.tex", failed: false, rawLog: false, sourceLinks: false, problems: [] };

function message(extra: Partial<Parameters<typeof createBuildRootsMessage>[0]> = {}) {
  return createBuildRootsMessage({ main: "main.tex", focused: "main.tex", shown: "main.tex", roots: [ROOT], limits: {}, ...extra });
}

describe("createBuildRootsMessage", () => {
  it("carries the limits as pageLimit, wordLimit and countUpTo", () => {
    expect(message({ limits: { pages: 9, words: 6000, countUpTo: "end" } })).toMatchObject({ pageLimit: 9, wordLimit: 6000, countUpTo: "end" });
  });

  it("omits the limits, checks and options when absent", () => {
    for (const limits of [{}, { pages: undefined, words: undefined, countUpTo: undefined }]) {
      const built = message({ limits });
      for (const field of ["pageLimit", "wordLimit", "countUpTo", "checks", "options"]) { expect(field in built).toBe(false); }
    }
  });

  it("carries the findings of the last check, zero included", () => {
    expect(message({ checks: 0 }).checks).toBe(0);
  });

  it("passes the options it is given without copying them", () => {
    const options = { autoCompile: "typing" as const, engine: null };
    expect(message({ options }).options).toBe(options);
  });

  it("keeps one key order, so both apps post the same bytes", () => {
    const built = message({ main: "a.tex", focused: "b.tex", shown: "c.tex", limits: { countUpTo: "end", words: 2, pages: 1 }, options: { autoCompile: "save", engine: null }, checks: 3 });
    expect(Object.keys(built)).toEqual(["main", "focused", "shown", "roots", "pageLimit", "wordLimit", "countUpTo", "checks", "options"]);
    expect(JSON.stringify(built)).toBe('{"main":"a.tex","focused":"b.tex","shown":"c.tex","roots":[{"path":"main.tex","failed":false,"rawLog":false,"sourceLinks":false,"problems":[]}],"pageLimit":1,"wordLimit":2,"countUpTo":"end","checks":3,"options":{"autoCompile":"save","engine":null}}');
  });
});

describe("deriveCheckLimitsPatch", () => {
  it("patches only the fields in the change", () => {
    const patch = deriveCheckLimitsPatch({ pages: 8, countUpTo: "end" });
    expect(patch).toEqual({ pages: 8, countUpTo: "end" });
    expect(Object.keys(patch)).toEqual(["pages", "countUpTo"]);
  });

  it("turns null into a removal", () => {
    const patch = deriveCheckLimitsPatch({ words: null, pages: null });
    expect(Object.keys(patch)).toEqual(["pages", "words"]);
    expect(patch.words).toBeUndefined();
    expect(patch.pages).toBeUndefined();
  });

  it("is empty for an empty change", () => {
    expect(deriveCheckLimitsPatch({})).toEqual({});
  });
});
