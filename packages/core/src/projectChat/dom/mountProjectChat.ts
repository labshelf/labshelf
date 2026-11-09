// Mounts the Project chat of the open writing project: its head with the project's name, the messages with day separators, the user's own
// on the right with Edit and Delete, the typing line and the composer. It looks like the Space chat (the ds-* classes of discussions.css)
// and reads and writes only through a ProjectChatSource.
import { askDialog, renderElement, renderEmptyNotice, showMenu, type IconName } from "../../ui/dom/index.js";
import { formatClockTime } from "../../time/index.js";
import { renderDaySeparator } from "../../spaces/dom/discussionsChat.js";
import { openEmojiGrid, renderIconButton, renderIconSpan, renderInitial } from "../../spaces/dom/discussionsViews.js";
import { renderTypingLine, typingText } from "../../spaces/dom/discussionsPresence.js";
import type { ProjectChatMessage, ProjectChatSource } from "../projectChatSource.js";

export interface ProjectChatOptions {
  /** The chat of the open project, or null with no project open. The mount disposes it when it is replaced or unmounted. */
  readonly source: ProjectChatSource | null;
  readonly projectTitle: string | null;
}

export interface ProjectChatHandle {
  /** Shows the chat of another project, or the empty state with null; the previous source is disposed. */
  setProject(title: string | null, source: ProjectChatSource | null): void;
  dispose(): void;
}

/** A list within this many pixels of its end counts as scrolled to the bottom. */
const AT_BOTTOM_PX = 24;
/** The typing line takes the peers' path; the project chat has one conversation. */
const CHAT_PATH = "chat";

const atBottom = (list: HTMLElement): boolean => list.scrollHeight - list.scrollTop - list.clientHeight <= AT_BOTTOM_PX;

interface ChatState {
  source: ProjectChatSource | null;
  title: string | null;
  stop: () => void;
  /** The user's message being edited inline, with its draft. */
  editing: { id: string; draft: string } | undefined;
}

/** Puts `before` and `after` around the selection of the composer, or inserts them at the caret. */
function wrapSelection(input: HTMLTextAreaElement, before: string, after = ""): void {
  const { selectionStart: start, selectionEnd: end, value } = input;
  input.value = `${value.slice(0, start)}${before}${value.slice(start, end)}${after}${value.slice(end)}`;
  input.setSelectionRange(start + before.length, end + before.length);
  input.focus();
  input.dispatchEvent(new Event("input"));
}

/** Enter sends; Shift+Enter or an open IME composition keep it a new line. */
const sendsOnEnter = (event: KeyboardEvent): boolean => event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;

