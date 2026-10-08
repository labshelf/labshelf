import { libraryChanged, type NamespaceResult, type SyncResult } from "@labshelf/core";

function ns(namespace: NamespaceResult["namespace"], patch: Partial<NamespaceResult> = {}): NamespaceResult {
  return { namespace, uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], ...patch } as NamespaceResult;
}

function result(...namespaces: NamespaceResult[]): SyncResult {
  return { providerId: "fake", startedAt: "", finishedAt: "", namespaces } as SyncResult;
}

describe("libraryChanged", () => {
  it("is true when the library namespace downloaded, deleted locally or conflicted", () => {
    expect(libraryChanged(result(ns("library", { downloaded: 1 }), ns("appdata")))).toBe(true);
    expect(libraryChanged(result(ns("library", { deletedLocal: 1 }), ns("appdata")))).toBe(true);
    expect(libraryChanged(result(ns("library", { conflicts: ["a"] }), ns("appdata")))).toBe(true);
  });

  it("is false when only uploads or remote deletions happened", () => {
    expect(libraryChanged(result(ns("library", { uploaded: 3, deletedRemote: 1 }), ns("appdata", { uploaded: 2 })))).toBe(false);
  });

  it("is false when only the appdata namespace changed locally", () => {
    expect(libraryChanged(result(ns("library"), ns("appdata", { downloaded: 4, deletedLocal: 1, conflicts: ["x"] })))).toBe(false);
  });
});
