// Mounts the positioned empty state for a Space.
import { emptyState } from "../../../ui/dom/index.js";
export function mountSpacePositioned(root: HTMLElement): () => void {
  root.replaceChildren(emptyState({ text: "This tab needs a connected service." }));
  return () => root.replaceChildren();
}
