// Answers the deck Kits port of both VS Code deck editors: lists and saves the open library's kits through the core store,
// and picks a logo with the file dialog, giving its bytes as base64. One handler for the extension; it keeps no per-panel state.
import * as vscode from "vscode";

import {
  DECK_KIT_IMAGE_TOO_LARGE, DECK_KIT_MAX_IMAGE_BYTES, DECK_KIT_VERSION, base64ToBytes, bytesToBase64, listDeckKits, parseDeckKit, saveDeckKit,
  type DeckKit, type DeckKitStoreDeps, type PathOps,
} from "@labshelf/core";

/** An image as it crosses a webview boundary: its file name and its bytes in base64. */
export interface WireKitImage { name: string; base64: string }

export interface DeckKitsServices {
  /** The open library's folder; undefined with no library open. */
  libraryRoot(): string | undefined;
  fs: DeckKitStoreDeps["fs"];
  paths: PathOps;
  /** VS Code's file dialog and file reads by default; fakes in tests. */
  dialog?: Pick<typeof vscode.window, "showOpenDialog">;
  files?: Pick<typeof vscode.workspace.fs, "stat" | "readFile">;
}

/** The kits port on the wire: kits cross as DeckKit JSON objects, images as {name, base64}. */
export interface DeckKitsHandler {
  /** The library's kits; [] with no library open. */
  list(): Promise<DeckKit[]>;
  /** Re-validates the received kit and stores it with its logo. @throws Error with no library, on an invalid kit or a refused logo */
  save(kit: unknown, logo?: WireKitImage): Promise<DeckKit>;
  /** The picked image, or null when the dialog was cancelled. @throws Error on a file over 5 MB */
  pickImage(): Promise<WireKitImage | null>;
}

const IMAGE_TYPES = ["png", "jpg", "jpeg", "svg", "webp", "gif"];

export function createKitsHandler(services: DeckKitsServices): DeckKitsHandler {
  const dialog = services.dialog ?? vscode.window;
  const files = services.files ?? vscode.workspace.fs;
  const store = (root: string): DeckKitStoreDeps => ({ fs: services.fs, paths: services.paths, root });
  return {
    async list() {
      const root = services.libraryRoot();
      return root === undefined ? [] : await listDeckKits(store(root));
    },
    async save(kit, logo) {
      const root = services.libraryRoot();
      if (root === undefined) throw new Error("Open a LabShelf library to save kits.");
      // A DeckKit object carries no file version; the parse rule of the kit files reads it with the current one.
      const parsed = typeof kit === "object" && kit !== null ? parseDeckKit(JSON.stringify({ ...kit, version: DECK_KIT_VERSION })) : null;
      if (parsed === null) throw new Error("Invalid kit.");
      return await saveDeckKit(store(root), parsed, logo && { name: logo.name, bytes: base64ToBytes(logo.base64) });
    },
    async pickImage() {
      const [picked] = await dialog.showOpenDialog({ canSelectMany: false, filters: { Images: IMAGE_TYPES }, openLabel: "Use image" }) ?? [];
      if (!picked) return null;
      if ((await files.stat(picked)).size > DECK_KIT_MAX_IMAGE_BYTES) throw new Error(DECK_KIT_IMAGE_TOO_LARGE);
      const bytes = await files.readFile(picked);
      if (bytes.byteLength > DECK_KIT_MAX_IMAGE_BYTES) throw new Error(DECK_KIT_IMAGE_TOO_LARGE);
      return { name: services.paths.basename(picked.fsPath), base64: bytesToBase64(bytes) };
    },
  };
}
