// Tests that a missing paper carries what its reference's info says, in the papers tree and on the desk, and that other papers resolve as before.
import { buildOverview } from "../../../src/spaces/spaceOverview";
import { buildPapersTree, hasDownloadablePapers, resolvePaper } from "../../../src/spaces/spaceViews";
import { folder, library, paperRef, space } from "./viewFixture";

const lib = library({ id: "a", title: "Alpha", status: "reading" });
const withInfo = (id: string, info: unknown, extra: Record<string, unknown> = {}) => ({ ...paperRef(id, extra), extra: { info } });
const full = { title: "Remote", authors: ["Ana", "Bo"], year: 2023, pdf: { sha256: "b".repeat(64), bytes: 5 } };

describe("remote info of a missing paper", () => {
  it("resolves a missing paper with info to its remote data", () => {
    expect(resolvePaper("r", lib, withInfo("r", full) as never)).toEqual({
      id: "r", missing: true, remote: { title: "Remote", authors: ["Ana", "Bo"], year: 2023, downloadable: true, hasPdf: true },
    });
  });

  it("keeps a paper without a PDF downloadable as metadata", () => {
    expect(resolvePaper("r", lib, withInfo("r", { title: "Only meta" }) as never)).toEqual({
      id: "r", missing: true, remote: { title: "Only meta", authors: [], downloadable: true, hasPdf: false },
    });
  });

  it("leaves a missing paper without usable info bare", () => {
    expect(resolvePaper("r", lib, withInfo("r", { authors: [] }) as never)).toEqual({ id: "r", missing: true });
    expect(resolvePaper("r", lib)).toEqual({ id: "r", missing: true });
  });

  it("does not change a paper the library holds", () => {
    expect(resolvePaper("a", lib, withInfo("a", full) as never)).toEqual(resolvePaper("a", lib));
  });

  it("puts remote data on the tree and finds downloadable papers inside folders", () => {
    const s = space({ folders: [folder("f1")] as never, papers: [paperRef("a"), withInfo("r", full, { folder: "f1" })] as never });
    const tree = buildPapersTree(s, lib);
    expect(tree.folders[0]!.papers[0]).toMatchObject({ id: "r", missing: true, remote: { title: "Remote" } });
    expect(hasDownloadablePapers(tree)).toBe(true);
    expect(hasDownloadablePapers({ folders: [], papers: tree.papers })).toBe(false);
  });

  it("puts remote data on a desk card", () => {
    const s = space({ papers: [withInfo("r", full)] as never, desk: { items: [{ id: "paper:r", kind: "paper", ref: "r", extra: {} }], invalid: [] } } as never);
    const card = buildOverview(s, lib, [], "2026-11-01").desk[0];
    expect(card).toMatchObject({ kind: "paper", paper: { id: "r", missing: true, remote: { title: "Remote" } } });
  });
});
