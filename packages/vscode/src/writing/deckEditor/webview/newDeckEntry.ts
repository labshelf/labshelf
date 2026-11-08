// Mounts the core template gallery of New talk or poster (entry of dist/newDeck/newDeck.js); the extension host answers in writing/deckEditor/newDeckPanel.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/deck-template-gallery.css";
import type { DeckTemplateChoice, DeckTemplateGalleryInit } from "@labshelf/core";
import { findElement, mountDeckTemplateGallery } from "@labshelf/core/dom";
import { createWebviewTransport } from "../../../webview/index.js";

type PageMessage = { type: "ready" } | { type: "create"; choice: DeckTemplateChoice } | { type: "cancel" };
type HostMessage = { type: "init"; init: DeckTemplateGalleryInit };

const transport = createWebviewTransport<PageMessage, HostMessage>(acquireVsCodeApi());
let mounted: { destroy(): void } | undefined;

transport.subscribe((message) => {
  if (message.type !== "init" || mounted) return;
  mounted = mountDeckTemplateGallery(findElement("root"), {
    ...message.init,
    onCreate: (choice) => transport.post({ type: "create", choice }),
    onCancel: () => transport.post({ type: "cancel" }),
  });
});
transport.post({ type: "ready" });
