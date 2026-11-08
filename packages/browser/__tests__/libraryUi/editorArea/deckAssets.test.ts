// Tests the deck asset resolver over a fake library file system and fake downscale and object-URL ports: images become 1600 px proxies,
// svg and other files keep their own bytes with their extension's mime, one URL per path is cached, paths leaving the deck folder reject,
// dispose revokes every URL, and original() returns the full bytes.
import type { LibraryFileSystem } from "@labshelf/core";
import { createDeckAssetResolver, createFullResolutionResolver } from "../../../src/libraryUi/editorArea/deckAssets";

const FOLDER = "projects/p1/talks/intro";
const bytes = (text: string) => new TextEncoder().encode(text);

function setup(files: Record<string, Uint8Array>) {
  const reads: string[] = [];
  const fs = {
    readFile: jest.fn(async (path: string) => {
      reads.push(path);
      const found = files[path];
      if (!found) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return found;
    }),
    exists: jest.fn(async (path: string) => path in files),
    stat: jest.fn(async (path: string) => (path in files ? { isFile: true, isDirectory: false, mtimeMs: 0, size: files[path]!.length } : undefined)),
    readText: jest.fn(async (path: string) => { const found = files[path]; if (!found) throw new Error(`ENOENT: ${path}`); return new TextDecoder().decode(found); }),
  } as unknown as LibraryFileSystem;
  let n = 0;
  const proxies: Blob[] = [];
  const ports = {
    downscale: jest.fn(async (_bytes: Uint8Array, mime: string, _maxSide: number) => { const blob = new Blob(["proxy"], { type: mime }); proxies.push(blob); return blob; }),
    createObjectURL: jest.fn((_blob: Blob) => `blob:test/${n++}`),
    revokeObjectURL: jest.fn((_url: string) => undefined),
  };
  return { resolver: createDeckAssetResolver(fs, FOLDER, ports), ports, reads, proxies };
}

describe("deck asset resolver", () => {
  it("9.1c downscales a png to a 1600 px proxy and returns its blob URL", async () => {
    const png = bytes("PNGDATA");
    const t = setup({ [`${FOLDER}/img/a.png`]: png });
    const url = await t.resolver.resolveAsset("img/a.png");
    expect(t.ports.downscale).toHaveBeenCalledTimes(1);
    const [given, mime, maxSide] = t.ports.downscale.mock.calls[0]!;
    expect(Array.from(given)).toEqual(Array.from(png));
    expect(mime).toBe("image/png");
    expect(maxSide).toBe(1600);
    expect(t.ports.createObjectURL).toHaveBeenCalledWith(t.proxies[0]);
    expect(url).toBe(t.ports.createObjectURL.mock.results[0]!.value);
  });

  it("9.1c downscales jpg, jpeg, gif and webp images with their mime", async () => {
    const t = setup({
      [`${FOLDER}/a.jpg`]: bytes("j"), [`${FOLDER}/b.jpeg`]: bytes("j2"), [`${FOLDER}/c.gif`]: bytes("g"), [`${FOLDER}/d.webp`]: bytes("w"),
    });
    for (const path of ["a.jpg", "b.jpeg", "c.gif", "d.webp"]) await t.resolver.resolveAsset(path);
    expect(t.ports.downscale.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["image/jpeg", 1600], ["image/jpeg", 1600], ["image/gif", 1600], ["image/webp", 1600],
    ]);
  });

  it("9.1c an svg is not downscaled and becomes a blob of its own bytes typed image/svg+xml", async () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const t = setup({ [`${FOLDER}/fig.svg`]: svg });
    await t.resolver.resolveAsset("fig.svg");
    expect(t.ports.downscale).not.toHaveBeenCalled();
    const blob = t.ports.createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("image/svg+xml");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(svg));
  });

  it("9.1c caches one blob URL per path", async () => {
    const t = setup({ [`${FOLDER}/img/a.png`]: bytes("PNG"), [`${FOLDER}/img/b.png`]: bytes("PNG2") });
    const first = await t.resolver.resolveAsset("img/a.png");
    const again = await t.resolver.resolveAsset("img/a.png");
    const other = await t.resolver.resolveAsset("img/b.png");
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(t.ports.createObjectURL).toHaveBeenCalledTimes(2);
    expect(t.ports.downscale).toHaveBeenCalledTimes(2);
  });

  it("9.1c refuses paths that leave the deck folder", async () => {
    const t = setup({ "projects/p1/talks/secret.png": bytes("S"), "projects/p1/other.png": bytes("O") });
    await expect(t.resolver.resolveAsset("../secret.png")).rejects.toBeDefined();
    await expect(t.resolver.resolveAsset("img/../../../other.png")).rejects.toBeDefined();
    expect(t.reads.filter((path) => !path.startsWith(`${FOLDER}/`))).toEqual([]);
    expect(t.ports.createObjectURL).not.toHaveBeenCalled();
  });

  it("9.1c dispose revokes every URL it created", async () => {
    const t = setup({ [`${FOLDER}/a.png`]: bytes("A"), [`${FOLDER}/b.svg`]: bytes("<svg/>") });
    const a = await t.resolver.resolveAsset("a.png");
    const b = await t.resolver.resolveAsset("b.svg");
    t.resolver.dispose();
    expect(t.ports.revokeObjectURL.mock.calls.map((call) => call[0]).sort()).toEqual([a, b].sort());
  });

  it("9.1c original returns the full bytes, not the proxy", async () => {
    const png = bytes("FULL-RESOLUTION-PNG");
    const t = setup({ [`${FOLDER}/img/a.png`]: png });
    await t.resolver.resolveAsset("img/a.png");
    const original = await t.resolver.original("img/a.png");
    expect(original).toBeDefined();
    expect(Array.from(original!)).toEqual(Array.from(png));
  });
});

