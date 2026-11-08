// The browser's New presentation and New poster dialog: the core template gallery inside a modal overlay.
import type { DeckTemplateChoice, DeckTemplateGalleryInit } from "@labshelf/core";
import { mountDeckTemplateGallery, mountOverlay } from "@labshelf/core/dom";

/** Opens the gallery; resolves the choice on Create, null on Cancel, Escape or a scrim press, and closes the overlay either way. */
export function openNewDeckDialog(init: DeckTemplateGalleryInit): Promise<DeckTemplateChoice | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice: DeckTemplateChoice | null): void => {
      if (settled) return;
      settled = true;
      overlay.close();
      gallery.destroy();
      resolve(choice);
    };
    // The gallery is built off-page, then the overlay moves its element into the page.
    const gallery = mountDeckTemplateGallery(document.createElement("div"), { ...init, onCreate: (choice) => finish(choice), onCancel: () => finish(null) });
    const overlay = mountOverlay(gallery.element, () => finish(null));
    gallery.element.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.focus();
  });
}
