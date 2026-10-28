// Opens and closes the Publish screen in place of the grid or detail page and hands it the host's publish messages.
import type { GalleryTransport, HostToGallery, PublishDraft, PublishProject } from "../protocol.js";
import { createPublishScreen, type PublishScreen } from "./publishScreen.js";

export interface PublishController {
  /** The screen being shown, or `null` while the grid or a detail page is. */
  current(): PublishScreen | null;
  /** Replaces the grid, the detail page or an open Publish screen with a fresh one for `project`. */
  open(project: PublishProject, draft: PublishDraft): void;
  /** Applies a `publish.*` host message to the open screen. */
  route(message: HostToGallery): void;
  /** Returns to the grid; does nothing when the screen is not open. */
  close(): void;
  closeAndFocus(): void;
}

export interface PublishControllerDeps {
  main: HTMLElement;
  transport: GalleryTransport;
  /** Closes the detail page when one is open. */
  closeDetail(): void;
  showGrid(): void;
  /** Re-renders the grid after the screen left. */
  updateGrid(): void;
  focusEntry(): void;
}

export function createPublishController(parts: PublishControllerDeps): PublishController {
  const { main, transport } = parts;
  let screen: PublishScreen | null = null;

  const close = (): void => {
    if (screen === null) return;
    screen.dispose();
    screen = null;
    parts.showGrid();
    parts.updateGrid();
  };

  const closeAndFocus = (): void => {
    if (screen === null) return;
    close();
    parts.focusEntry();
  };

  const open = (project: PublishProject, draft: PublishDraft): void => {
    parts.closeDetail();
    screen?.dispose();
    screen = createPublishScreen({ project, draft, transport, onBack: closeAndFocus });
    main.replaceChildren(screen.element);
    screen.focus();
  };

  return { current: () => screen, open, route: (message) => screen?.route(message), close, closeAndFocus };
}
