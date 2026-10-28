// Connects the template gallery's publication workflow to the helper and GitHub device authorization.
import {
  type GitHubSignIn,
  type HostToGallery,
  type ILogger,
  type PublishHost,
  type PublishToHost,
  startGitHubDeviceSignIn,
  fetchGithubDeviceToken,
  formatError,
} from "@labshelf/core";
import type { ILatexHelper } from "@labshelf/core/helper";
import { renderElement, mountOverlay } from "@labshelf/core/dom";
import { loadPdfjs } from "../capture";
import { bx } from "../platform";

async function renderTemplateThumbnail(pdf: Uint8Array): Promise<Uint8Array> {
  const task = (await loadPdfjs()).getDocument({ data: pdf.slice() });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 800 / page.getViewport({ scale: 1 }).width });
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "white" }).promise;
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob); else reject(new Error("Could not encode the template thumbnail"));
    }, "image/png"));
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    await task.destroy();
  }
}

const CLIENT_ID = "Ov23ctWLlortFiRo41Qj";

async function signInToGitHub(lifetime: AbortSignal): Promise<GitHubSignIn> {
  const controller = new AbortController();
  const signal = AbortSignal.any([lifetime, controller.signal]);
  const authorization = await startGitHubDeviceSignIn(fetch, CLIENT_ID, signal);
  const open = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Open GitHub" });
  const cancel = renderElement("button", { type: "button", class: "ls-btn", text: "Cancel" });
  const title = renderElement("div", { class: "ls-dialog-title", id: "ls-github-device-title", text: "Sign in with GitHub" });
  const status = renderElement("div", { class: "ls-dialog-msg", role: "status", text: "Waiting for authorization…" });
  const dialog = renderElement("div", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": title.id },
    renderElement("div", { class: "ls-dialog-head" }, renderElement("div", {}, title,
      renderElement("p", { class: "ls-dialog-msg", text: "Enter this code on GitHub:" }),
      renderElement("p", { class: "ls-dialog-msg", text: authorization.userCode }), status)),
    renderElement("div", { class: "ls-dialog-actions" }, cancel, open));
  const dismiss = () => controller.abort(new Error("GitHub sign-in cancelled."));
  const overlay = mountOverlay(dialog, dismiss);
  cancel.addEventListener("click", dismiss);
  open.addEventListener("click", () => {
    void bx.tabs.create({ url: authorization.verificationUri }).catch((error: unknown) => {
      status.textContent = formatError(error);
      controller.abort(new Error("Could not open GitHub authorization."));
    });
  });
  open.focus();
  try {
    return await fetchGithubDeviceToken({ fetch, clientId: CLIENT_ID, authorization, signal });
  } finally {
    overlay.close();
  }
}

export interface BrowserPublishOptions {
  helper: ILatexHelper;
  logger: ILogger;
  pickProject(): Promise<string | undefined>;
  post(message: HostToGallery): void;
  signIn?: (signal: AbortSignal) => Promise<GitHubSignIn>;
}

export function createBrowserPublish(options: BrowserPublishOptions): PublishHost & { dispose(): void } {
  const lifetime = new AbortController();
  let signedIn: GitHubSignIn | undefined;
  let busy = false;
  const execute = async (message: PublishToHost, projectId?: string): Promise<void> => {
    if (message.type === "publish.start") {
      const id = projectId ?? await options.pickProject();
      if (id) await options.helper.publishTemplate(id, { action: "open" }, options.post, renderTemplateThumbnail);
    } else if (message.type === "publish.signIn") {
      signedIn = await (options.signIn ?? signInToGitHub)(lifetime.signal);
      options.post({ type: "publish.auth", login: signedIn.login });
    } else {
      if (message.type === "publish.submit" && !signedIn) throw new Error("Sign in with GitHub first.");
      const request = message.type === "publish.check" ? { action: "check" as const, draft: message.draft }
        : { action: "submit" as const, draft: message.draft, token: signedIn!.token };
      await options.helper.publishTemplate(message.project.id, request, options.post, renderTemplateThumbnail);
    }
  };
  const run = async (message: PublishToHost, id?: string): Promise<void> => {
    if (busy || lifetime.signal.aborted) return;
    busy = true;
    try {
      await execute(message, id);
    } catch (error) {
      await options.logger.error("browser.templates.publish", error, { action: message.type });
      if (lifetime.signal.aborted) return;
      const text = formatError(error);
      if (message.type === "publish.signIn") options.post({ type: "publish.auth", error: text });
      else if (message.type !== "publish.start") options.post({ type: "publish.failed", error: text });
      options.post({ type: "notice", kind: "error", text });
    } finally { busy = false; }
  };
  return { open: (id) => run({ type: "publish.start" }, id), handle: run,
    dispose: () => { lifetime.abort(); signedIn = undefined; options.helper.disconnect(); } };
}