export function mountProjectChat(root: HTMLElement, options: ProjectChatOptions): ProjectChatHandle {
  const s: ChatState = { source: null, title: null, stop: () => {}, editing: undefined };
  const title = renderElement("h2");
  const head = renderElement("div", { class: "ds-thread-head" }, renderIconSpan("users", "ds-icon ds-head-icon"),
    renderElement("div", { class: "ds-thread-title" }, title));
  const preview = renderElement("p", { class: "pc-preview", text: "Preview: messages are not saved or shared yet." });
  const messages = renderElement("div", { class: "ds-messages", role: "log", "aria-label": "Messages" });
  const scroll = renderElement("div", { class: "ds-scroll pc-scroll" }, messages);
  const typing = renderTypingLine();
  const input = renderElement("textarea", { class: "ds-input pc-input", rows: "1", placeholder: "Message the project", "aria-label": "Message" });
  const send = renderIconButton("send", "Send", "ds-send", true);
  const insert = renderIconButton("plus", "Insert", "ds-icon-btn", true);
  const math = renderIconButton("sigma", "Insert inline math", "ds-icon-btn", true);
  const emoji = renderIconButton("smile", "Insert emoji", "ds-icon-btn", true);
  const composer = renderElement("div", { class: "ds-composer" }, insert, input, renderElement("span", { class: "ds-composer-tools" }, math, emoji), send);
  const reply = renderElement("div", { class: "ds-reply" }, composer, renderElement("span", { class: "ds-hint", text: "Enter sends, Shift+Enter adds a line" }));
  const chat = renderElement("section", { class: "pc-chat", "aria-label": "Project chat" }, head, preview, scroll, typing, reply);
  const empty = renderEmptyNotice({ text: "Open a project to see its chat.", inline: true });
  root.classList.add("pc-panel");

  const canWrite = (): boolean => !!s.source?.canWrite;
  const syncComposer = (): void => {
    for (const control of [input, insert, math, emoji]) control.disabled = !canWrite();
    send.disabled = !canWrite() || !input.value.trim();
  };
  const submit = (): void => {
    const body = input.value;
    if (!s.source || !canWrite() || !body.trim()) return;
    input.value = "";
    syncComposer();
    s.source.setTyping(false);
    s.source.send(body);
    scroll.scrollTop = scroll.scrollHeight;
  };

  const quote = (message: ProjectChatMessage): void => {
    const line = message.body.split("\n").find(text => text.trim()) ?? "";
    wrapSelection(input, `> ${message.author}: ${line.trim()}\n\n`);
  };
  const remove = async (message: ProjectChatMessage): Promise<void> => {
    const source = s.source;
    const ok = await askDialog("Delete this message?", "It is removed for everyone in this project.", "Delete", true);
    if (ok && source && source === s.source) source.remove(message.id);
  };

  const renderEdit = (message: ProjectChatMessage, editing: { id: string; draft: string }): HTMLElement => {
    const area = renderElement("textarea", { class: "ds-edit-editor pc-input", "aria-label": "Edit message" });
    area.value = editing.draft;
    const save = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Save" });
    const cancel = renderElement("button", { type: "button", class: "ls-btn", text: "Cancel" });
    const close = (): void => { s.editing = undefined; paint(); };
    const commit = (): void => {
      if (!editing.draft.trim()) return;
      s.editing = undefined;
      if (editing.draft !== message.body) s.source?.edit(message.id, editing.draft); else paint();
    };
    area.addEventListener("input", () => { editing.draft = area.value; save.disabled = !area.value.trim(); });
    area.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); commit(); }
    });
    save.addEventListener("click", commit);
    cancel.addEventListener("click", close);
    return renderElement("div", { class: "ds-edit" }, area,
      renderElement("div", { class: "ds-edit-actions" }, renderElement("span", { class: "ds-hint", text: "Esc cancels · Ctrl+Enter saves" }), cancel, save));
  };

  const renderActions = (message: ProjectChatMessage, own: boolean): HTMLElement => {
    const actions: Array<[IconName, string, () => void]> = [["quote", "Reply quoting", () => quote(message)]];
    if (own) {
      actions.push(["edit", "Edit", () => { s.editing = { id: message.id, draft: message.body }; paint(); }], ["trash", "Delete", () => { void remove(message); }]);
    }
    return renderElement("div", { class: "ds-msg-actions", role: "toolbar", "aria-label": "Message actions" }, ...actions.map(([name, label, run]) => {
      const button = renderIconButton(name, label, "ds-msg-action", true);
      button.disabled = !canWrite();
      button.addEventListener("click", run);
      return button;
    }));
  };

  const renderMessage = (message: ProjectChatMessage, colours: ReadonlyMap<string, string>): HTMLElement => {
    const own = message.author === s.source?.author;
    const editing = own && s.editing?.id === message.id ? s.editing : undefined;
    const avatar = renderInitial(message.author);
    const colour = colours.get(message.author);
    if (colour) avatar.style.background = `color-mix(in srgb, ${colour} 35%, var(--ls-bg))`;
    return renderElement("article", { class: own ? "ds-message own" : "ds-message", "data-item-id": message.id }, own ? "" : avatar,
      renderElement("div", { class: "ds-msg-main" },
        renderElement("div", { class: "ds-msg-head" }, renderElement("strong", { text: own ? "You" : message.author }),
          renderElement("time", { datetime: message.created, text: formatClockTime(message.created) }),
          message.edited ? renderElement("span", { class: "ds-edited", title: message.edited, text: "(edited)" }) : ""),
        editing ? renderEdit(message, editing)
          : renderElement("div", { class: "ds-bubble" }, canWrite() ? renderActions(message, own) : "", renderElement("div", { class: "pc-body", text: message.body }))));
  };

  function paint(): void {
    const source = s.source;
    if (!source) { root.replaceChildren(empty); return; }
    if (chat.parentElement !== root) root.replaceChildren(chat);
    title.textContent = s.title ?? "";
    const peers = source.peers();
    typing.textContent = typingText(peers.map(peer => ({ ...peer, path: CHAT_PATH })), CHAT_PATH);
    const bottom = atBottom(scroll);
    const colours = new Map(peers.map(peer => [peer.name, peer.colour]));
    const list = source.messages();
    if (s.editing && !list.some(message => message.id === s.editing!.id)) s.editing = undefined;
    const nodes: HTMLElement[] = [];
    let day: string | undefined;
    for (const message of list) {
      const messageDay = new Date(message.created).toDateString();
      if (messageDay !== day) { day = messageDay; nodes.push(renderDaySeparator(message.created)); }
      nodes.push(renderMessage(message, colours));
    }
    messages.replaceChildren(...(nodes.length ? nodes : [renderEmptyNotice({ text: "No messages yet.", hint: "Write the first one below.", inline: true })]));
    syncComposer();
    if (bottom) scroll.scrollTop = scroll.scrollHeight;
  }

  const setProject = (title: string | null, source: ProjectChatSource | null): void => {
    s.stop();
    if (s.source !== source) s.source?.dispose();
    s.title = title;
    s.source = source;
    s.editing = undefined;
    s.stop = source ? source.onChange(paint) : () => {};
    input.value = "";
    paint();
    if (source) scroll.scrollTop = scroll.scrollHeight;
  };

  input.addEventListener("input", () => { syncComposer(); s.source?.setTyping(!!input.value.trim()); });
  input.addEventListener("keydown", event => {
    if (!sendsOnEnter(event)) return;
    event.preventDefault();
    submit();
  });
  send.addEventListener("click", submit);
  math.addEventListener("click", () => wrapSelection(input, "$", "$"));
  emoji.addEventListener("click", () => openEmojiGrid(emoji, glyph => wrapSelection(input, glyph)));
  insert.addEventListener("click", () => showMenu(insert, [
    { label: "Inline math", icon: "sigma", onSelect: () => wrapSelection(input, "$", "$") },
    { label: "Code", icon: "code", onSelect: () => wrapSelection(input, "`", "`") },
    { label: "Link", icon: "link", onSelect: () => wrapSelection(input, "[", "](https://)") },
  ]));

  setProject(options.projectTitle, options.source);
  return {
    setProject,
    dispose() {
      s.stop();
      s.source?.dispose();
      s.source = null;
      root.classList.remove("pc-panel");
      root.replaceChildren();
    },
  };
}
