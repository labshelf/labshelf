/** Pins the Project chat host and page: the protocol parsers, the chat re-posted on file changes, author-only actions, read-only refusal,
 *  ordered typing presence cleared on stop, peers pushed, and the remote source the page mounts. */
import {
  createProjectChatPresencePort, createProjectChatStore, createRemoteProjectChat, parseHostToProjectChat, parseProjectChatToHost, serveProjectChat,
  type HostToProjectChat, type ProjectChatPresence, type ProjectChatStoreContext, type ProjectChatToHost,
} from "../../src/projectChat/index";

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) { await Promise.resolve(); } await new Promise((resolve) => setTimeout(resolve, 0)); };

function memoryContext(): ProjectChatStoreContext {
  const files = new Map<string, string>();
  return {
    fs: {
      exists: async (path) => files.has(path),
      readText: async (path) => files.get(path) ?? "",
      writeText: async (path, text) => { files.set(path, text); },
      ensureDir: async () => {},
    },
    logger: { log: async () => {}, error: async () => {} } as never,
    now: () => "2026-11-09T10:00:00.000Z",
  };
}

/** A host end and a page end joined in memory. */
function channel() {
  const toPage = new Set<(raw: unknown) => void>();
  const toHost = new Set<(raw: unknown) => void>();
  const posted: HostToProjectChat[] = [];
  const host = {
    post: (message: HostToProjectChat) => { posted.push(message); toPage.forEach((listener) => listener(structuredClone(message))); },
    subscribe: (listener: (raw: unknown) => void) => { toHost.add(listener); return () => { toHost.delete(listener); }; },
  };
  const page = {
    post: (message: ProjectChatToHost) => toHost.forEach((listener) => listener(structuredClone(message))),
    subscribe: (listener: (raw: unknown) => void) => { toPage.add(listener); return () => { toPage.delete(listener); }; },
  };
  return { host, page, posted };
}

