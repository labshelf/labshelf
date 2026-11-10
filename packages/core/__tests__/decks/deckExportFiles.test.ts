// Tests exportDeckFromFiles (spec 3.2, D13): the share hosts' deck export read lifted into core. It reads deck.html, the theme.css beside it
// and assets resolved against the deck folder, hands them to exportDeckHtml and names the deck after its folder.
// Written as if the file sat at packages/core/__tests__/decks/deckExportFiles.test.ts; relative imports are resolved from there.
import * as path from "node:path";
import { exportDeckFromFiles, type DeckFileIo } from "../../src/decks/deckExportFiles.js";
import { exportDeckHtml } from "../../src/decks/deckExport.js";
import { block, talk } from "./deckSamples.js";

const FOLDER = "/lib/projects/thesis/talk-one";
const DECK_PATH = `${FOLDER}/deck.html`;
const THEME = ":root { --deck-bg: #fafafa; --deck-fg: #202020; }\n";
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7]);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const SOURCE = talk(block("pic", '<img src="assets/plot.png" alt="Plot">'));

/** A DeckFileIo over an in-memory file map keyed by absolute POSIX path. */
function memoryIo(files: Map<string, Uint8Array>): DeckFileIo {
  return {
    read: async (file) => files.get(file),
    dirname: (file) => path.posix.dirname(file),
    basename: (file) => path.posix.basename(file),
    resolve: (folder, relative) => path.posix.resolve(folder, relative),
  };
}

const deckFiles = (): Map<string, Uint8Array> => new Map([
  [DECK_PATH, encode(SOURCE)],
  [`${FOLDER}/theme.css`, encode(THEME)],
  [`${FOLDER}/assets/plot.png`, PNG],
]);

describe("exportDeckFromFiles", () => {
  it("3.2a returns the same html as exportDeckHtml for a deck with theme.css and an image asset", async () => {
    const out = await exportDeckFromFiles(DECK_PATH, memoryIo(deckFiles()));
    const expected = await exportDeckHtml(SOURCE, {
      theme: THEME,
      readAsset: async (asset) => (asset === "assets/plot.png" ? PNG : undefined),
    });
    expect(out.html).toBe(expected);
    expect(out.html).toContain(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
  });

  it("3.2a names the deck after its folder", async () => {
    const out = await exportDeckFromFiles(DECK_PATH, memoryIo(deckFiles()));
    expect(out.name).toBe("talk-one");
  });

  it("3.2a returns the deck.html text as source", async () => {
    const out = await exportDeckFromFiles(DECK_PATH, memoryIo(deckFiles()));
    expect(out.source).toBe(SOURCE);
  });

  it("3.2a resolves assets against the deck folder, not the library root", async () => {
    const files = deckFiles();
    files.delete(`${FOLDER}/assets/plot.png`);
    files.set("/lib/assets/plot.png", Uint8Array.from([1, 2, 3]));
    const out = await exportDeckFromFiles(DECK_PATH, memoryIo(files));
    expect(out.html).not.toContain(Buffer.from([1, 2, 3]).toString("base64"));
    expect(out.html).toContain('src="assets/plot.png"');
  });

  it("3.2a inlines the theme.css beside the deck", async () => {
    const out = await exportDeckFromFiles(DECK_PATH, memoryIo(deckFiles()));
    expect(out.html).toContain("--deck-bg: #fafafa");
  });
});
