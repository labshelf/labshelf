// Lists the open project's comment threads with a reply box and a Resolve button on each.
import { el, icon } from "@labshelf/core/dom";
import type { TabModule } from "./tabKind";
import type { CommentThreads, ReviewThread } from "../../collab/comments";

const MODULE = "libraryUi.comments";

function threadItem(thread: ReviewThread, act: (run: () => Promise<void>) => void, threads: CommentThreads): HTMLElement {
  const place = thread.line === undefined ? `${thread.file} (text changed)` : `${thread.file}:${thread.line}`;
  const comments = el("ul", { class: "ls-comment-list", "aria-label": `Comments on ${place}` },
    ...thread.comments.map((each) => el("li", {}, el("strong", { text: each.author }), " ", el("span", { text: each.body }))));
  const label = el("label", { class: "ls-comment-label", text: "Reply" });
  const box = el("input", { class: "ls-input", type: "text", id: `reply-${thread.id}` });
  label.htmlFor = box.id;
  const send = el("button", { class: "ls-btn", type: "button", text: "Reply" });
  const submit = (): void => {
    const text = box.value.trim();
    if (text !== "") { act(() => threads.reply(thread.id, text)); }
  };
  send.addEventListener("click", submit);
  box.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } });
  const resolve = el("button", { class: "ls-btn", type: "button", html: `${icon("check")}<span>Resolve</span>` });
  resolve.addEventListener("click", () => act(() => threads.resolve(thread.id)));
  const actions = el("div", { class: "ls-comment-actions" }, box, send, ...(thread.resolved ? [] : [resolve]));
  const head = el("div", { class: "ls-comment-place", text: thread.resolved ? `${place} - resolved` : place });
  head.append(el("blockquote", { class: "ls-comment-quote", text: thread.anchor.quote }));
  return el("li", { class: "ls-comment-thread" }, head, comments, label, actions);
}

export const mountTab: TabModule["mountTab"] = (host, params, ctx) => {
  const projectId = params["projectId"] ?? "";
  const { comments } = ctx.project();
  const body = host.appendChild(el("section", { class: "ls-comment-panel", "aria-label": "Comments" }));
  const status = el("p", { class: "ls-comment-status", role: "status" });

  const act = (run: () => Promise<void>): void => {
    run().catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); });
  };
  const render = async (): Promise<void> => {
    try {
      const threads = await comments.threads(projectId);
      status.textContent = "";
      const list = el("ul", { class: "ls-comment-threads", "aria-label": "Comment threads" }, ...threads.map((each) => threadItem(each, act, comments)));
      body.replaceChildren(status, threads.length === 0 ? el("p", { class: "ls-empty-text", text: "No comments yet." }) : list);
    } catch (error) {
      void ctx.logger.error(MODULE, error, { action: "list comment threads", projectId });
      status.textContent = error instanceof Error ? error.message : String(error);
      body.replaceChildren(status);
    }
  };
  const stop = comments.onDidChange(() => void render());
  void render();
  return { dispose() { stop(); body.remove(); } };
};