function fakePresence() {
  const sets: (boolean | null)[] = [];
  const listeners = new Set<() => void>();
  let peers = [{ name: "Bo", colour: "#00f", typing: false }];
  const presence: ProjectChatPresence = {
    set: (typing) => { sets.push(typing); },
    peers: () => peers,
    onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { presence, sets, change: (next: typeof peers) => { peers = next; listeners.forEach((listener) => listener()); } };
}

describe("projectChat protocol", () => {
  it("parses each page message and rejects malformed ones", () => {
    expect(parseProjectChatToHost({ type: "projectChat.add", body: "Hi" })).toEqual({ type: "projectChat.add", body: "Hi" });
    expect(parseProjectChatToHost({ type: "projectChat.edit", id: "m-1", body: "x" })).toEqual({ type: "projectChat.edit", id: "m-1", body: "x" });
    expect(parseProjectChatToHost({ type: "projectChat.setTyping", typing: true })).toEqual({ type: "projectChat.setTyping", typing: true });
    expect(parseProjectChatToHost({ type: "projectChat.remove", id: "" })).toBeUndefined();
    expect(parseProjectChatToHost({ type: "projectChat.setTyping", typing: "yes" })).toBeUndefined();
    expect(parseProjectChatToHost({ type: "other" })).toBeUndefined();
  });

  it("parses host messages and rejects a chat with a malformed message", () => {
    const chat = { type: "projectChat.chat", title: "Thesis", author: "Ana", canWrite: true, messages: [{ id: "m-1", author: "Bo", created: "t", body: "Hi", edited: "u" }] };
    expect(parseHostToProjectChat(chat)).toEqual(chat);
    expect(parseHostToProjectChat({ ...chat, messages: [{ id: "m-1" }] })).toBeUndefined();
    expect(parseHostToProjectChat({ type: "projectChat.peers", peers: [{ name: "Bo", colour: "#00f", typing: 1 }] })).toBeUndefined();
  });
});

describe("serveProjectChat with createRemoteProjectChat", () => {
  it("A2 posts the chat on ready, after a send and after an outside file change", async () => {
    const { host, page } = channel();
    const store = createProjectChatStore(memoryContext());
    let fileChanged = (): void => {};
    const stop = serveProjectChat({ end: host, store, projectDir: "/p", title: "Thesis", author: () => "Ana", canWrite: true, logger: memoryContext().logger,
      onFileChange: (listener) => { fileChanged = listener; return () => {}; } });
    const source = createRemoteProjectChat(page);
    await flush();
    expect(source.author).toBe("Ana");
    expect(source.canWrite).toBe(true);
    source.send("Hello.");
    await flush();
    expect(source.messages()).toEqual([expect.objectContaining({ author: "Ana", body: "Hello." })]);
    await store.add("/p", "From Bo.", "Bo");
    fileChanged();
    await flush();
    expect(source.messages().map((message) => message.body)).toEqual(["Hello.", "From Bo."]);
    stop();
    source.dispose();
  });

  it("A5 refuses an edit of another member's message and posts the error; edits its own with edited", async () => {
    const { host, page } = channel();
    const store = createProjectChatStore(memoryContext());
    const theirs = await store.add("/p", "Bo's", "Bo");
    const errors: string[] = [];
    const stop = serveProjectChat({ end: host, store, projectDir: "/p", title: "T", author: "Ana", canWrite: true, logger: memoryContext().logger, now: () => "2026-11-09T12:00:00.000Z" });
    const source = createRemoteProjectChat(page, { onError: (message) => errors.push(message) });
    await flush();
    source.edit(theirs, "Mine now");
    await flush();
    expect(errors).toEqual([expect.stringContaining("Edit message failed")]);
    const mine = await store.add("/p", "Draft", "Ana");
    source.edit(mine, "Final");
    await flush();
    expect(source.messages().find((message) => message.id === mine)).toEqual(expect.objectContaining({ body: "Final", edited: "2026-11-09T12:00:00.000Z" }));
    stop();
  });

  it("D7 refuses sends and never reports typing where the chat is read-only", async () => {
    const { host, page } = channel();
    const { presence, sets } = fakePresence();
    const errors: string[] = [];
    const stop = serveProjectChat({ end: host, store: createProjectChatStore(memoryContext()), projectDir: "/p", title: "T", author: "Ana", canWrite: false, logger: memoryContext().logger, presence });
    const source = createRemoteProjectChat(page, { onError: (message) => errors.push(message) });
    source.setTyping(true);
    source.send("x");
    await flush();
    expect(source.canWrite).toBe(false);
    expect(source.messages()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(sets).toEqual([false, false]);
    stop();
  });

  it("A4 applies typing in page order, pushes peers and clears the conversation on stop", async () => {
    const { host, page } = channel();
    const { presence, sets, change } = fakePresence();
    const stop = serveProjectChat({ end: host, store: createProjectChatStore(memoryContext()), projectDir: "/p", title: "T", author: "Ana", canWrite: true, logger: memoryContext().logger, presence });
    const source = createRemoteProjectChat(page);
    source.setTyping(true);
    source.setTyping(false);
    await flush();
    expect(source.peers()).toEqual([{ name: "Bo", colour: "#00f", typing: false }]);
    change([{ name: "Bo", colour: "#00f", typing: true }]);
    expect(source.peers()).toEqual([{ name: "Bo", colour: "#00f", typing: true }]);
    stop();
    await flush();
    expect(sets).toEqual([false, true, false, null]);
  });
});

describe("createProjectChatPresencePort", () => {
  it("D3 publishes the chat path, lists peers with the chat open once per name without the user, and follows awareness changes", () => {
    const conversations: unknown[] = [];
    let onAwareness: (change: unknown, origin: unknown) => void = () => {};
    const state = (name: string, path: string | null, typing = false) => ({ name, colour: "#0f0", file: null, anchor: null, head: null, conversation: path === null ? null : { path, typing } });
    const remote = new Map<number, ReturnType<typeof state>>([
      [1, state("Bo", ".labshelf/chat.qmd")], [2, state("Bo", ".labshelf/chat.qmd", true)], [3, state("Cy", null)], [4, state("Ana", ".labshelf/chat.qmd")],
    ]);
    const store = {
      setConversation: (conversation: unknown) => { conversations.push(conversation); },
      remote: () => remote,
      awareness: { on: (_event: string, listener: typeof onAwareness) => { onAwareness = listener; }, off: () => {} },
    };
    const port = createProjectChatPresencePort({ presenceOf: (id) => (id === "share-1" ? store as never : undefined), onConnectionsChange: () => () => {}, self: () => "Ana" });
    const presence = port.presence("share-1");
    let changes = 0;
    presence.onChange(() => { changes++; });
    presence.set(true);
    presence.set(null);
    expect(conversations).toEqual([{ path: ".labshelf/chat.qmd", typing: true }, null]);
    expect(presence.peers()).toEqual([{ name: "Bo", colour: "#0f0", typing: true }]);
    changes = 0;
    onAwareness({}, "remote");
    onAwareness({}, "local");
    expect(changes).toBe(1);
    port.dispose();
  });
});
