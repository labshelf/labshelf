/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Spec 4b.2d: the browser kits port lists and saves kits at kits/ of an in-memory library and picks an image through a hidden file input,
// refusing one over 5 MB.
import { DEFAULT_DECK_STYLE, type LibraryFileSystem } from "@labshelf/core";
import { createBrowserKitsPort } from "../../../src/libraryUi/editorArea/deckKitsPort";

function writableFs(): LibraryFileSystem & { files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>();
  const isDir = (dir: string): boolean => [...files.keys()].some((p) => p.startsWith(`${dir}/`));
  const no = async (): Promise<never> => { throw new Error("unsupported"); };
  return {
    files,
    listDir: async (dir) => [...new Set([...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split("/")[0]!))],
    stat: async () => undefined,
    exists: async (target) => files.has(target) || isDir(target),
    readText: async (target) => { const value = files.get(target); if (typeof value !== "string") throw new Error(`ENOENT: ${target}`); return value; },
    readFile: async (target) => { const value = files.get(target); if (!(value instanceof Uint8Array)) throw new Error(`ENOENT: ${target}`); return value; },
    writeText: async (target, text) => { files.set(target, text); },
    writeFile: async (target, bytes) => { files.set(target, bytes); },
    ensureDir: async () => undefined,
    deleteFile: no, rename: no, trash: no, removeTree: no, mkdir: no,
  };
}

/** Answers the next file input click with `file` (or a cancel when undefined) and records the input. */
function answerPick(file: { name: string; size: number; bytes: Uint8Array } | undefined): { inputs: HTMLInputElement[]; restore(): void } {
  const inputs: HTMLInputElement[] = [];
  const spy = jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    inputs.push(this);
    if (!file) return void this.dispatchEvent(new Event("cancel"));
    const fake = { name: file.name, size: file.size, arrayBuffer: async () => file.bytes.slice().buffer };
    Object.defineProperty(this, "files", { value: [fake], configurable: true });
    this.dispatchEvent(new Event("change"));
  });
  return { inputs, restore: () => spy.mockRestore() };
}

describe("browser kits port (4b.2d)", () => {
  it("4b.2d saves a kit with its logo under kits/ and lists it back", async () => {
    const fs = writableFs();
    const port = createBrowserKitsPort(fs);
    expect(await port.list()).toEqual([]);
    const stored = await port.save({ name: "Lab Kit", style: DEFAULT_DECK_STYLE, footer: "Lab" }, { name: "logo.png", bytes: Uint8Array.from([1, 2]) });
    expect(stored.logo).toBe("kits/lab-kit.png");
    expect(fs.files.has("kits/lab-kit.json")).toBe(true);
    expect(fs.files.get("kits/lab-kit.png")).toEqual(Uint8Array.from([1, 2]));
    expect((await port.list()).map((kit) => kit.name)).toEqual(["Lab Kit"]);
  });

  it("4b.2d picks an image through a hidden file input clicked synchronously", async () => {
    const pick = answerPick({ name: "logo.svg", size: 3, bytes: Uint8Array.from([60, 115, 62]) });
    try {
      const picked = createBrowserKitsPort(writableFs()).pickImage();
      expect(pick.inputs).toHaveLength(1);
      expect(pick.inputs[0]!.type).toBe("file");
      expect(pick.inputs[0]!.hidden).toBe(true);
      expect(pick.inputs[0]!.accept).toBe("image/png,image/jpeg,image/svg+xml,image/webp,image/gif");
      const image = await picked;
      expect(image?.name).toBe("logo.svg");
      expect(Array.from(image!.bytes)).toEqual([60, 115, 62]);
    } finally { pick.restore(); }
  });

  it("4b.2d a cancelled pick gives null and an image over 5 MB is refused", async () => {
    const cancel = answerPick(undefined);
    try { expect(await createBrowserKitsPort(writableFs()).pickImage()).toBeNull(); } finally { cancel.restore(); }
    const large = answerPick({ name: "big.png", size: 5 * 1024 * 1024 + 1, bytes: Uint8Array.from([0]) });
    try {
      await expect(createBrowserKitsPort(writableFs()).pickImage()).rejects.toThrow("The image is larger than 5 MB.");
    } finally { large.restore(); }
  });
});
