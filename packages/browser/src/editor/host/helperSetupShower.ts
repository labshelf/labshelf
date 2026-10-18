// Shows the helper setup card in its slot, mounting it once and bringing it back into view on every later request.
import type { ILatexHelper } from "@labshelf/core/helper";

export interface SetupSlot {
  /** The element the card mounts into. */
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
