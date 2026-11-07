/// <reference lib="dom" />
// Tests the deck Kits handler both VS Code deck editors share: kits under <root>/kits through the core store, no library, invalid kits and the image pick.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { DECK_KIT_MAX_IMAGE_BYTES, DEFAULT_DECK_STYLE, bytesToBase64 } from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";
import { createKitsHandler, type DeckKitsHandler } from "../../../src/writing/sourceEditor/deckKits";
import { createKitsPort } from "../../../src/writing/sourceEditor/webview/deckWorkspacePorts";

jest.mock("@labshelf/core/deckWorkspace", () => ({ mountDeckWorkspace: jest.fn() }));

let root: string | undefined;
let tmp: string;
const showOpenDialog = jest.fn();
const stat = jest.fn();
const readFile = jest.fn();

function handler(): DeckKitsHandler {
  return createKitsHandler({
    libraryRoot: () => root, fs: new NodeLibraryFileSystem(), paths: path,
    dialog: { showOpenDialog } as never, files: { stat, readFile } as never,
  });
}

const style = { ...DEFAULT_DECK_STYLE, primary: "#0b5394" };

beforeEach(async () => {
  jest.clearAllMocks();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "deck-kits-"));
  root = tmp;
});

afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("deck kits handler", () => {
  it("4b.3b saves a kit with a logo under <root>/kits and lists it back", async () => {
    const kits = handler();
    const stored = await kits.save({ name: "My Lab", style }, { name: "brand.png", base64: bytesToBase64(new Uint8Array([1, 2, 3])) });
    expect(stored).toEqual({ name: "My Lab", style, logo: "kits/my-lab.png" });
    expect([...await fs.readFile(path.join(tmp, "kits", "my-lab.png"))]).toEqual([1, 2, 3]);
    expect(JSON.parse(await fs.readFile(path.join(tmp, "kits", "my-lab.json"), "utf8")).name).toBe("My Lab");
    expect(await kits.list()).toEqual([stored]);
  });

  it("4b.3b lists [] and refuses to save with no library open", async () => {
    root = undefined;
    const kits = handler();
    expect(await kits.list()).toEqual([]);
    await expect(kits.save({ name: "Lab", style })).rejects.toThrow("Open a LabShelf library to save kits.");
  });

  it("4b.3b rejects an invalid kit and writes nothing", async () => {
    const kits = handler();
    await expect(kits.save({ name: "Lab", style: { primary: "red" } })).rejects.toThrow("Invalid kit.");
    await expect(kits.save("Lab")).rejects.toThrow("Invalid kit.");
    await expect(fs.stat(path.join(tmp, "kits"))).rejects.toThrow();
  });

  it("4b.3b returns null when the dialog is cancelled, also with no library", async () => {
    root = undefined;
    showOpenDialog.mockResolvedValue(undefined);
    expect(await handler().pickImage()).toBeNull();
    expect(showOpenDialog).toHaveBeenCalledWith({ canSelectMany: false, filters: { Images: ["png", "jpg", "jpeg", "svg", "webp", "gif"] }, openLabel: "Use image" });
  });

  it("4b.3b gives the picked image's name and bytes as base64", async () => {
    showOpenDialog.mockResolvedValue([vscode.Uri.file("/pics/logo.svg")]);
    stat.mockResolvedValue({ size: 3 });
    readFile.mockResolvedValue(new Uint8Array([7, 8, 9]));
    expect(await handler().pickImage()).toEqual({ name: "logo.svg", base64: bytesToBase64(new Uint8Array([7, 8, 9])) });
  });

  it("4b.3b refuses a file over 5 MB without reading it", async () => {
    showOpenDialog.mockResolvedValue([vscode.Uri.file("/pics/huge.png")]);
    stat.mockResolvedValue({ size: DECK_KIT_MAX_IMAGE_BYTES + 1 });
    await expect(handler().pickImage()).rejects.toThrow("The image is larger than 5 MB.");
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("compiled deck kits port", () => {
  it("4b.3d encodes the logo for deckSaveKit and decodes a picked image to bytes", async () => {
    const request = jest.fn(async (method: string) => (method === "deckPickKitImage" ? { name: "logo.png", base64: bytesToBase64(new Uint8Array([4, 5])) } : method === "deckKits" ? [] : { name: "Lab", style }));
    const port = createKitsPort({ request } as never);
    await port.save({ name: "Lab", style }, { name: "logo.png", bytes: new Uint8Array([1, 2, 3]) });
    expect(request).toHaveBeenCalledWith("deckSaveKit", { kit: { name: "Lab", style }, logo: { name: "logo.png", base64: bytesToBase64(new Uint8Array([1, 2, 3])) } });
    await port.save({ name: "Lab", style });
    expect(request).toHaveBeenLastCalledWith("deckSaveKit", { kit: { name: "Lab", style } });
    const picked = await port.pickImage();
    expect(picked?.name).toBe("logo.png");
    expect([...picked!.bytes]).toEqual([4, 5]);
    expect(await port.list()).toEqual([]);
  });

  it("4b.3d gives null when the host's pick was cancelled", async () => {
    const port = createKitsPort({ request: jest.fn(async () => null) } as never);
    expect(await port.pickImage()).toBeNull();
  });
});
