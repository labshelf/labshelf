// Mounts the core template gallery of New talk or poster (entry of dist/newDeck/newDeck.js); the extension host answers in writing/deckEditor/commands.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/deck-template-gallery.css";
import { findElement, mountDeckTemplateGallery } from "@labshelf/core/dom";
import { createWebviewTransport } from "../../../webview/index.js";
import type { NewDeckHostMessage, NewDeckPageMessage } from "../deckMessages.js";

const transport = createWebviewTransport<NewDeckPageMessage, NewDeckHostMessage>(acquireVsCodeApi());
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
