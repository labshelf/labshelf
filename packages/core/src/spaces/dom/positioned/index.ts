// Mounts the positioned Notes, Discussions or Discover surface.
import { spaceNotes } from "./notes.js";
import { spaceDiscussions } from "./discussions.js";
import { spaceDiscover } from "./discover.js";

export function mountSpacePositioned(root: HTMLElement, tab: "notes" | "discussions" | "discover"): () => void {
  const build = { notes: spaceNotes, discussions: spaceDiscussions, discover: spaceDiscover };
  root.replaceChildren(build[tab]());
  return () => root.replaceChildren();
}
