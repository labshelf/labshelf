// Tests the Kit store: listing the library's kits folder and saving a kit and its logo, over an in-memory file system.
import { posixPathOps } from "../../src/path/pathOps.js";
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { DECK_KIT_MAX_IMAGE_BYTES, parseDeckKit, serializeDeckKit } from "../../src/decks/deckKit.js";
import type { DeckKit } from "../../src/decks/deckKit.js";
import { listDeckKits, saveDeckKit } from "../../src/decks/deckKitStore.js";
import type { DeckKitStoreDeps } from "../../src/decks/deckKitStore.js";

const ROOT = "/lib";
const KITS = "/lib/kits";
const style: DeckStyle = { ...DEFAULT_DECK_STYLE, primary: "#0b5394" };

interface Fake { deps: DeckKitStoreDeps; texts: Map<string, string>; bytes: Map<string, Uint8Array>; dirs: Set<string>; writes: string[] }

/** A minimal in-memory file system holding text files, byte files and folders. */
function fake(initial: Record<string, string> = {}, folders: string[] = []): Fake {
  const texts = new Map<string, string>(Object.entries(initial));
  const bytes = new Map<string, Uint8Array>();
  const dirs = new Set<string>(folders);
  const writes: string[] = [];
  const fs: DeckKitStoreDeps["fs"] = {
    async listDir(dir) {
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const path of [...texts.keys(), ...bytes.keys()]) {
        if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0]!);
      }
      return [...names];
    },
    async readText(path) {
      const text = texts.get(path);
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    async writeText(path, content) { writes.push(path); texts.set(path, content); },
    async writeFile(path, content) { writes.push(path); bytes.set(path, content); },
    async ensureDir(dir) { dirs.add(dir); },
    async exists(path) {
      const prefix = `${path}/`;
      return texts.has(path) || bytes.has(path) || dirs.has(path) || [...texts.keys(), ...bytes.keys()].some((key) => key.startsWith(prefix));
    },
  };
  return { deps: { fs, paths: posixPathOps, root: ROOT }, texts, bytes, dirs, writes };
}

const kitText = (name: string, extra: Partial<DeckKit> = {}): string => serializeDeckKit({ name, style, ...extra });

describe("4b.1c listDeckKits", () => {
  it("4b.1c gives [] when the kits folder does not exist", async () => {
    const { deps } = fake();
    await expect(listDeckKits(deps)).resolves.toEqual([]);
  });

  it("4b.1c gives [] for an existing empty kits folder", async () => {
    const { deps } = fake({}, [KITS]);
    await expect(listDeckKits(deps)).resolves.toEqual([]);
  });

  it("4b.1c returns the valid kits sorted by name and skips a broken file", async () => {
    const { deps } = fake({
      [`${KITS}/zeta.json`]: kitText("Zeta"),
      [`${KITS}/alpha.json`]: kitText("Alpha", { footer: "A" }),
      [`${KITS}/broken.json`]: "{ not json",
    });
    const kits = await listDeckKits(deps);
    expect(kits.map((kit) => kit.name)).toEqual(["Alpha", "Zeta"]);
    expect(kits[0]).toEqual({ name: "Alpha", style, footer: "A" });
  });

  it("4b.1c skips a file that is valid JSON but not a valid kit", async () => {
    const { deps } = fake({
      [`${KITS}/one.json`]: kitText("One"),
      [`${KITS}/old.json`]: JSON.stringify({ version: 2, name: "Old", style }),
    });
    expect((await listDeckKits(deps)).map((kit) => kit.name)).toEqual(["One"]);
  });

  it("4b.1c ignores entries that are not .json files", async () => {
    const { deps, bytes } = fake({
      [`${KITS}/one.json`]: kitText("One"),
      [`${KITS}/notes.txt`]: kitText("Notes"),
    });
    bytes.set(`${KITS}/one.png`, new Uint8Array([1, 2, 3]));
    expect((await listDeckKits(deps)).map((kit) => kit.name)).toEqual(["One"]);
  });

  it("4b.1c sorts names without regard to case", async () => {
    const { deps } = fake({
      [`${KITS}/b.json`]: kitText("beta"),
      [`${KITS}/a.json`]: kitText("Alpha"),
      [`${KITS}/c.json`]: kitText("Gamma"),
    });
    expect((await listDeckKits(deps)).map((kit) => kit.name)).toEqual(["Alpha", "beta", "Gamma"]);
  });

  it("4b.1c does not throw when a file cannot be read", async () => {
    const { deps } = fake({ [`${KITS}/one.json`]: kitText("One"), [`${KITS}/two.json`]: kitText("Two") });
    const readText = deps.fs.readText.bind(deps.fs);
    deps.fs.readText = async (path) => {
      if (path.endsWith("two.json")) throw new Error("EACCES");
      return readText(path);
    };
    expect((await listDeckKits(deps)).map((kit) => kit.name)).toEqual(["One"]);
  });
});

