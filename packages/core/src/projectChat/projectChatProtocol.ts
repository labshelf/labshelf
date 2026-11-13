// Declares the messages between a Project chat page and its host, with the parsers that check each side's untrusted input, and the page's chat source over them.
import { isRecord } from "../guards/index.js";
import type { MessageEnd } from "../libraryUi/protocol/transport.js";
import type { ProjectChatMessage, ProjectChatPeer, ProjectChatSource } from "./projectChatSource.js";

/** Page to host: `ready` asks for the chat (and opens the conversation in presence), the rest are the user's actions. */
export type ProjectChatToHost =
  | { type: "projectChat.ready" }
  | { type: "projectChat.add"; body: string }
  | { type: "projectChat.edit"; id: string; body: string }
  | { type: "projectChat.remove"; id: string }
  | { type: "projectChat.setTyping"; typing: boolean };

/** Host to page: the whole chat after each change, the peers after each presence change, and a failed action. */
export type HostToProjectChat =
  | { type: "projectChat.chat"; title: string; author: string; canWrite: boolean; messages: ProjectChatMessage[] }
  | { type: "projectChat.peers"; peers: ProjectChatPeer[] }
  | { type: "projectChat.error"; message: string };

/** The host's end of the page channel. */
export type ProjectChatHostEnd = MessageEnd<HostToProjectChat, unknown>;
/** The page's end of the host channel. */
export type ProjectChatPageEnd = MessageEnd<ProjectChatToHost, unknown>;

const isText = (value: unknown): value is string => typeof value === "string";
const isId = (value: unknown): value is string => isText(value) && value !== "" && value.length <= 200;

/** @returns the page message, or undefined when `raw` is not exactly one of them. */
export function parseProjectChatToHost(raw: unknown): ProjectChatToHost | undefined {
  if (!isRecord(raw)) { return undefined; }
  switch (raw.type) {
    case "projectChat.ready": return { type: raw.type };
    case "projectChat.add": return isText(raw.body) ? { type: raw.type, body: raw.body } : undefined;
    case "projectChat.edit": return isId(raw.id) && isText(raw.body) ? { type: raw.type, id: raw.id, body: raw.body } : undefined;
    case "projectChat.remove": return isId(raw.id) ? { type: raw.type, id: raw.id } : undefined;
    case "projectChat.setTyping": return typeof raw.typing === "boolean" ? { type: raw.type, typing: raw.typing } : undefined;
    default: return undefined;
  }
}

function parseMessage(raw: unknown): ProjectChatMessage | undefined {
  if (!isRecord(raw) || !isId(raw.id) || !isText(raw.author) || !isText(raw.created) || !isText(raw.body)) { return undefined; }
  if (raw.edited !== undefined && !isText(raw.edited)) { return undefined; }
  return { id: raw.id, author: raw.author, created: raw.created, body: raw.body, ...(raw.edited === undefined ? {} : { edited: raw.edited }) };
}

function parsePeer(raw: unknown): ProjectChatPeer | undefined {
  return isRecord(raw) && isText(raw.name) && isText(raw.colour) && typeof raw.typing === "boolean"
    ? { name: raw.name, colour: raw.colour, typing: raw.typing } : undefined;
}

/** Every entry parsed, or undefined when any entry is malformed. */
function parseAll<T>(raw: unknown, parse: (entry: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(raw)) { return undefined; }
  const parsed = raw.map(parse);
  return parsed.every((entry): entry is T => entry !== undefined) ? parsed : undefined;
}

/** @returns the host message, or undefined when `raw` is not exactly one of them. */
export function parseHostToProjectChat(raw: unknown): HostToProjectChat | undefined {
  if (!isRecord(raw)) { return undefined; }
  switch (raw.type) {
    case "projectChat.chat": {
      const messages = parseAll(raw.messages, parseMessage);
      return messages && isText(raw.title) && isText(raw.author) && typeof raw.canWrite === "boolean"
        ? { type: raw.type, title: raw.title, author: raw.author, canWrite: raw.canWrite, messages } : undefined;
    }
    case "projectChat.peers": {
      const peers = parseAll(raw.peers, parsePeer);
      return peers ? { type: raw.type, peers } : undefined;
    }
    case "projectChat.error": return isText(raw.message) ? { type: raw.type, message: raw.message } : undefined;
    default: return undefined;
  }
}

export interface RemoteProjectChatOptions {
  /** Called with a host error message, e.g. a refused edit. */
  readonly onError?: (message: string) => void;
}

/** The page's ProjectChatSource over the host channel: asks for the chat at once and keeps the host's last chat and peers. */
export function createRemoteProjectChat(end: ProjectChatPageEnd, options: RemoteProjectChatOptions = {}): ProjectChatSource {
  let chat: Extract<HostToProjectChat, { type: "projectChat.chat" }> = { type: "projectChat.chat", title: "", author: "", canWrite: false, messages: [] };
  let peers: readonly ProjectChatPeer[] = [];
  const listeners = new Set<() => void>();
  const notify = (): void => [...listeners].forEach((listener) => listener());
  const stop = end.subscribe((raw) => {
    const message = parseHostToProjectChat(raw);
    if (!message) { return; }
    if (message.type === "projectChat.chat") { chat = message; notify(); return; }
    if (message.type === "projectChat.peers") { peers = message.peers; notify(); return; }
    options.onError?.(message.message);
  });
  end.post({ type: "projectChat.ready" });
  return {
    get author() { return chat.author; },
    get canWrite() { return chat.canWrite; },
    messages: () => chat.messages,
    peers: () => peers,
    send: (body) => end.post({ type: "projectChat.add", body }),
    edit: (id, body) => end.post({ type: "projectChat.edit", id, body }),
    remove: (id) => end.post({ type: "projectChat.remove", id }),
    setTyping: (typing) => end.post({ type: "projectChat.setTyping", typing }),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => { stop(); listeners.clear(); },
  };
}
