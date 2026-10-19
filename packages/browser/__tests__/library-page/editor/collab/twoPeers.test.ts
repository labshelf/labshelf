/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Two members of one share: an editor bound to its file doc sends and shows edits and cursors, and comments reach both.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  attachAwareness, createShareSession, deriveAwarenessKey, deriveContentKey, toRelativeSelection,
  type ILogger, type PeerId, type PeerTransport, type PresenceHandle, type ShareSession,
} from "@labshelf/core";
import { collabExtensions, createLiveCommentThreads } from "../../../../src/library-page/editor/collab";

const SHARE_ID = "f".repeat(32);
const SHARE_KEY = new Uint8Array(16).fill(1);
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

/** Delivers frames between the peers that joined, each on a later task, as a relay would. */
function loopback(): (id: PeerId) => PeerTransport {
  const peers = new Map<PeerId, { message: Set<(from: PeerId, bytes: Uint8Array) => void>; join: Set<(peer: PeerId) => void> }>();
  return (id) => {
    const own = { message: new Set<(from: PeerId, bytes: Uint8Array) => void>(), join: new Set<(peer: PeerId) => void>() };
    const others = (): PeerId[] => [...peers.keys()].filter((peer) => peer !== id);
    const subscribe = <T>(set: Set<T>, fn: T) => { set.add(fn); return () => { set.delete(fn); }; };
    // TRAP: each pair is announced once, by the later peer, as a relay does; a second announcement resets the mesh link, and a
    // frame sent on the old link can then take the new link's sequence number, so the next frame is dropped as a duplicate.
    const earlier = others();
    peers.set(id, own);
    setTimeout(() => { for (const other of earlier) { peers.get(other)?.join.forEach((fn) => fn(id)); own.join.forEach((fn) => fn(other)); } }, 0);
    return {
      get peers() { return others(); },
      send: (to, bytes) => {
        for (const target of to === "all" ? others() : [to]) { const copy = bytes.slice(); setTimeout(() => peers.get(target)?.message.forEach((fn) => fn(id, copy)), 0); }
      },
      onMessage: (fn) => subscribe(own.message, fn),
      onPeerJoin: (fn) => subscribe(own.join, fn),
      onPeerLeave: () => () => undefined,
      close: async () => { peers.delete(id); },
    };
  };
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
  expect(done()).toBe(true);
}

interface Member { session: ShareSession; presence: PresenceHandle }

describe("a shared file between two members", () => {
  let members: Member[];
  let view: EditorView;
  beforeEach(async () => {
    const join = loopback();
    const [contentKey, awarenessKey] = [await deriveContentKey(SHARE_KEY), await deriveAwarenessKey(SHARE_KEY)];
    members = ["a", "b"].map((id) => {
      const session = createShareSession({ shareId: SHARE_ID, contentKey, transport: join(id), logger });
      return { session, presence: attachAwareness(session, { awarenessKey, logger }) };
    });
    const [a] = members;
    const text = a!.session.openDoc("main.tex").getText("content");
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: text.toString(), extensions: collabExtensions({ text, presence: a!.presence, file: "main.tex", name: "Ada" }) }),
    });
  });
  afterEach(async () => {
    view.destroy();
    for (const member of members) { await member.presence.close(); await member.session.close(); }
  });

  it("sends an edit made in the editor to the other member", async () => {
    const other = members[1]!.session.openDoc("main.tex").getText("content");
    view.dispatch({ changes: { from: 0, insert: "hello" } });
    await until(() => other.toString() === "hello");
  });

  it("shows an edit of the other member in the editor", async () => {
    const other = members[1]!.session.openDoc("main.tex").getText("content");
    other.insert(0, "from b");
    await until(() => view.state.doc.toString() === "from b");
  });

  it("draws the other member's cursor with their name", async () => {
    const other = members[1]!.session.openDoc("main.tex").getText("content");
    other.insert(0, "abc");
    await until(() => view.state.doc.toString() === "abc");
    members[1]!.presence.setLocal({ name: "Bea", colour: "#000000", file: "main.tex", ...toRelativeSelection(other, { anchor: 1, head: 2 }) });
    await until(() => view.dom.querySelector('[data-peer-name="Bea"]') !== null);
  });

  it("brings a comment added by one member to the other", async () => {
    view.dispatch({ changes: { from: 0, insert: "a sentence to discuss" } });
    const [a, b] = members.map(({ session }) => createLiveCommentThreads({ session, projectId: "p", author: () => "Ada", logger }));
    await a!.addComment("p", "main.tex", { start: 2, end: 10 }, "Is this right?");
    await until(() => members[1]!.session.openDoc("main.tex").getText("content").toString() === "a sentence to discuss");
    let threads: Awaited<ReturnType<NonNullable<typeof b>["threads"]>> = [];
    await until(() => { void b!.threads("p", "main.tex").then((found) => { threads = found; }); return threads.length === 1; });
    expect(threads[0]!.comments[0]!.body).toBe("Is this right?");
    expect(threads[0]!.line).toBe(1);
  });
});
