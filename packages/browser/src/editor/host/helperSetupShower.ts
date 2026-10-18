// Shows the helper setup card in the side pane, mounting it once, beside the last PDF rather than in its place.
import type { ILatexHelper } from "@labshelf/core/helper";

export interface SetupSlot {
  /** The element the card mounts into; separate from the preview, which stays as it is. */
  readonly element: HTMLElement;
  reveal(): void;
}

export type MountSetupCard = (root: HTMLElement, helper: ILatexHelper) => { dispose(): void };

export function createHelperSetupShower(slot: SetupSlot, helper: ILatexHelper, mount: MountSetupCard): () => void {
  let mounted = false;
  return () => {
    // The card keeps looking for the helper while it is missing, so a second request only brings it back into view.
    if (!mounted) { mount(slot.element, helper); mounted = true; }
    slot.reveal();
  };
}
