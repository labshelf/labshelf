// The /open/ page: Connect to my LabShelf, the Cloudflare return, the states that show no library, then the read-only library and Sign out.
import { formatError } from "@labshelf/core";
import { applyThemeToDocument, resolveTheme } from "@labshelf/core/dom";

import { connect, mountRemoteLibrary, openPage, stateText } from "./open/index.js";
import { installShareStyles, LOADING_STATE, renderState } from "./share/index.js";
import type { PageState } from "./share/shareStates.js";

const SIGNED_OUT_TEXT = "Signed out of LabShelf";
const SIGNED_OUT_HINT = "This page keeps nothing. To fully sign out, also sign out of Cloudflare, or open this page in a private window next time.";

const main = document.getElementById("open-main");
const signOut = document.getElementById("open-sign-out");

/** What is mounted now; Sign out drops it, and with it the only references to the token. */
let mounted: { dispose(): void } | undefined;
/** Counts page states shown; a load that started before the latest state must not mount over it. */
let generation = 0;

function connectButton(root: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ls-btn ls-btn-primary";
  button.textContent = "Connect to my LabShelf";
  button.addEventListener("click", () => {
    button.disabled = true;
    connect().catch((err: unknown) => { button.disabled = false; showState(root, { icon: "warning", text: formatError(err) }); });
  });
  (root.querySelector(".share-state") ?? root).append(button);
}

function showState(root: HTMLElement, state: PageState, withConnect = false): void {
  generation += 1;
  mounted?.dispose();
  mounted = undefined;
  renderState(root, state);
  if (withConnect) { connectButton(root); }
}

function showConnect(root: HTMLElement): void {
  showState(root, { icon: "link", text: "Open your LabShelf from any browser", hint: "Sign in with Cloudflare to read your library here. Nothing is saved in this browser." }, true);
}

function signOutNow(root: HTMLElement): void {
  showState(root, { icon: "link", text: SIGNED_OUT_TEXT, hint: SIGNED_OUT_HINT }, true);
  // The PKCE verifier and state live here only during the redirect.
  window.sessionStorage.clear();
}

async function start(root: HTMLElement): Promise<void> {
  const started = generation;
  const state = await openPage();
  if (generation !== started) { return; }
  if (state === undefined) { showConnect(root); return; }
  const text = stateText(state);
  if (text !== undefined) {
    showState(root, { icon: state.kind === "off" ? "cloud-off" : "warning", text }, state.kind === "failed");
    return;
  }
  if (state.kind !== "ready") { return; }
  const library = await mountRemoteLibrary(root, state.client);
  if (generation !== started) { library.dispose(); signOutNow(root); return; }
  mounted = library;
}

if (main) {
  applyThemeToDocument(resolveTheme("auto"));
  installShareStyles("library");
  signOut?.addEventListener("click", () => { signOutNow(main); });
  renderState(main, LOADING_STATE);
  start(main).catch((err: unknown) => {
    // A return that could not be finished must not be replayed by a reload.
    window.history.replaceState(null, "", window.location.pathname);
    showState(main, { icon: "warning", text: formatError(err) }, true);
  });
}
