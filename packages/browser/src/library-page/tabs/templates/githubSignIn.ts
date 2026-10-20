// Authorizes template publication through GitHub device flow while keeping the token in memory.
import { startGitHubDeviceSignIn, finishGitHubDeviceSignIn, type GitHubSignIn } from "@labshelf/core";
import { el, mountOverlay } from "@labshelf/core/dom";
import { bx } from "../../../platform";

const CLIENT_ID = "Ov23ctWLlortFiRo41Qj";

export async function signInToGitHub(lifetime: AbortSignal): Promise<GitHubSignIn> {
  const controller = new AbortController();
  const signal = AbortSignal.any([lifetime, controller.signal]);
  const authorization = await startGitHubDeviceSignIn(fetch, CLIENT_ID, signal);
  const open = el("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Open GitHub" });
  const cancel = el("button", { type: "button", class: "ls-btn", text: "Cancel" });
  const title = el("div", { class: "ls-dialog-title", id: "ls-github-device-title", text: "Sign in with GitHub" });
  const status = el("div", { class: "ls-dialog-msg", role: "status", text: "Waiting for authorization…" });
  const dialog = el("div", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": title.id },
    el("div", { class: "ls-dialog-head" }, el("div", {}, title,
      el("p", { class: "ls-dialog-msg", text: "Enter this code on GitHub:" }),
      el("p", { class: "ls-dialog-msg", text: authorization.userCode }), status)),
    el("div", { class: "ls-dialog-actions" }, cancel, open));
  const dismiss = () => controller.abort(new Error("GitHub sign-in cancelled."));
  const overlay = mountOverlay(dialog, dismiss);
  cancel.addEventListener("click", dismiss);
  open.addEventListener("click", () => {
    void bx.tabs.create({ url: authorization.verificationUri }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error);
      controller.abort(new Error("Could not open GitHub authorization."));
    });
  });
  open.focus();
  try {
    return await finishGitHubDeviceSignIn({ fetch, clientId: CLIENT_ID, authorization, signal });
  } finally {
    overlay.close();
  }
}
