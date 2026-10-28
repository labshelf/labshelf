import {
  movePaperFolders, removePapers, sendPaperDetails, setPaperNote, setPaperTags, type LibraryUiHost,
} from "../../src/libraryUi/paperHandlers";
import type { PaperDetails } from "../../src/libraryUi/protocol";
import type { PaperRecord } from "../../src/model";
import { ROOT_LABEL } from "../../src/library";

const paper = (id: string, title: string): PaperRecord => ({ id, title, path: `papers/${id}`, citeKey: id } as PaperRecord);
const DETAILS = { annotations: [] } as unknown as PaperDetails;

// A fake host: `events` records the order of refreshes and notices, `titles` what papers() answers after the move.
function fakeHost(over: Partial<LibraryUiHost> = {}, library: PaperRecord[] = [paper("a", "Alpha"), paper("b", "Beta")]) {
  const events: string[] = [];
  const posts: unknown[] = [];
  const host: LibraryUiHost = {
    papers: async (ids) => library.filter((p) => ids.includes(p.id)),
    post: (m) => { posts.push(m); },
    notice: (kind, text) => { events.push(`${kind}: ${text}`); },
    refresh: async () => { events.push("refresh"); },
    editTags: jest.fn(async () => ({ failed: [] })),
    setNote: jest.fn(async () => true),
    trashPapers: jest.fn(async (papers) => ({ done: papers.map((p) => p.id), failed: [] })),
    movePapers: jest.fn(async (ids) => ({ done: [...ids], failed: [] })),
    folderName: (target) => (target === "papers" ? undefined : target.split("/").pop()),
    details: jest.fn(async () => DETAILS),
    ...over,
  };
  return { host, events, posts, library };
}

describe("setPaperTags", () => {
  it("trims the tags, refreshes, and reports nothing when all are written", async () => {
    const { host, events } = fakeHost();
    await setPaperTags(host, ["a"], [" x ", ""], [" y"]);
    expect(host.editTags).toHaveBeenCalledWith(["a"], ["x"], ["y"]);
    expect(events).toEqual(["refresh"]);
  });

  it("refreshes even when papers failed, then names the first error", async () => {
    const { host, events } = fakeHost({ editTags: async () => ({ failed: [{ id: "a", error: "locked" }, { id: "b", error: "gone" }] }) });
    await setPaperTags(host, ["a", "b"], ["x"], []);
    expect(events).toEqual(["refresh", "error: 2 papers kept their tags — locked"]);
  });
});

describe("setPaperNote", () => {
  it("refreshes after the note is saved", async () => {
    const { host, events } = fakeHost();
    await setPaperNote(host, "a", "read again");
    expect(host.setNote).toHaveBeenCalledWith("a", "read again");
    expect(events).toEqual(["refresh"]);
  });

  it("reports a paper not in the library and does not refresh", async () => {
    const { host, events } = fakeHost({ setNote: async () => false });
    await setPaperNote(host, "ghost", "x");
    expect(events).toEqual(["error: The note could not be saved — the paper is not in the library"]);
  });
});

describe("movePaperFolders", () => {
  it("passes the ids as given, refreshes after a move, and names the folder", async () => {
    const { host, events } = fakeHost();
    await movePaperFolders(host, ["a", "ghost"], "papers/ML");
    expect(host.movePapers).toHaveBeenCalledWith(["a", "ghost"], "papers/ML");
    expect(events).toEqual(["refresh", "ok: 2 papers moved to ML"]);
  });

  it("names the root when folderName answers undefined", async () => {
    const { host, events } = fakeHost();
    await movePaperFolders(host, ["a"], "papers");
    expect(events).toEqual(["refresh", `ok: 1 paper moved to ${ROOT_LABEL}`]);
  });

  it("does not refresh when nothing moved, and says nothing when nothing failed", async () => {
    const { host, events } = fakeHost({ movePapers: async () => ({ done: [], failed: [] }) });
    await movePaperFolders(host, ["a"], "papers/ML");
    expect(events).toEqual([]);
  });

  it("looks the failing paper's title up after the move", async () => {
    const library = [paper("a", "Old")];
    const { host, events } = fakeHost({
      movePapers: async () => { library[0] = paper("a", "Alpha"); return { done: [], failed: [{ id: "a", error: "exists" }] }; },
    }, library);
    await movePaperFolders(host, ["a"], "papers/ML");
    expect(events).toEqual(['error: 0 moved, 1 failed — "Alpha" — exists']);
  });
});

describe("removePapers", () => {
  it("trashes the known papers, refreshes, then reports by title", async () => {
    const { host, events, library } = fakeHost();
    await removePapers(host, ["a", "ghost"]);
    expect(host.trashPapers).toHaveBeenCalledWith([library[0]]);
    expect(events).toEqual(["refresh", 'ok: Removed "Alpha"']);
  });

  it("refreshes before naming the first failure", async () => {
    const { host, events } = fakeHost({ trashPapers: async () => ({ done: ["a"], failed: [{ id: "b", error: "busy" }] }) });
    await removePapers(host, ["a", "b"]);
    expect(events).toEqual(["refresh", 'error: 1 removed, 1 failed — "Beta" — busy']);
  });
});

describe("sendPaperDetails", () => {
  it("posts the host's details of a known paper", async () => {
    const { host, posts, library } = fakeHost();
    await sendPaperDetails(host, "b");
    expect(host.details).toHaveBeenCalledWith(library[1]);
    expect(posts).toEqual([{ type: "details", id: "b", details: DETAILS }]);
  });

  it("posts nothing for a paper not in the library", async () => {
    const { host, posts } = fakeHost();
    await sendPaperDetails(host, "ghost");
    expect(posts).toEqual([]);
    expect(host.details).not.toHaveBeenCalled();
  });
});
