// Pins how a share's manifest becomes the one read-only folder the library UI shows, and which papers it drops.
import type { ShareManifest } from "@labshelf/core";

import { createShareLibrary } from "../../src/share/shareLibrary";

const PDF = { size: 10, parts: [{ blob: "a".repeat(64), content: "b".repeat(64), size: 10 }] };
const HIGHLIGHT = {
  id: "h1", paperId: "vaswani2017", type: "highlight" as const, pageNumber: 3, color: "yellow" as const, content: "attention",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};

function manifest(folder: string, papers: ShareManifest["papers"]): ShareManifest {
  return { v: 1, folder, papers };
}

describe("share library", () => {
  it("shows the papers in one folder named after the share, with their fields, PDFs and annotation counts", () => {
    const library = createShareLibrary(manifest("Reading group", [
      { metadata: { id: "vaswani2017", title: "Attention", citeKey: "vaswani2017", year: 2017, summary: "We propose." }, pdf: PDF, annotations: [HIGHLIGHT] },
      { metadata: { id: "devlin2019", title: "BERT", citeKey: "devlin2019" } },
    ]));
    expect(library.folderPath).toBe("papers/Reading group");
    expect(library.snapshot.folders).toEqual([{ name: "Reading group", path: "papers/Reading group", children: [] }]);
    expect(library.snapshot.papers).toEqual([
      { id: "vaswani2017", title: "Attention", citeKey: "vaswani2017", year: 2017, summary: "We propose.", path: "papers/Reading group/vaswani2017", status: "unread", hasPdf: true },
      { id: "devlin2019", title: "BERT", citeKey: "devlin2019", path: "papers/Reading group/devlin2019", status: "unread", hasPdf: false },
    ]);
    expect(library.snapshot.pdfDirs).toEqual(["papers/Reading group/vaswani2017"]);
    expect(library.snapshot.stats).toMatchObject({ vaswani2017: { annotations: 1 } });
    expect(library.paper("vaswani2017")?.pdf).toBe(PDF);
  });

  it("drops papers whose id is not one safe path segment, and repeated ids after the first", () => {
    const ids = ["..", ".hidden", "a/b", "a\\b", "", "ok", "ok"];
    const library = createShareLibrary(manifest("F", ids.map((id, i) => ({ metadata: { id, title: `T${i}`, citeKey: "k" } }))));
    expect(library.snapshot.papers.map((p) => p.title)).toEqual(["T5"]);
    expect(library.dropped).toEqual(["..", ".hidden", "a/b", "a\\b", "", "ok"]);
  });

  it("turns a folder name that is not one safe segment into one", () => {
    expect(createShareLibrary(manifest("Group/2026", [])).folderPath).toBe("papers/Group-2026");
    expect(createShareLibrary(manifest("..", [])).folderPath).toBe("papers/Shared papers");
    expect(createShareLibrary(manifest("  ", [])).folderPath).toBe("papers/Shared papers");
  });
});
