import {
  movePaperFolders, removePapers, sendPaperDetails, addPaperNote, editPaperNote, removePaperNote, setPaperTags, type LibraryUiHost,
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

// A fake PaperNotesStore: the three mutators are mocks, read answers one item.
function fakeNotes(over: Record<string, unknown> = {}) {
  return {
    read: jest.fn(async () => ({ segments: [{ kind: "item", id: "n1", anchor: { kind: "none" }, classes: ["labshelf-item"], attrs: [["anchor", "page=3"]], fence: "", body: "first", close: "", created: "2026-01-01T00:00:00Z", author: "me" }] })),
    addItem: jest.fn(async () => "n2"),
    editItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    ...over,
  } as never;
}

describe("paper note handlers", () => {
  it("adds an item and resends the details with the notes", async () => {
    const notes = fakeNotes();
    const { host, posts } = fakeHost({ notes });
    await addPaperNote(host, "a", "read again");
    expect((notes as never as { addItem: jest.Mock }).addItem).toHaveBeenCalledWith("a", { body: "read again" });
    expect(posts).toEqual([{ type: "details", id: "a", details: { ...DETAILS, notes: [{ id: "n1", anchor: "page=3", body: "first", created: "2026-01-01T00:00:00Z", author: "me" }] } }]);
  });

  it("edits an item without resending the details", async () => {
    const notes = fakeNotes();
    const { host, posts } = fakeHost({ notes });
    await editPaperNote(host, "a", "n1", "changed");
    expect((notes as never as { editItem: jest.Mock }).editItem).toHaveBeenCalledWith("a", "n1", "changed");
    expect(posts).toEqual([]);
  });

  it("removes an item and resends the details", async () => {
    const notes = fakeNotes();
    const { host, posts } = fakeHost({ notes });
    await removePaperNote(host, "a", "n1");
    expect((notes as never as { removeItem: jest.Mock }).removeItem).toHaveBeenCalledWith("a", "n1");
    expect(posts).toHaveLength(1);
  });

  it("shows an error notice when the store fails, and sends no details", async () => {
    const { host, events, posts } = fakeHost({ notes: fakeNotes({ editItem: async () => { throw new Error("disk full"); } }) });
    await editPaperNote(host, "a", "n1", "x");
    expect(events).toEqual(["error: The note could not be saved — disk full"]);
    expect(posts).toEqual([]);
  });

  it("leaves the notes out of the details when the host serves none", async () => {
    const { host, posts } = fakeHost();
    await sendPaperDetails(host, "a");
    expect(posts).toEqual([{ type: "details", id: "a", details: DETAILS }]);
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
