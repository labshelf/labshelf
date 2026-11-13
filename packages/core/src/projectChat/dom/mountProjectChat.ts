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

/** The user's message being edited inline, with its draft. */
type Editing = { id: string; draft: string };

/** The mounted chat: the DOM of one panel and the project it shows. */
class ProjectChatView implements ProjectChatHandle {
  private source: ProjectChatSource | null = null;
  private title: string | null = null;
  private stop: () => void = () => {};
  private editing: Editing | undefined;

  private readonly titleEl = renderElement("h2");
  private readonly messages = renderElement("div", { class: "ds-messages", role: "log", "aria-label": "Messages" });
  private readonly scroll = renderElement("div", { class: "ds-scroll pc-scroll" }, this.messages);
  private readonly typing = renderTypingLine();
  private readonly input = renderElement("textarea", { class: "ds-input pc-input", rows: "1", placeholder: "Message the project", "aria-label": "Message" });
  private readonly send = renderIconButton("send", "Send", "ds-send", true);
  private readonly insert = renderIconButton("plus", "Insert", "ds-icon-btn", true);
  private readonly math = renderIconButton("sigma", "Insert inline math", "ds-icon-btn", true);
  private readonly emoji = renderIconButton("smile", "Insert emoji", "ds-icon-btn", true);
  private readonly chat = this.renderChat();
  private readonly empty = renderEmptyNotice({ text: "Open a project to see its chat.", inline: true });

  constructor(private readonly root: HTMLElement, options: ProjectChatOptions) {
    root.classList.add("pc-panel");
    this.bindComposer();
    this.setProject(options.projectTitle, options.source);
  }

  /** Shows the chat of another project, or the empty state with null; the previous source is disposed. */
  setProject = (title: string | null, source: ProjectChatSource | null): void => {
    this.stop();
    if (this.source !== source) this.source?.dispose();
    this.title = title;
    this.source = source;
    this.editing = undefined;
    this.stop = source ? source.onChange(() => this.paint()) : () => {};
    this.input.value = "";
    this.paint();
    if (source) this.scroll.scrollTop = this.scroll.scrollHeight;
  };

  dispose = (): void => {
    this.stop();
    this.source?.dispose();
    this.source = null;
    this.root.classList.remove("pc-panel");
    this.root.replaceChildren();
  };

  private renderChat(): HTMLElement {
    const head = renderElement("div", { class: "ds-thread-head" }, renderIconSpan("users", "ds-icon ds-head-icon"),
      renderElement("div", { class: "ds-thread-title" }, this.titleEl));
    const composer = renderElement("div", { class: "ds-composer" }, this.insert, this.input, renderElement("span", { class: "ds-composer-tools" }, this.math, this.emoji), this.send);
    const reply = renderElement("div", { class: "ds-reply" }, composer, renderElement("span", { class: "ds-hint", text: "Enter sends, Shift+Enter adds a line" }));
    return renderElement("section", { class: "pc-chat", "aria-label": "Project chat" }, head, this.scroll, this.typing, reply);
  }

  private bindComposer(): void {
    const { input, send, math, emoji, insert } = this;
    input.addEventListener("input", () => { this.syncComposer(); this.source?.setTyping(!!input.value.trim()); });
    input.addEventListener("keydown", event => {
      if (!sendsOnEnter(event)) return;
      event.preventDefault();
      this.submit();
    });
    send.addEventListener("click", () => this.submit());
    math.addEventListener("click", () => wrapSelection(input, "$", "$"));
    emoji.addEventListener("click", () => openEmojiGrid(emoji, glyph => wrapSelection(input, glyph)));
    insert.addEventListener("click", () => showMenu(insert, [
      { label: "Inline math", icon: "sigma", onSelect: () => wrapSelection(input, "$", "$") },
      { label: "Code", icon: "code", onSelect: () => wrapSelection(input, "`", "`") },
      { label: "Link", icon: "link", onSelect: () => wrapSelection(input, "[", "](https://)") },
    ]));
  }

  private canWrite(): boolean { return !!this.source?.canWrite; }

  private syncComposer(): void {
    for (const control of [this.input, this.insert, this.math, this.emoji]) control.disabled = !this.canWrite();
    this.send.disabled = !this.canWrite() || !this.input.value.trim();
  }

