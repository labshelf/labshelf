// Mounts the shared template gallery over the webview messaging API (entry of dist/templates/templates.js); the extension host answers in writing/templates.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/template-gallery.css";
import "@labshelf/core/styles/template-publish.css";
import { findElement, mountTemplateGallery } from "@labshelf/core/dom";
import type { GalleryToHost, GalleryTransport, HostToGallery } from "@labshelf/core";
import { webviewTransport } from "../../../webview/index.js";

function createGalleryChannel(): GalleryTransport {
  return webviewTransport<GalleryToHost, HostToGallery>(acquireVsCodeApi());
}

mountTemplateGallery(findElement("root"), createGalleryChannel());
