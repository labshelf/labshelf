/** Verifies editableFromReplica: a text replica binds its Y.Text as collab, a qmd replica binds its doc as live, and release gives the replica back once. */
import * as Y from "yjs";
import { readFileText } from "../../../../src/collab/sharedFiles";
import { createReplicaHub, type Replica, type ReplicaChannel, type ReplicaHub, type ReplicaKind } from "../../../../src/localSync/replicaHub";
import { editableFromReplica } from "../../../../src/writing/consult/dom/editableFile";

function fakeReplica(kind: ReplicaKind): Replica & { released: jest.Mock } {
  const doc = new Y.Doc();
  const released = jest.fn();
  return {
    key: "k", kind, doc, released,
    ready: Promise.resolve("disk" as const),
    text: () => readFileText(doc).toString(),
    replace: () => undefined,
    release: released,
  };
}

const quietChannel: ReplicaChannel = { post: () => undefined, onMessage: () => () => undefined };

describe("editableFromReplica", () => {
  it("7.1e maps a text replica to a text file with the collab binding on its Y.Text", () => {
    const replica = fakeReplica("text");
    readFileText(replica.doc).insert(0, "hello");
    const file = editableFromReplica(replica, "src/a.py");
    expect(file.kind).toBe("text");
    expect(file.path).toBe("src/a.py");
    if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab binding"); }
    expect(file.binding.collab.text).toBe(readFileText(replica.doc));
    expect(file.binding.collab.text.toString()).toBe("hello");
  });

  it("7.1e maps a qmd replica to a qmd file with the live binding on its doc and the given persist", async () => {
    const replica = fakeReplica("qmd");
    const persist = jest.fn(async () => undefined);
    const file = editableFromReplica(replica, "notes/a.qmd", persist);
    expect(file.kind).toBe("qmd");
    expect(file.path).toBe("notes/a.qmd");
    if (file.kind !== "qmd" || !("live" in file.binding)) { throw new Error("expected a live binding"); }
    expect(file.binding.live.doc).toBe(replica.doc);
    expect(file.binding.live.persist).toBe(persist);
  });

  it("7.1e gives a qmd replica a persist that does nothing when none is passed", async () => {
    const file = editableFromReplica(fakeReplica("qmd"), "n.qmd");
    if (file.kind !== "qmd" || !("live" in file.binding)) { throw new Error("expected a live binding"); }
    await expect(Promise.resolve(file.binding.live.persist())).resolves.toBeUndefined();
  });

  it("7.1e does not release the replica before release is called", () => {
    const replica = fakeReplica("text");
    editableFromReplica(replica, "a.txt");
    expect(replica.released).not.toHaveBeenCalled();
  });

  it("7.1e releases a text replica exactly once however often release is called", () => {
    const replica = fakeReplica("text");
    const file = editableFromReplica(replica, "a.txt");
    file.release();
    file.release();
    file.release();
    expect(replica.released).toHaveBeenCalledTimes(1);
  });

  it("7.1e releases a qmd replica exactly once however often release is called", () => {
    const replica = fakeReplica("qmd");
    const file = editableFromReplica(replica, "a.qmd");
    file.release();
    file.release();
    expect(replica.released).toHaveBeenCalledTimes(1);
  });

  describe("with a replica from the hub", () => {
    let hub: ReplicaHub;
    beforeEach(() => { hub = createReplicaHub({ channel: quietChannel, peerWaitMs: 0 }); });
    afterEach(() => { hub.close(); });

    it("7.1e binds the disk text of a text replica through collab and edits reach the replica", async () => {
      const replica = hub.open("a.txt", "text", async () => "from disk");
      await replica.ready;
      const file = editableFromReplica(replica, "a.txt");
      if (file.kind !== "text" || !("collab" in file.binding)) { throw new Error("expected a collab binding"); }
      expect(file.binding.collab.text.toString()).toBe("from disk");
      file.binding.collab.text.insert(0, ">> ");
      expect(replica.text()).toBe(">> from disk");
      file.release();
    });

    it("7.1e binds the doc of a qmd replica through live", async () => {
      const replica = hub.open("n.qmd", "qmd", async () => "---\ntitle: T\n---\n\nbody\n");
      await replica.ready;
      const file = editableFromReplica(replica, "n.qmd");
      if (file.kind !== "qmd" || !("live" in file.binding)) { throw new Error("expected a live binding"); }
      expect(file.binding.live.doc).toBe(replica.doc);
      file.release();
    });

    it("7.1e keeps a second holder of the same key alive when the file is released twice", async () => {
      const first = hub.open("a.txt", "text", async () => "x");
      const second = hub.open("a.txt", "text", async () => "x");
      await first.ready;
      const file = editableFromReplica(first, "a.txt");
      file.release();
      file.release();
      expect(second.text()).toBe("x");
      second.release();
    });
  });
});
