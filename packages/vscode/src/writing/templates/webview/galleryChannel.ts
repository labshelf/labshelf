// Connects the template gallery page to the VS Code webview messaging API.
import type { GalleryToHost, GalleryTransport, HostToGallery } from "@labshelf/core";

import { webviewTransport } from "../../../webview/index.js";

export function createGalleryChannel(): GalleryTransport {
  return webviewTransport<GalleryToHost, HostToGallery>(acquireVsCodeApi());
}
