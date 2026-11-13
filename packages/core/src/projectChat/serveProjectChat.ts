// Serves a Project chat page from the project chat store and the project share's presence: posts the chat after each change of the
// file, posts the peers after each presence change, and runs the page's sends, edits, removals and typing.
import { PROJECT_CHAT_PATH } from "../collab/sharedFiles.js";
import { formatError } from "../errors/index.js";
import type { ILogger } from "../ports/index.js";
import { createSpacePresencePort, type SpacePresenceOptions } from "../share/spacePresence.js";
import { parseProjectChatToHost, type ProjectChatHostEnd, type ProjectChatToHost } from "./projectChatProtocol.js";
import type { ProjectChatPeer } from "./projectChatSource.js";
import type { ProjectChatStore } from "./projectChatStore.js";

/** The project share's presence as the chat uses it. */
export interface ProjectChatPresence {
  /** Publishes the open chat and whether the user types in it; null when the chat closes. */
  set(typing: boolean | null): void;
  /** The other members with the chat open, once per name, without the user. */
  peers(): ProjectChatPeer[];
  /** Calls `listener` after any change of the peers; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface ServeProjectChatOptions {
  readonly end: ProjectChatHostEnd;
  readonly store: ProjectChatStore;
  readonly projectDir: string;
  /** The project's name, the panel head. */
  readonly title: string;
  /** The user's name stamped on their messages, or a getter read on every use. */
  readonly author: string | (() => string);
  /** False where the user may only read the chat (D7), or a getter read on every use. */
  readonly canWrite: boolean | (() => boolean);
  readonly logger: ILogger;
  /** The ISO time stamped as `edited`; the clock when absent. */
  readonly now?: () => string;
  /** Fires when the chat file changed outside this store, e.g. a peer's message the mirror wrote; returns the unsubscribe. */
  readonly onFileChange?: (listener: () => void) => () => void;
  /** Absent while the project has no live share connection: no peers and no typing. */
  readonly presence?: ProjectChatPresence;
}

const MODULE = "projectChat/server";
const valueOf = <T>(value: T | (() => T)): T => (typeof value === "function" ? (value as () => T)() : value);

type Action = Exclude<ProjectChatToHost, { type: "projectChat.ready" | "projectChat.setTyping" }>;

function runAction(options: ServeProjectChatOptions, message: Action): Promise<unknown> {
  const { store, projectDir } = options;
  const author = valueOf(options.author);
  if (!valueOf(options.canWrite)) { return Promise.reject(new Error("This chat is read-only here.")); }
  switch (message.type) {
    case "projectChat.add": return store.add(projectDir, message.body, author);
    case "projectChat.edit": return store.edit(projectDir, message.id, message.body, author, (options.now ?? (() => new Date().toISOString()))());
    case "projectChat.remove": return store.remove(projectDir, message.id, author);
  }
}

/** The typing presence of the user, applied in the order the page sent it. */
function createPresenceSetter(
  options: ServeProjectChatOptions,
  isStopped: () => boolean,
  fail: (action: string, error: unknown) => void,
): (typing: boolean | null) => void {
  const { presence } = options;
  let presenceTail: Promise<void> = Promise.resolve();
  return (typing) => {
    // INVARIANT: presence applies in page order, so a typing:false never lands before the typing:true it follows.
    presenceTail = presenceTail.then(() => {
      // TRAP: the chat may have closed while an earlier apply ran; a late conversation would outlive the clear.
      if (isStopped() && typing !== null) { return; }
      presence?.set(typing === null ? null : typing && valueOf(options.canWrite));
    }).catch((error: unknown) => fail("Show typing", error));
  };
}

/** @returns the stop, which clears the user's conversation in presence. */
export function serveProjectChat(options: ServeProjectChatOptions): () => void {
  const { end, store, projectDir, presence, logger } = options;
  let opened = false;
  let stopped = false;
  let queued = false;
  let tail: Promise<void> = Promise.resolve();

  const fail = (action: string, error: unknown): void => {
    const reason = formatError(error);
    void logger.log("ERROR", MODULE, `${action} failed`, { projectDir, error: reason });
    if (!stopped) { end.post({ type: "projectChat.error", message: `${action} failed: ${reason}` }); }
  };
  const postChat = async (): Promise<void> => {
    try {
      const messages = await store.read(projectDir);
      if (stopped) { return; }
      end.post({ type: "projectChat.chat", title: options.title, author: valueOf(options.author), canWrite: valueOf(options.canWrite), messages });
    } catch (error) { fail("Load project chat", error); }
  };
  // INVARIANT: at most one post waits behind the running one, so changes in one tick post once and a later change still posts.
  const schedule = (): void => {
    if (!opened || stopped || queued) { return; }
    queued = true;
    tail = tail.then(() => { queued = false; return postChat(); });
  };
  const postPeers = (): void => { if (opened && !stopped && presence) { end.post({ type: "projectChat.peers", peers: presence.peers() }); } };
  const setPresence = createPresenceSetter(options, () => stopped, fail);

  const stopMessages = end.subscribe((raw) => {
    const message = parseProjectChatToHost(raw);
    if (!message) { void logger.log("WARN", MODULE, "Project chat page message rejected", { type: (raw as { type?: unknown } | null)?.type }); return; }
    switch (message.type) {
      case "projectChat.ready": opened = true; schedule(); setPresence(false); postPeers(); return;
      // INVARIANT: the conversation is published only once the page has the chat open.
      case "projectChat.setTyping": if (opened) { setPresence(message.typing); } return;
      default: runAction(options, message).catch((error: unknown) => fail(ACTION_LABELS[message.type], error));
    }
  });
  const stops = [
    stopMessages,
    store.onChange((dir) => { if (dir === projectDir) { schedule(); } }),
    options.onFileChange?.(schedule) ?? (() => {}),
    presence?.onChange(postPeers) ?? (() => {}),
  ];
  return () => {
    for (const stop of stops) { stop(); }
    stopped = true;
    setPresence(null);
  };
}

const ACTION_LABELS: Record<Action["type"], string> = {
  "projectChat.add": "Send message", "projectChat.edit": "Edit message", "projectChat.remove": "Delete message",
};

export type ProjectChatPresenceOptions = SpacePresenceOptions & {
  /** The user's name; a peer with it (the user on another device) is left out. */
  readonly self: () => string;
};

export interface ProjectChatPresencePort {
  /** The chat presence of one project share, by share id. */
  presence(shareId: string): ProjectChatPresence;
  dispose(): void;
}

/** The chat presence of project shares over their PresenceStore: the conversation path is `.labshelf/chat.qmd`, peers are deduped by name. */
export function createProjectChatPresencePort(options: ProjectChatPresenceOptions): ProjectChatPresencePort {
  const port = createSpacePresencePort(options);
  return {
    presence: (shareId) => ({
      set: (typing) => port.setSpacePresence(shareId, typing === null ? null : { path: PROJECT_CHAT_PATH, typing }),
      peers: () => port.spacePeers(shareId)
        .filter((peer) => peer.path === PROJECT_CHAT_PATH && peer.name !== options.self())
        .map(({ name, colour, typing }) => ({ name, colour, typing })),
      onChange: (listener) => port.onSpacePeersChange((id) => { if (id === shareId) { listener(); } }),
    }),
    dispose: () => port.dispose(),
  };
}
