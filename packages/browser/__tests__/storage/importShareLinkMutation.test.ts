// Pins the browser import of a share link: papers land in a new folder under papers/, their records are cached, and the summary names duplicates and missing PDFs.
import { buildShare, formatShareLink, type ILogger, type PaperRecord, type ShareReader } from "@labshelf/core";
import { createLibraryMutations } from "../../src/storage/libraryMutations";
import { fakeFiles } from "../support/fakeIdb";

jest.mock("../../src/storage/idbDatabase", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

const mockCache = new Map<string, PaperRecord>();
jest.mock("../../src/storage/paperRecordStore", () => ({
  listAllRecords: async () => [...mockCache.values()],
  upsertRecord: async (record: PaperRecord) => { mockCache.set(record.id, record); },
  deleteRecord: async (id: string) => { mockCache.delete(id); },
}));

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const RELAY = "https://labshelf-relay.example.workers.dev";

function paper(id: string, over: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: `Title of ${id}`, citeKey: id, path: `papers/Mine/${id}`, status: "unread", ...over };
}

/** A reader that serves the built share, except the blobs named in `withheld`. */
async function sharedFolder(withheld: "pdf" | "none"): Promise<{ link: string; reader: ShareReader }> {
  const share = await buildShare({
    folderName: "Reading group", withAnnotations: false,
    papers: [
      { metadata: paper("known", { doi: "10.1000/known" }) },
      { metadata: paper("fresh", { doi: "10.1000/fresh" }), pdf: new TextEncoder().encode("%PDF-1.7 shared") },
    ],
  });
  const blobs = new Map(share.blobs.map((blob) => [blob.hash, blob.bytes]));
  const reader: ShareReader = {
    fetchManifest: async (id) => (id === share.shareId ? share.sealedManifest : undefined),
    fetchBlob: async (_id, hash) => (withheld === "pdf" ? undefined : blobs.get(hash)),
  };
  return { link: formatShareLink({ relayUrl: RELAY, shareId: share.shareId, key: share.key }), reader };
}

beforeEach(() => {
  fakeFiles.clear();
  mockCache.clear();
});

describe("importShareLink", () => {
  it("imports the papers the library lacks into the shared folder's name, caches them, and reports duplicates and missing PDFs", async () => {
    mockCache.set("mine", paper("mine", { doi: "10.1000/known" }));
    const { link, reader } = await sharedFolder("pdf");
    const result = await createLibraryMutations(logger).importShareLink({ text: link, readerFor: () => reader });

    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;
    expect(result.summary.folder).toBe("papers/Reading group");
    expect(result.summary.duplicates).toEqual([{ title: "Title of known", existingId: "mine" }]);
    expect(result.summary.missingPdfs).toEqual(["Title of fresh"]);
    expect(result.summary.added.map((record) => record.path)).toEqual(["papers/Reading group/fresh"]);
    expect(mockCache.get("fresh")).toMatchObject({ path: "papers/Reading group/fresh", doi: "10.1000/fresh" });
  });

  it("writes the PDF the relay serves", async () => {
    const { link, reader } = await sharedFolder("none");
    const result = await createLibraryMutations(logger).importShareLink({ text: link, readerFor: () => reader });

    expect(result.status === "imported" && result.summary.missingPdfs).toEqual([]);
    expect(fakeFiles.has("papers/Reading group/fresh/paper.pdf")).toBe(true);
  });

  it("refuses a link that does not parse and writes nothing", async () => {
    const result = await createLibraryMutations(logger).importShareLink({ text: "https://labshelf.org/share/#nope", readerFor: () => { throw new Error("unused"); } });

    expect(result.status).toBe("refused");
    expect(fakeFiles.size).toBe(0);
    expect(mockCache.size).toBe(0);
  });
});
