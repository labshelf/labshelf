// Shows who is online in a shared Space's discussions and who types in the open conversation, and tells the host which conversation
// this user has open and when they type in it.
import { renderElement } from "../../ui/dom/index.js";
import type { SpacePeer } from "../spacesHostPort.js";
import type { SpacesTransport } from "../spacesProtocol.js";

/** typing:true is posted at most this often while the user keeps typing. */
const TYPING_REPOST_MS = 2000;
/** typing:false is posted this long after the last keystroke. */
const TYPING_IDLE_MS = 4000;
/** The header lists this many members, then "+N". */
const ONLINE_SHOWN = 4;

export interface ConversationPresenceSender {
  /** The conversation now open, or undefined when none; posts it with typing false. */
  open(path: string | undefined): void;
  /** The composer changed: typing while it has text, stopped when it empties. */
  draftChanged(hasText: boolean): void;
  /** The user sent the draft. */
  sent(): void;
  dispose(): void;
}

export function createConversationPresenceSender(end: Pick<SpacesTransport, "post">, spaceId: string, canWrite: () => boolean): ConversationPresenceSender {
  let path: string | undefined;
  let typing = false;
  let typingAt = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const post = (next: boolean): void => {
    end.post({ type: "setConversationPresence", spaceId, path: path ?? null, typing: next });
  };
  const stop = (): void => {
    clearTimeout(idle); idle = undefined;
    if (!typing) return;
    typing = false;
    post(false);
  };
  return {
    open(next) {
      clearTimeout(idle); idle = undefined;
      const wasTyping = typing;
      typing = false; typingAt = 0;
      if (next === path && !wasTyping) return;
      path = next;
      post(false);
    },
    draftChanged(hasText) {
      if (path === undefined) return;
      if (!hasText || !canWrite()) { stop(); return; }
      const now = Date.now();
      if (!typing || now - typingAt >= TYPING_REPOST_MS) { typing = true; typingAt = now; post(true); }
      clearTimeout(idle);
      idle = setTimeout(stop, TYPING_IDLE_MS);
    },
    sent: stop,
    dispose() { clearTimeout(idle); idle = undefined; },
  };
}

function renderDot(colour: string): HTMLElement {
  const dot = renderElement("span", { class: "ds-presence-dot", "aria-hidden": "true" });
  dot.style.backgroundColor = colour;
  return dot;
}

/** Fills the header's member list: a coloured dot and name for the first four, then "+N"; hidden when nobody else is online. */
export function paintOnlineMembers(host: HTMLElement, peers: readonly SpacePeer[]): void {
  host.hidden = peers.length === 0;
  const shown = peers.slice(0, ONLINE_SHOWN).map(peer => renderElement("span", { class: "ds-online-member" }, renderDot(peer.colour), renderElement("span", { text: peer.name })));
  const more = peers.length > ONLINE_SHOWN ? [renderElement("span", { class: "ds-online-more", text: `+${peers.length - ONLINE_SHOWN}` })] : [];
  host.replaceChildren(...shown, ...more);
  host.setAttribute("aria-label", peers.length ? `Online: ${peers.map(peer => peer.name).join(", ")}` : "Nobody else online");
}

export function renderOnlineMembers(): HTMLElement {
  const host = renderElement("div", { class: "ds-online" });
  host.hidden = true;
  return host;
}

/** "Ana is typing…", "Ana and Bruno are typing…", or "Several people are typing…"; empty when nobody types in `path`. */
export function typingText(peers: readonly SpacePeer[], path: string | undefined): string {
  const names = path === undefined ? [] : peers.filter(peer => peer.path === path && peer.typing).map(peer => peer.name);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

/** The line under the messages; it keeps its height when empty so the composer never moves. */
export function renderTypingLine(): HTMLElement {
  return renderElement("div", { class: "ds-typing", "aria-live": "polite" });
}

/** Marks a conversation row that another member has open. */
export function markRowPresence(row: HTMLElement, peers: readonly SpacePeer[], path: string): HTMLElement {
  const here = peers.filter(peer => peer.path === path);
  if (here.length) {
    const dot = renderDot(here[0]!.colour);
    dot.classList.add("ds-row-presence");
    dot.title = `${here.map(peer => peer.name).join(", ")} ${here.length === 1 ? "is" : "are"} here`;
    (row.querySelector(".ds-row-title") ?? row).append(dot);
  }
  return row;
}
