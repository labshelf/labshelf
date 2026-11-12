// Pins the replica hub: one refcounted Y.Doc per file key per page, kept in step with other pages over a channel, seeded from disk when no peer holds it.
import * as Y from "yjs";
import {
  createReplicaHub,
  deriveReplicaKind,
  replicaChannelName,
  type Replica,
  type ReplicaChannel,
  type ReplicaHub,
  type ReplicaKind,
  type ReplicaMessage,
} from "../../src/localSync/replicaHub.js";

// ---- Wire helpers (y-protocols sync messages: tag, then a var-length byte array)

const STEP1 = 0;
const STEP2 = 1;
const UPDATE = 2;

function varUint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest > 127) { out.push(128 | (rest & 127)); rest = Math.floor(rest / 128); }
  out.push(rest);
  return out;
}

function frame(tag: number, payload: Uint8Array): Uint8Array {
  return Uint8Array.from([tag, ...varUint(payload.length), ...payload]);
}

function readPayload(bytes: Uint8Array): Uint8Array {
  let index = 1;
  let length = 0;
  let shift = 1;
  while (bytes[index] >= 128) { length += (bytes[index] & 127) * shift; shift *= 128; index += 1; }
  length += bytes[index] * shift;
  return bytes.slice(index + 1, index + 1 + length);
}

const step1Of = (doc: Y.Doc): Uint8Array => frame(STEP1, Y.encodeStateVector(doc));
const updateOf = (doc: Y.Doc): Uint8Array => frame(UPDATE, Y.encodeStateAsUpdate(doc));

/** A doc in the text layout holding `text`, as an update message from a peer. */
function textUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, text);
  return updateOf(doc);
}

// ---- In-memory bus: every port gets what the others post, on a microtask, as copies

interface Posted { readonly message: ReplicaMessage }
type TestChannel = ReplicaChannel & { inject(message: ReplicaMessage): void };