describe("4b.1d saveDeckKit", () => {
  it("4b.1d writes kits/<slug>.json in the serialized form and returns the kit", async () => {
    const { deps, texts, dirs } = fake();
    const stored = await saveDeckKit(deps, { name: "Universidade de São Paulo", style, footer: "IF" });
    const text = texts.get(`${KITS}/universidade-de-sao-paulo.json`);
    expect(text).toBe(serializeDeckKit({ name: "Universidade de São Paulo", style, footer: "IF" }));
    expect(dirs.has(KITS)).toBe(true);
    expect(stored).toEqual({ name: "Universidade de São Paulo", style, footer: "IF" });
  });

  it("4b.1d returns the kit as parseDeckKit reads it back", async () => {
    const { deps, texts } = fake();
    const stored = await saveDeckKit(deps, { name: "  Lab  ", style: { ...style, accent: "#ABC" } });
    expect(stored).toEqual(parseDeckKit(texts.get(`${KITS}/lab.json`)!));
    expect(stored.name).toBe("Lab");
    expect(stored.style.accent).toBe("#aabbcc");
  });

  it("4b.1d overwrites a kit of the same name", async () => {
    const { deps, texts } = fake();
    await saveDeckKit(deps, { name: "Lab", style, footer: "first" });
    await saveDeckKit(deps, { name: "Lab", style: { ...style, primary: "#123456" }, footer: "second" });
    expect([...texts.keys()].filter((path) => path.endsWith(".json"))).toEqual([`${KITS}/lab.json`]);
    const kits = await listDeckKits(deps);
    expect(kits).toHaveLength(1);
    expect(kits[0]!.footer).toBe("second");
    expect(kits[0]!.style.primary).toBe("#123456");
  });

  it("4b.1d writes a logo to kits/<slug>.png and stores logo 'kits/<slug>.png'", async () => {
    const { deps, bytes, texts } = fake();
    const png = new Uint8Array([137, 80, 78, 71]);
    const stored = await saveDeckKit(deps, { name: "My Lab", style }, { name: "brand.png", bytes: png });
    expect(stored.logo).toBe("kits/my-lab.png");
    expect(bytes.get(`${KITS}/my-lab.png`)).toEqual(png);
    expect(parseDeckKit(texts.get(`${KITS}/my-lab.json`)!)?.logo).toBe("kits/my-lab.png");
  });

  it("4b.1d takes the extension of the logo in lower case", async () => {
    const { deps, bytes } = fake();
    const stored = await saveDeckKit(deps, { name: "Lab", style }, { name: "Brand.JPG", bytes: new Uint8Array([1]) });
    expect(stored.logo).toBe("kits/lab.jpg");
    expect(bytes.has(`${KITS}/lab.jpg`)).toBe(true);
  });

  it.each(["svg", "webp", "gif", "jpeg"])("4b.1d accepts a .%s logo", async (ext) => {
    const { deps } = fake();
    const stored = await saveDeckKit(deps, { name: "Lab", style }, { name: `logo.${ext}`, bytes: new Uint8Array([1]) });
    expect(stored.logo).toBe(`kits/lab.${ext}`);
  });

  it("4b.1d accepts a logo of exactly the size limit", async () => {
    const { deps } = fake();
    const stored = await saveDeckKit(deps, { name: "Lab", style }, { name: "big.png", bytes: new Uint8Array(DECK_KIT_MAX_IMAGE_BYTES) });
    expect(stored.logo).toBe("kits/lab.png");
  });

  it("4b.1d keeps a logo already on the kit when no new logo is given", async () => {
    const { deps } = fake();
    const stored = await saveDeckKit(deps, { name: "Lab", style, logo: "kits/old.png" });
    expect(stored.logo).toBe("kits/old.png");
    expect((await listDeckKits(deps))[0]!.logo).toBe("kits/old.png");
  });

  it("4b.1d drops a logo on the kit that does not pass the parse rule", async () => {
    const { deps } = fake();
    const stored = await saveDeckKit(deps, { name: "Lab", style, logo: "../x.png" });
    expect(stored.logo).toBeUndefined();
  });

  it("4b.1d rejects an invalid style and writes nothing", async () => {
    const { deps, writes } = fake();
    await expect(saveDeckKit(deps, { name: "Lab", style: { ...style, primary: "red" } })).rejects.toThrow(Error);
    expect(writes).toEqual([]);
  });

  it("4b.1d rejects an empty name and writes nothing", async () => {
    const { deps, writes } = fake();
    await expect(saveDeckKit(deps, { name: "", style })).rejects.toThrow(Error);
    await expect(saveDeckKit(deps, { name: "   ", style })).rejects.toThrow(Error);
    expect(writes).toEqual([]);
  });

  it("4b.1d rejects a name over 80 characters", async () => {
    const { deps, writes } = fake();
    await expect(saveDeckKit(deps, { name: "n".repeat(81), style })).rejects.toThrow(Error);
    expect(writes).toEqual([]);
  });

  it("4b.1d rejects a .bmp logo with 'Unsupported image type.' and writes nothing", async () => {
    const { deps, writes } = fake();
    await expect(saveDeckKit(deps, { name: "Lab", style }, { name: "logo.bmp", bytes: new Uint8Array([1]) })).rejects.toThrow("Unsupported image type.");
    expect(writes).toEqual([]);
  });

  it("4b.1d rejects a logo over 5 MB and writes nothing", async () => {
    const { deps, writes } = fake();
    const big = { name: "big.png", bytes: new Uint8Array(DECK_KIT_MAX_IMAGE_BYTES + 1) };
    await expect(saveDeckKit(deps, { name: "Lab", style }, big)).rejects.toThrow("The image is larger than 5 MB.");
    expect(writes).toEqual([]);
  });
});
