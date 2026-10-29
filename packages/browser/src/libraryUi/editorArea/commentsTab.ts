// Lists the open project's comment threads: bodies read-only in the core editor, a Reply button that opens the core editor, and a Resolve button on each.
import { formatError } from "@labshelf/core";
import { formatShortTime, mountQmdEditor, renderElement, renderIcon, type QmdEditorHandle } from "@labshelf/core/dom";
import type { TabModule } from "./tabKinds";
import type { CommentThreads, LocatedThread } from "../../collab";
import { mountBodyInput } from "../../collab/comments";

const MODULE = "libraryUi.comments";

type Track = (editor: QmdEditorHandle) => QmdEditorHandle;

function commentItem(each: LocatedThread["comments"][number], track: Track): HTMLElement {
  const body = renderElement("div", { class: "ls-comment-body" });
  track(mountQmdEditor(body, { body: each.body, readOnly: true, onChange: () => {}, meta: { author: each.author, date: each.createdAt } }));
  const head = renderElement("div", { class: "ls-comment-head" }, renderElement("strong", { text: each.author }), " ", renderElement("span", { text: formatShortTime(each.createdAt) }));
  return renderElement("li", {}, head, body);
}

/** The Reply button; clicking it swaps in an editable core editor with Cancel and Reply buttons. */
function replyControl(thread: LocatedThread, act: (run: () => Promise<void>) => void, threads: CommentThreads, track: Track): HTMLButtonElement {
  const open = renderElement("button", { class: "ls-btn", type: "button", text: "Reply" });
  open.addEventListener("click", () => {
    const host = renderElement("div", { class: "ls-comment-editor", role: "group", "aria-label": "Reply" });
    let sending = false;
    const cancel = (): void => { input.editor.destroy(); form.replaceWith(open); open.focus(); };
    const send = async (): Promise<void> => {
      if (sending) return;
      sending = true;
      const text = (await input.body()).trim();
      sending = false;
      if (text !== "") { act(() => threads.reply(thread.id, text)); }
    };
    const input = mountBodyInput(host, { onSubmit: () => void send(), onCancel: cancel });
    track(input.editor);
    const cancelButton = renderElement("button", { class: "ls-btn", type: "button", text: "Cancel" });
    const sendButton = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button", text: "Reply" });
    cancelButton.addEventListener("click", cancel);
    sendButton.addEventListener("click", () => void send());
    const form = renderElement("div", { class: "ls-comment-reply" }, host, renderElement("div", { class: "ls-comment-actions" }, cancelButton, sendButton));
    open.replaceWith(form);
    input.editor.focus();
  });
  return open;
}

function threadItem(thread: LocatedThread, act: (run: () => Promise<void>) => void, threads: CommentThreads, track: Track): HTMLElement {
  const place = thread.line === undefined ? `${thread.file} (text changed)` : `${thread.file}:${thread.line}`;
  const comments = renderElement("ul", { class: "ls-comment-list", "aria-label": `Comments on ${place}` }, ...thread.comments.map((each) => commentItem(each, track)));
  const resolve = renderElement("button", { class: "ls-btn", type: "button", html: `${renderIcon("check")}<span>Resolve</span>` });
  resolve.addEventListener("click", () => act(() => threads.resolve(thread.id)));
  const actions = renderElement("div", { class: "ls-comment-actions" }, replyControl(thread, act, threads, track), ...(thread.resolved ? [] : [resolve]));
  const head = renderElement("div", { class: "ls-comment-place", text: thread.resolved ? `${place} - resolved` : place });
  head.append(renderElement("blockquote", { class: "ls-comment-quote", text: thread.anchor.quote }));
  return renderElement("li", { class: "ls-comment-thread" }, head, comments, actions);
}

export const mountTab: TabModule["mountTab"] = (host, params, ctx) => {
  const projectId = params["projectId"] ?? "";
  const { comments } = ctx.project();
  const body = host.appendChild(renderElement("section", { class: "ls-comment-panel", "aria-label": "Comments" }));
  const status = renderElement("p", { class: "ls-comment-status", role: "status" });

  let editors: QmdEditorHandle[] = [];
  const track: Track = (editor) => { editors.push(editor); return editor; };
  const destroyEditors = (): void => { for (const editor of editors) { editor.destroy(); } editors = []; };

  const act = (run: () => Promise<void>): void => {
    run().catch((error: unknown) => { status.textContent = formatError(error); });
  };
  let disposed = false;
  const render = async (): Promise<void> => {
    try {
      const threads = await comments.threads(projectId);
      if (disposed) return;
      destroyEditors();
      status.textContent = "";
      const list = renderElement("ul", { class: "ls-comment-threads", "aria-label": "Comment threads" }, ...threads.map((each) => threadItem(each, act, comments, track)));
      body.replaceChildren(status, threads.length === 0 ? renderElement("p", { class: "ls-empty-text", text: "No comments yet." }) : list);
    } catch (error) {
      destroyEditors();
      void ctx.logger.error(MODULE, error, { action: "list comment threads", projectId });
      status.textContent = formatError(error);
      body.replaceChildren(status);
    }
  };
  const stop = comments.onDidChange(() => void render());
  void render();
  return { dispose() { disposed = true; stop(); destroyEditors(); body.remove(); } };
};
