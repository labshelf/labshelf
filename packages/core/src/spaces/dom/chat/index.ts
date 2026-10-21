// Mounts the chat empty state for a Space.
import { emptyState } from "../../../ui/dom/index.js";
export function mountResearchChat(root: HTMLElement): () => void {
  root.replaceChildren(emptyState({ text: "Research chat needs a connected model." }));
  return () => root.replaceChildren();
}