// Spec 11.3: the poster preview's full-resolution resolver.
describe("createFullResolutionResolver", () => {
  const PNG = Uint8Array.from([137, 80, 78, 71, 9, 9, 9]);
  function full() {
    const base = setup({ [`${FOLDER}/assets/plot.png`]: PNG });
    const blobs: Blob[] = [];
    let n = 0;
    const ports = { createObjectURL: jest.fn((blob: Blob) => { blobs.push(blob); return `blob:full/${n++}`; }), revokeObjectURL: jest.fn((_url: string) => undefined) };
    return { ...base, full: createFullResolutionResolver(base.resolver, ports), fullPorts: ports, blobs };
  }

  it("11.3 gives a blob URL of the original bytes typed by extension, once per path, and no proxy", async () => {
    const { full: resolver, blobs, ports } = full();
    expect(await resolver.resolveAsset("assets/plot.png")).toBe("blob:full/0");
    expect(await resolver.resolveAsset("assets/plot.png")).toBe("blob:full/0");
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await blobs[0]!.arrayBuffer()))).toEqual(Array.from(PNG));
    expect(ports.downscale).not.toHaveBeenCalled();
  });

  it("11.3 falls back to the proxy when the bytes are missing or the path is refused", async () => {
    const { full: resolver, resolver: proxies } = full();
    const proxy = jest.spyOn(proxies, "resolveAsset").mockImplementation(async (path) => `blob:proxy/${path}`);
    expect(await resolver.resolveAsset("assets/missing.png")).toBe("blob:proxy/assets/missing.png");
    expect(await resolver.resolveAsset("../escape.png")).toBe("blob:proxy/../escape.png");
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("11.3 revokes its URLs on dispose and a URL made after dispose at once", async () => {
    const { full: resolver, fullPorts } = full();
    const url = await resolver.resolveAsset("assets/plot.png");
    resolver.dispose();
    expect(fullPorts.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(await resolver.resolveAsset("assets/plot.png")).toBe("blob:full/1");
    expect(fullPorts.revokeObjectURL).toHaveBeenCalledWith("blob:full/1");
  });
});
