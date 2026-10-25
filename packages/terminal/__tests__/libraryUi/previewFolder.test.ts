import type { FolderNode, LibrarySnapshot, PaperEntry, PaperRecord, ReadingStatus } from "@labshelf/core";

import { folderPreview, libraryOverview } from "../../src/libraryUi/preview";
import { theme } from "../../src/libraryUi/theme";
import { entry, text } from "../fixtures/previewEntries";

function snapshotOf(entries: PaperEntry[], collections: FolderNode[]): LibrarySnapshot {
  return {
    root: "/lib",
    papers: new Map(entries.map((e) => [e.record.id, e])),
    collections: new Map(collections.map((node) => [node.rel, node])),
    duplicates: [],
    orphans: [],
    scannedAt: 1,
  };
}

function node(rel: string, children: string[], paperIds: string[], total: number): FolderNode {
  const parts = rel.split("/").filter(Boolean);
  return {
    rel,
    name: rel ? parts[parts.length - 1]! : "papers",
    parent: rel ? parts.slice(0, -1).join("/") : undefined,
    children,
    paperIds,
    total,
  };
}

function paper(id: string, status: ReadingStatus, collection: string, extra: Partial<PaperRecord> = {}): PaperEntry {
  return entry({ id, title: `Paper ${id}`, citeKey: id, status, ...extra }, collection);
}

describe("folderPreview and libraryOverview", () => {
  const p0 = paper("p0", "unread", "");
  const p1 = paper("p1", "reading", "ML");
  const p2 = paper("p2", "done", "ML/NLP");
  const snapshot = snapshotOf([p0, p1, p2], [
    node("", ["ML"], ["p0"], 3),
    node("ML", ["ML/NLP"], ["p1"], 2),
    node("ML/NLP", [], ["p2"], 1),
    node("Empty", [], [], 0),
  ]);

  it("summarizes a folder: counts, status breakdown, subfolders and its own papers", () => {
    const lines = text(folderPreview(snapshot.collections.get("ML")!, snapshot, [p1]));
    expect(lines).toEqual([
      "ML",
      "2 papers · 1 subfolder",
      "◐ 1 reading  ○ 0 unread  ● 1 done",
      "",
      "NLP/ 1",
      "",
      "◐ Paper p1",
    ]);
  });

  it("uses the given label as the title", () => {
    expect(text(folderPreview(snapshot.collections.get("ML/NLP")!, snapshot, [p2], "ML › NLP"))[0]).toBe("ML › NLP");
  });

  it("uses the singular for one paper and omits the subfolder count when there are none", () => {
    const lines = text(folderPreview(snapshot.collections.get("ML/NLP")!, snapshot, [p2]));
    expect(lines[1]).toBe("1 paper");
    expect(lines).toEqual(["NLP", "1 paper", "◐ 0 reading  ○ 0 unread  ● 1 done", "", "● Paper p2"]);
  });

  it("counts statuses over the whole subtree and over everything for the root", () => {
    const root = text(folderPreview(snapshot.collections.get("")!, snapshot, [p0]));
    expect(root[2]).toBe("◐ 1 reading  ○ 1 unread  ● 1 done");
  });

  it("says when a folder is empty", () => {
    expect(text(folderPreview(snapshot.collections.get("Empty")!, snapshot, []))).toEqual(["Empty", "0 papers", "", "Empty folder"]);
  });

  it("draws papers without a PDF in the no-PDF style", () => {
    const noPdf = paper("p3", "unread", "Empty", { hasPdf: false });
    const lines = folderPreview(node("Empty", [], ["p3"], 1), snapshotOf([noPdf], []), [noPdf]);
    const row = lines[lines.length - 1]!;
    expect(row[1]!.style).toEqual(theme.noPdf);
  });

  it("summarizes the library", () => {
    expect(text(libraryOverview(snapshot))).toEqual([
      "Library",
      "3 papers",
      "",
      "◐ 1 reading",
      "○ 1 unread",
      "● 1 done",
      "",
      "3 with PDF",
    ]);
  });

  it("counts only papers with a PDF here in the overview", () => {
    const withoutPdf = snapshotOf([p0, paper("p9", "done", "", { hasPdf: false })], []);
    const lines = text(libraryOverview(withoutPdf));
    expect(lines[1]).toBe("2 papers");
    expect(lines[lines.length - 1]).toBe("1 with PDF");
  });

  it("summarizes an empty library", () => {
    expect(text(libraryOverview(snapshotOf([], [])))).toEqual([
      "Library", "0 papers", "", "◐ 0 reading", "○ 0 unread", "● 0 done", "", "0 with PDF",
    ]);
  });
});
