/** Pins the conversation field of share presence: its validation on receipt and its survival across editor cursor updates. */
import { attachPresence, isPeerPresence, type PresenceStore, type PresenceState } from "../../src/collab/index";
import { FakeClock, FakeNetwork } from "./fakeNetwork";
import { awarenessKey, openSession, type TestClient } from "./testSession";

const base: PresenceState = { name: "Ana", colour: "#ff0000", file: null, anchor: null, head: null };

describe("isPeerPresence conversation", () => {
  it("B1 accepts a state without conversation, with null and with a discussions path", () => {
    expect(isPeerPresence(base)).toBe(true);
    expect(isPeerPresence({ ...base, conversation: null })).toBe(true);
    expect(isPeerPresence({ ...base, conversation: { path: "discussions/a.qmd", typing: true } })).toBe(true);
  });

  it("D3 accepts the project chat path and rejects other .labshelf files", () => {
    expect(isPeerPresence({ ...base, conversation: { path: ".labshelf/chat.qmd", typing: true } })).toBe(true);
    expect(isPeerPresence({ ...base, conversation: { path: ".labshelf/comments.qmd", typing: false } })).toBe(false);
    expect(isPeerPresence({ ...base, conversation: { path: "sub/.labshelf/chat.qmd", typing: false } })).toBe(false);
  });

  it("B1 rejects another folder, a missing typing and a non-boolean typing", () => {
    expect(isPeerPresence({ ...base, conversation: { path: "notes/a.qmd", typing: true } })).toBe(false);
    expect(isPeerPresence({ ...base, conversation: { path: "discussions/a.qmd" } })).toBe(false);
    expect(isPeerPresence({ ...base, conversation: { path: "discussions/a.qmd", typing: "yes" } })).toBe(false);
    expect(isPeerPresence({ ...base, conversation: { path: "discussions/a.md", typing: false } })).toBe(false);
    expect(isPeerPresence({ ...base, conversation: { path: "discussions/a.qmd", typing: false, extra: 1 } })).toBe(false);
  });
});

describe("PresenceStore.setConversation", () => {
  let clients: TestClient[] = [];
  let handles: PresenceStore[] = [];
  afterEach(async () => {
    await Promise.all(handles.map((h) => h.close()));
    await Promise.all(clients.map((c) => c.session.close()));
    clients = [];
    handles = [];
  });

  async function attach(): Promise<PresenceStore> {
    const clock = new FakeClock();
    const client = await openSession(new FakeNetwork(clock), clock, "a");
    const handle = attachPresence(client.session, { awarenessKey: await awarenessKey(), logger: client.logger });
    clients.push(client);
    handles.push(handle);
    return handle;
  }

  it("B2 keeps the conversation through later cursor updates and clears it with null", async () => {
    const store = await attach();
    store.setLocal(base);
    store.setConversation({ path: "discussions/a.qmd", typing: true });
    store.setLocal({ ...base, file: "main.typ", anchor: "x", head: "x" });
    expect(store.awareness.getLocalState()).toEqual(expect.objectContaining({ file: "main.typ", conversation: { path: "discussions/a.qmd", typing: true } }));
    store.setConversation(null);
    expect(store.awareness.getLocalState()?.conversation).toBeNull();
    store.setLocal(base);
    expect(store.awareness.getLocalState()?.conversation).toBeNull();
  });

  it("B2 applies a conversation set before any presence with the first one", async () => {
    const store = await attach();
    store.setConversation({ path: "discussions/a.qmd", typing: false });
    store.setLocal(base);
    expect(store.awareness.getLocalState()?.conversation).toEqual({ path: "discussions/a.qmd", typing: false });
  });
});
