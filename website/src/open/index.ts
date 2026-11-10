// The /open/ entry: handles the Cloudflare return before anything else, then opens the remote library with the in-memory token.
import { createLoopbackTransport, DEFAULT_PREFS } from "@labshelf/core";
import { mountLibraryUi } from "@labshelf/core/dom";

import { buildRemoteSnapshot, type RemoteIndex } from "./openLibrary.js";
import { attachOpenHost } from "./openHost.js";
import { beginSignIn, finishSignIn } from "./signIn.js";
import { openRemoteLibrary, type OpenState } from "./remoteClient.js";
import { closeAllViews, showDeck, showSource } from "./sourceView.js";

type RemoteClient = Extract<OpenState, { kind: "ready" }>["client"];
const PAPERS_INDEX = "index/papers.json";

export const OFF_TEXT = "Remote access is off";
export const OTHER_ACCOUNT_TEXT = "This LabShelf belongs to another Cloudflare account";

/** The page text of a state that shows no library; undefined for `ready`. */
export function stateText(state: OpenState): string | undefined {
  switch (state.kind) {
    case "ready": return undefined;
    case "off": return OFF_TEXT;
    case "other_account": return OTHER_ACCOUNT_TEXT;
    case "not_registered": return "This Cloudflare account has no LabShelf relay registered";
    case "failed": return state.message;
  }
}

/** Starts the Cloudflare sign-in; the page leaves for Cloudflare and comes back with the code. */
export async function connect(): Promise<void> {
  await beginSignIn({ storage: window.sessionStorage, location: window.location });
}

/** Resolves to the open state when Cloudflare just sent the page back, or undefined when it did not (the visitor still has to connect). The token never leaves this call's closure. */
export async function openPage(): Promise<OpenState | undefined> {
  const env = { storage: window.sessionStorage, location: window.location };
  const token = await finishSignIn({ ...env, fetch: window.fetch.bind(window) });
  if (token === undefined) { return undefined; }
  // The code and state leave the URL right after the exchange, before any reload can replay them.
  window.history.replaceState(null, "", window.location.pathname);
  return openRemoteLibrary(token, { fetch: window.fetch.bind(window) });
}

const isRemoteIndex = (value: unknown): value is RemoteIndex => {
  const v = value as Partial<RemoteIndex> | null;
  return typeof v === "object" && v !== null && v.version === 1 && Array.isArray(v.folders) && Array.isArray(v.papers);
};

/** A list of buttons under a heading; each opens one read-only view. */
function openList(heading: string, items: { label: string; open(): void }[]): HTMLElement | undefined {
  if (items.length === 0) { return undefined; }
  const section = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = heading;
  section.append(summary);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ls-btn";
    button.textContent = item.label;
    button.addEventListener("click", item.open);
    section.append(button);
  }
  return section;
}

/** Shows the remote library read-only in `root`: the papers in the library UI, and the projects' sources and decks as lists that open lazily. Nothing here asks for a PDF. */
export async function mountRemoteLibrary(root: HTMLElement, client: RemoteClient): Promise<{ dispose(): void }> {
  const [rows, papersText] = await Promise.all([client.index(), client.file(PAPERS_INDEX)]);
  const parsed: unknown = JSON.parse(papersText);
  if (!isRemoteIndex(parsed)) { throw new Error("The Mirror's papers index is not readable."); }
  const library = buildRemoteSnapshot(parsed, rows);

  const lists = [
    ...library.projects.map((project) => openList(`Sources: ${project.name}`, project.files.map((file) => ({
      label: file,
      open: () => { showSource(file, () => client.file(`projects/${project.name}/${file}`)); },
    })))),
    openList("Decks", library.decks.map((path) => ({
      label: path.slice("projects/".length),
      open: () => { showDeck(path, /poster/i.test(path) ? "poster" : "talk", () => client.file(path)); },
    }))),
  ].filter((el): el is HTMLElement => el !== undefined);
  const libraryHost = document.createElement("div");
  libraryHost.style.cssText = "flex:1;min-height:0";
  root.style.cssText = "display:flex;flex-direction:column;height:100%";
  root.replaceChildren(...lists, libraryHost);

  const { ui, host } = createLoopbackTransport();
  // The host listens before the UI mounts, so the UI's ready message finds it.
  const detach = attachOpenHost({ client, library, endpoint: host });
  const mounted = mountLibraryUi(libraryHost, {
    transport: ui,
    // The page keeps nothing, so the list's preferences reset on reload.
    prefs: { load: () => ({ ...DEFAULT_PREFS }), save: () => undefined },
    capabilities: {},
    readOnly: true,
    labels: { addTooltip: "Open LabShelf on your computer to add papers", emptyHint: "The remote library holds no papers." },
  });
  return { dispose: () => { closeAllViews(); mounted.dispose(); detach(); } };
}
