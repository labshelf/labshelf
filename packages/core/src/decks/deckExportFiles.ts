/** The one deck export read shared by share and the remote library mirror: deck.html, the theme.css beside it and assets
 * resolved against the deck folder, handed to exportDeckHtml. The host supplies file reads and path operations. */
import { exportDeckHtml } from "./deckExport.js";

export interface DeckFileIo { read(path: string): Promise<Uint8Array | undefined>; dirname(path: string): string; basename(path: string): string; resolve(folder: string, relative: string): string }

export async function exportDeckFromFiles(deckPath: string, io: DeckFileIo): Promise<{ source: string; html: string; name: string }> {
  const folder = io.dirname(deckPath);
  const decoder = new TextDecoder();
  const deckBytes = await io.read(deckPath);
  if (!deckBytes) { throw new Error(`The deck ${deckPath} could not be read.`); }
  const source = decoder.decode(deckBytes);
  const theme = decoder.decode(await io.read(io.resolve(folder, "theme.css")) ?? new Uint8Array());
  const html = await exportDeckHtml(source, { theme, readAsset: (assetPath) => io.read(io.resolve(folder, assetPath)) });
  return { source, html, name: io.basename(folder) };
}
