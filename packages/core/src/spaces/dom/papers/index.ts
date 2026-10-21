// Mounts the papers empty state for a Space.
import { emptyState } from "../../../ui/dom/index.js";
export function mountSpacePapers(root: HTMLElement): () => void {
  root.replaceChildren(emptyState({ text: "No papers yet." }));
  return () => root.replaceChildren();
}
