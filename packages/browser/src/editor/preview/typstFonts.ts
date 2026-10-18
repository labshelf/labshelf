// Fetches Typst's default fonts for the in-page compiler, checking each against its pinned checksum.
import { TYPST_FONT_BASE_URL, TYPST_FONTS, type TypstFontFile } from "@labshelf/core/typst";

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchFont({ file, sha256 }: TypstFontFile): Promise<Uint8Array> {
  // The browser's HTTP cache keeps the fonts between page loads.
  const response = await fetch(`${TYPST_FONT_BASE_URL}${file}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Downloading the Typst font ${file} failed with ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== sha256) throw new Error(`The Typst font ${file} does not match its checksum`);
  return bytes;
}

export function loadTypstFonts(): Promise<Uint8Array[]> {
  return Promise.all(TYPST_FONTS.map(fetchFont));
}
