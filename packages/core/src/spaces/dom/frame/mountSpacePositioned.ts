// Mounts the positioned Notes, Discussions or Discover surface.
import { el } from "../../../ui/dom/index.js";
import { spaceNotes } from "./notes.js";
import { spaceDiscussions } from "./discussions.js";
import { spaceDiscover } from "./discover.js";

export function mountSpacePositioned(root: HTMLElement, tab: "notes" | "discussions" | "discover"): () => void {
  const build = { notes: spaceNotes, discussions: spaceDiscussions, discover: spaceDiscover };
  const reasons = { notes: "Notes need a connected note editor.", discussions: "Discussions need collaboration.", discover: "Discover needs a connected discovery service." };
  root.replaceChildren(el("div", { class: "sp-availability", role: "note" },
    el("strong", { text: "Not available yet" }), el("span", { text: reasons[tab] })), build[tab]());
  return () => root.replaceChildren();
}