  private submit(): void {
    const body = this.input.value;
    if (!this.source || !this.canWrite() || !body.trim()) return;
    this.input.value = "";
    this.syncComposer();
    this.source.setTyping(false);
    this.source.send(body);
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  private quote(message: ProjectChatMessage): void {
    const line = message.body.split("\n").find(text => text.trim()) ?? "";
    wrapSelection(this.input, `> ${message.author}: ${line.trim()}\n\n`);
  }

  private async remove(message: ProjectChatMessage): Promise<void> {
    const source = this.source;
    const ok = await askDialog("Delete this message?", "It is removed for everyone in this project.", "Delete", true);
    if (ok && source && source === this.source) source.remove(message.id);
  }

  private renderEdit(message: ProjectChatMessage, editing: Editing): HTMLElement {
    const area = renderElement("textarea", { class: "ds-edit-editor pc-input", "aria-label": "Edit message" });
    area.value = editing.draft;
    const save = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Save" });
    const cancel = renderElement("button", { type: "button", class: "ls-btn", text: "Cancel" });
    const close = (): void => { this.editing = undefined; this.paint(); };
    const commit = (): void => {
      if (!editing.draft.trim()) return;
      this.editing = undefined;
      if (editing.draft !== message.body) this.source?.edit(message.id, editing.draft); else this.paint();
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
  }

  private renderActions(message: ProjectChatMessage, own: boolean): HTMLElement {
    const actions: Array<[IconName, string, () => void]> = [["quote", "Reply quoting", () => this.quote(message)]];
    if (own) {
      actions.push(["edit", "Edit", () => { this.editing = { id: message.id, draft: message.body }; this.paint(); }], ["trash", "Delete", () => { void this.remove(message); }]);
    }
    return renderElement("div", { class: "ds-msg-actions", role: "toolbar", "aria-label": "Message actions" }, ...actions.map(([name, label, run]) => {
      const button = renderIconButton(name, label, "ds-msg-action", true);
      button.disabled = !this.canWrite();
      button.addEventListener("click", run);
      return button;
    }));
  }

  private renderMessage(message: ProjectChatMessage, colours: ReadonlyMap<string, string>): HTMLElement {
    const own = message.author === this.source?.author;
    const editing = own && this.editing?.id === message.id ? this.editing : undefined;
    const avatar = renderInitial(message.author);
    const colour = colours.get(message.author);
    if (colour) avatar.style.background = `color-mix(in srgb, ${colour} 35%, var(--ls-bg))`;
    return renderElement("article", { class: own ? "ds-message own" : "ds-message", "data-item-id": message.id }, own ? "" : avatar,
      renderElement("div", { class: "ds-msg-main" },
        renderElement("div", { class: "ds-msg-head" }, renderElement("strong", { text: own ? "You" : message.author }),
          renderElement("time", { datetime: message.created, text: formatClockTime(message.created) }),
          message.edited ? renderElement("span", { class: "ds-edited", title: message.edited, text: "(edited)" }) : ""),
        editing ? this.renderEdit(message, editing)
          : renderElement("div", { class: "ds-bubble" }, this.canWrite() ? this.renderActions(message, own) : "", renderElement("div", { class: "pc-body", text: message.body }))));
  }

  /** The messages with a day separator before the first of each day. */
  private renderList(list: readonly ProjectChatMessage[], colours: ReadonlyMap<string, string>): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    let day: string | undefined;
    for (const message of list) {
      const messageDay = new Date(message.created).toDateString();
      if (messageDay !== day) { day = messageDay; nodes.push(renderDaySeparator(message.created)); }
      nodes.push(this.renderMessage(message, colours));
    }
    return nodes;
  }

  private paint(): void {
    const source = this.source;
    if (!source) { this.root.replaceChildren(this.empty); return; }
    if (this.chat.parentElement !== this.root) this.root.replaceChildren(this.chat);
    this.titleEl.textContent = this.title ?? "";
    const peers = source.peers();
    this.typing.textContent = typingText(peers.map(peer => ({ ...peer, path: CHAT_PATH })), CHAT_PATH);
    const bottom = atBottom(this.scroll);
    const colours = new Map(peers.map(peer => [peer.name, peer.colour]));
    const list = source.messages();
    if (this.editing && !list.some(message => message.id === this.editing!.id)) this.editing = undefined;
    const nodes = this.renderList(list, colours);
    this.messages.replaceChildren(...(nodes.length ? nodes : [renderEmptyNotice({ text: "No messages yet.", hint: "Write the first one below.", inline: true })]));
    this.syncComposer();
    if (bottom) this.scroll.scrollTop = this.scroll.scrollHeight;
  }
}

export function mountProjectChat(root: HTMLElement, options: ProjectChatOptions): ProjectChatHandle {
  return new ProjectChatView(root, options);
}