function createBus() {
  const ports: Set<(message: ReplicaMessage) => void>[] = [];
  const posts: Posted[] = [];
  function channel(): TestChannel {
    const listeners = new Set<(message: ReplicaMessage) => void>();
    ports.push(listeners);
    return {
      post(message) {
        posts.push({ message });
        for (const other of ports) {
          if (other === listeners) { continue; }
          queueMicrotask(() => {
            for (const listener of [...other]) { listener({ ...message, bytes: new Uint8Array(message.bytes) }); }
          });
        }
      },
      onMessage(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      inject(message) { for (const listener of [...listeners]) { listener(message); } },
    };
  }
  return { channel, posts, from: (pageId: string) => posts.map((posted) => posted.message).filter((message) => message.from === pageId) };
}

// ---- Manual clock

function createClock() {
  let time = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => time,
    after(ms: number, fn: () => void) {
      const timer = { at: time + ms, fn, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    advance(ms: number) {
      time += ms;
      for (;;) {
        const due = timers.filter((timer) => timer.live && timer.at <= time).sort((a, b) => a.at - b.at)[0];
        if (!due) { return; }
        due.live = false;
        due.fn();
      }
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const disk = (text: string) => jest.fn(async () => text);

const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => { done = true; }, () => { done = true; });
  await flush();
  return done;
};

// ---- Fixtures

const item = (id: string, body: string): string => `::: {#${id} .labshelf-item author="Ana"}\n${body}\n:::\n`;
const qmdText = `Intro text.\n\n${item("n-AAA", "First body.")}\n${item("n-BBB", "Second body.")}\n${item("n-CCC", "Third body.")}`;
const texText = "\\section{Intro}\nHello world.\n";

const kinds: [ReplicaKind, string, string][] = [
  ["text", "main.tex", texText],
  ["qmd", "notes.qmd", qmdText],
];

function setup() {
  const bus = createBus();
  const clock = createClock();
  const channels: Record<string, TestChannel> = {};
  const hubs: ReplicaHub[] = [];
  function hub(pageId: string): ReplicaHub {
    const channel = bus.channel();
    channels[pageId] = channel;
    const created = createReplicaHub({ channel, scheduler: clock, pageId });
    hubs.push(created);
    return created;
  }
  return { bus, clock, channels, hub, closeAll: () => hubs.forEach((created) => created.close()) };
}

/** Hub "A" holds `key` seeded from disk, hub "B" has just joined it from the peer. */
async function pair(kind: ReplicaKind, key: string, text: string) {
  const env = setup();
  const hubA = env.hub("A");
  const hubB = env.hub("B");
  const readA = disk(text);
  const readB = disk("never read");
  const a = hubA.open(key, kind, readA);
  env.clock.advance(200);
  await a.ready;
  const b = hubB.open(key, kind, readB);
  await flush();
  await b.ready;
  await flush();
  return { ...env, hubA, hubB, a, b, readA, readB };
}

describe("replica hub", () => {
  it("1.2a names the channel after the library and derives the kind from the file name", () => {
    expect(replicaChannelName("lib-1")).toBe("labshelf:files:lib-1");
    expect(deriveReplicaKind("papers/p1/main.tex")).toBe("text");
    expect(deriveReplicaKind("papers/p1/notes.qmd")).toBe("qmd");
  });

  describe.each(kinds)("%s replica", (kind, key, text) => {
    it(`1.2a ${kind} replica with no peer resolves disk after peerWaitMs with the disk text`, async () => {
      const env = setup();
      const read = disk(text);
      const replica = env.hub("A").open(key, kind, read);
      expect(replica.key).toBe(key);
      expect(replica.kind).toBe(kind);
      env.clock.advance(199);
      expect(await settled(replica.ready)).toBe(false);
      env.clock.advance(1);
      await expect(replica.ready).resolves.toBe("disk");
      expect(replica.text()).toBe(text);
      expect(read).toHaveBeenCalledTimes(1);
    });

    it(`1.2a ${kind} replica posts a step1 to all when opened`, async () => {
      const env = setup();
      env.hub("A").open(key, kind, disk(text));
      const sent = env.bus.from("A");
      expect(sent).toHaveLength(1);
      expect(sent[0].key).toBe(key);
      expect(sent[0].to).toBeUndefined();
      expect(sent[0].bytes[0]).toBe(STEP1);
    });

    it(`1.2b ${kind} replica opened while a peer holds the key resolves peer without reading the disk`, async () => {
      const { a, b, readA, readB } = await pair(kind, key, text);
      expect(await b.ready).toBe("peer");
      expect(readB).not.toHaveBeenCalled();
      expect(readA).toHaveBeenCalledTimes(1);
      expect(b.text()).toBe(text);
      expect(a.text()).toBe(text);
    });

    it(`1.2c ${kind} edit by replace in one hub shows in the other, both ways`, async () => {
      const { a, b } = await pair(kind, key, text);
      const edited = kind === "text" ? text.replace("Hello", "Goodbye") : text.replace("First body.", "First body, edited.");
      a.replace(edited);
      await flush();
      expect(b.text()).toBe(edited);
      const again = kind === "text" ? edited + "More.\n" : edited.replace("Third body.", "Third body, edited.");
      b.replace(again);
      await flush();
      expect(a.text()).toBe(again);
    });

    it(`1.2c ${kind} edits made at the same time in different places of both are both kept in both`, async () => {
      const { a, b } = await pair(kind, key, text);
      const fromA = kind === "text" ? text.replace("Intro", "Start") : text.replace("First body.", "First body by A.");
      const fromB = kind === "text" ? text.replace("world", "there") : text.replace("Third body.", "Third body by B.");
      a.replace(fromA);
      b.replace(fromB);
      await flush();
      const merged = kind === "text"
        ? text.replace("Intro", "Start").replace("world", "there")
        : text.replace("First body.", "First body by A.").replace("Third body.", "Third body by B.");
      expect(a.text()).toBe(merged);
      expect(b.text()).toBe(merged);
    });

    it(`1.2e ${kind} two hubs opening the same key at once with the same disk text both seed from disk and hold the text once`, async () => {
      const env = setup();
      const readA = disk(text);
      const readB = disk(text);
      const a = env.hub("A").open(key, kind, readA);
      const b = env.hub("B").open(key, kind, readB);
      await flush();
      env.clock.advance(200);
      expect(await Promise.all([a.ready, b.ready])).toEqual(["disk", "disk"]);
      expect(readA).toHaveBeenCalledTimes(1);
      expect(readB).toHaveBeenCalledTimes(1);
      await flush();
      expect(a.text()).toBe(text);
      expect(b.text()).toBe(text);

      const edited = kind === "text" ? text + "More.\n" : text.replace("First body.", "First body, edited.");
      a.replace(edited);
      await flush();
      expect(a.text()).toBe(edited);
      expect(b.text()).toBe(edited);

      const edited2 = kind === "text" ? "Top.\n" + edited : edited.replace("Second body.", "Second body, edited.");
      b.replace(edited2);
      await flush();
      expect(a.text()).toBe(edited2);
      expect(b.text()).toBe(edited2);
    });
  });

  it("1.2c a direct Y.Text insert in one text replica shows in the other", async () => {
    const { a, b } = await pair("text", "main.tex", texText);
    a.doc.getText("content").insert(0, "% note\n");
    await flush();
    expect(b.text()).toBe("% note\n" + texText);
    b.doc.getText("content").insert(b.text().length, "% end\n");
    await flush();
    expect(a.text()).toBe("% note\n" + texText + "% end\n");
  });

  it("1.2d replace changes only the span between the common prefix and suffix", async () => {
    const { a, b } = await pair("text", "main.tex", "the quick brown fox jumps");
    const text = a.doc.getText("content");
    const inPrefix = Y.createRelativePositionFromTypeIndex(text, 4);
    const inSuffix = Y.createRelativePositionFromTypeIndex(text, 17);
    a.replace("the quick red fox jumps");
    expect(a.text()).toBe("the quick red fox jumps");
    const before = Y.createAbsolutePositionFromRelativePosition(inPrefix, a.doc);
    const after = Y.createAbsolutePositionFromRelativePosition(inSuffix, a.doc);
    expect(before?.index).toBe(4);
    expect(a.text().slice(before?.index)).toBe("quick red fox jumps");
    expect(after?.index).toBe(15);
    expect(a.text().slice(after?.index)).toBe("ox jumps");
    await flush();
    expect(b.text()).toBe("the quick red fox jumps");
  });

  it("1.2d replace with an insertion keeps a position after the inserted span on the same text", async () => {
    const { a } = await pair("text", "main.tex", "alpha omega");
    const text = a.doc.getText("content");
    const inSuffix = Y.createRelativePositionFromTypeIndex(text, 8);
    const inPrefix = Y.createRelativePositionFromTypeIndex(text, 2);
    a.replace("alpha beta omega");
    expect(Y.createAbsolutePositionFromRelativePosition(inPrefix, a.doc)?.index).toBe(2);
    expect(Y.createAbsolutePositionFromRelativePosition(inSuffix, a.doc)?.index).toBe(13);
  });

  it("1.2d replace with the same text changes nothing and posts nothing", async () => {
    const { a, bus } = await pair("text", "main.tex", texText);
    const before = bus.posts.length;
    a.replace(texText);
    await flush();
    expect(bus.posts.length).toBe(before);
    expect(a.text()).toBe(texText);
  });

  it("1.2d replace on a qmd replica changes the edited item only", async () => {
    const { a, b } = await pair("qmd", "notes.qmd", qmdText);
    const edited = qmdText.replace("Second body.", "Second body, edited.");
    a.replace(edited);
    expect(a.text()).toBe(edited);
    await flush();
    expect(b.text()).toBe(edited);
  });

  it("1.2f open twice in one hub returns the same replica", () => {
    const env = setup();
    const hub = env.hub("A");
    const first = hub.open("main.tex", "text", disk(texText));
    const second = hub.open("main.tex", "text", disk(texText));
    expect(second).toBe(first);
    expect(hub.open("other.tex", "text", disk(texText))).not.toBe(first);
  });

  it("1.2f the key stays held after one of two releases", async () => {
    const env = setup();
    const hubA = env.hub("A");
    const hubB = env.hub("B");
    const first = hubA.open("main.tex", "text", disk(texText));
    hubA.open("main.tex", "text", disk(texText));
    env.clock.advance(200);
    await first.ready;
    first.release();
    const joined = hubB.open("main.tex", "text", disk("never read"));
    await flush();
    expect(await joined.ready).toBe("peer");
    expect(joined.text()).toBe(texText);
  });

  it("1.2f after two releases the key is not held, messages for it are ignored and a new open starts afresh", async () => {
    const env = setup();
    const hub = env.hub("A");
    const first = hub.open("main.tex", "text", disk(texText));
    hub.open("main.tex", "text", disk(texText));
    env.clock.advance(200);
    await first.ready;
    first.release();
    first.release();
    first.release();

    const sent = env.bus.from("A").length;
    env.channels.A.inject({ key: "main.tex", from: "B", bytes: step1Of(new Y.Doc()) });
    await flush();
    expect(env.bus.from("A")).toHaveLength(sent);

    const read = disk("fresh from disk\n");
    const second = hub.open("main.tex", "text", read);
    expect(second).not.toBe(first);
    expect(env.bus.from("A")).toHaveLength(sent + 1);
    expect(env.bus.from("A")[sent].bytes[0]).toBe(STEP1);
    expect(await settled(second.ready)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    env.clock.advance(200);
    expect(await second.ready).toBe("disk");
    expect(read).toHaveBeenCalledTimes(1);
    expect(second.text()).toBe("fresh from disk\n");
  });

  it("1.2f a released key is not answered to a peer that opens it", async () => {
    const env = setup();
    const hubA = env.hub("A");
    const hubB = env.hub("B");
    const held = hubA.open("main.tex", "text", disk(texText));
    env.clock.advance(200);
    await held.ready;
    held.release();
    const readB = disk("from B disk\n");
    const joined = hubB.open("main.tex", "text", readB);
    await flush();
    env.clock.advance(200);
    expect(await joined.ready).toBe("disk");
    expect(readB).toHaveBeenCalledTimes(1);
    expect(joined.text()).toBe("from B disk\n");
  });

  it("1.2f opening a held key with another kind throws", () => {
    const env = setup();
    const hub = env.hub("A");
    hub.open("notes.qmd", "qmd", disk(qmdText));
    expect(() => hub.open("notes.qmd", "text", disk(qmdText))).toThrow();
    hub.open("main.tex", "text", disk(texText));
    expect(() => hub.open("main.tex", "qmd", disk(texText))).toThrow();
  });

  describe("1.2g addressing", () => {
    async function holder(): Promise<{ env: ReturnType<typeof setup>; replica: Replica }> {
      const env = setup();
      const replica = env.hub("A").open("main.tex", "text", disk(texText));
      env.clock.advance(200);
      await replica.ready;
      await flush();
      return { env, replica };
    }

    it("1.2g a ready replica answers a step1 for its key with a step2 and a step1 addressed to the sender", async () => {
      const { env, replica } = await holder();
      const sent = env.bus.from("A").length;
      env.channels.A.inject({ key: "main.tex", from: "B", bytes: step1Of(new Y.Doc()) });
      await flush();
      const replies = env.bus.from("A").slice(sent);
      expect(replies.length).toBeGreaterThanOrEqual(2);
      for (const reply of replies) { expect(reply.to).toBe("B"); expect(reply.key).toBe("main.tex"); }
      const step2 = replies.find((reply) => reply.bytes[0] === STEP2);
      expect(step2).toBeDefined();
      expect(replies.some((reply) => reply.bytes[0] === STEP1)).toBe(true);
      const peer = new Y.Doc();
      Y.applyUpdate(peer, readPayload(step2!.bytes));
      expect(peer.getText("content").toString()).toBe(replica.text());
    });

    it("1.2g a message addressed to another page is ignored", async () => {
      const { env, replica } = await holder();
      const sent = env.bus.from("A").length;
      env.channels.A.inject({ key: "main.tex", from: "B", to: "C", bytes: step1Of(new Y.Doc()) });
      env.channels.A.inject({ key: "main.tex", from: "B", to: "C", bytes: textUpdate("ZZZ") });
      await flush();
      expect(env.bus.from("A")).toHaveLength(sent);
      expect(replica.text()).toBe(texText);
    });

    it("1.2g a message from this page is ignored", async () => {
      const { env, replica } = await holder();
      const sent = env.bus.from("A").length;
      env.channels.A.inject({ key: "main.tex", from: "A", bytes: step1Of(new Y.Doc()) });
      env.channels.A.inject({ key: "main.tex", from: "A", bytes: textUpdate("ZZZ") });
      await flush();
      expect(env.bus.from("A")).toHaveLength(sent);
      expect(replica.text()).toBe(texText);
    });

    it("1.2g a message for a key this page does not hold is ignored", async () => {
      const { env, replica } = await holder();
      const sent = env.bus.from("A").length;
      env.channels.A.inject({ key: "other.tex", from: "B", bytes: step1Of(new Y.Doc()) });
      env.channels.A.inject({ key: "other.tex", from: "B", bytes: textUpdate("ZZZ") });
      await flush();
      expect(env.bus.from("A")).toHaveLength(sent);
      expect(replica.text()).toBe(texText);
    });

    it("1.2g an update addressed to this page, or to all, is applied", async () => {
      const { env, replica } = await holder();
      env.channels.A.inject({ key: "main.tex", from: "B", to: "A", bytes: textUpdate("YYY") });
      await flush();
      expect(replica.text()).toContain("YYY");
      env.channels.A.inject({ key: "main.tex", from: "B", bytes: textUpdate("ZZZ") });
      await flush();
      expect(replica.text()).toContain("ZZZ");
      expect(replica.text()).toContain("YYY");
      expect(replica.text()).toContain("Hello world.");
    });

    it("1.2g a waiting replica does not answer a step1", async () => {
      const env = setup();
      const replica = env.hub("A").open("main.tex", "text", disk(texText));
      await flush();
      const sent = env.bus.from("A").length;
      env.channels.A.inject({ key: "main.tex", from: "B", bytes: step1Of(new Y.Doc()) });
      await flush();
      expect(env.bus.from("A")).toHaveLength(sent);
      expect(env.bus.from("A").some((message) => message.bytes[0] === STEP2)).toBe(false);
      env.clock.advance(200);
      expect(await replica.ready).toBe("disk");
    });
  });
});
