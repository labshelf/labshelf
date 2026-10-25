/** Looks up Google Books volumes by ISBN. */
import { parseString, extractYear } from "../metadata/index.js";
import { fetchJson, type RegistryEnv } from "./http.js";
import { parseXmlText } from "./text.js";
import type { RegistryEntry } from "./registryMetadata.js";

interface GoogleBooksVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publishedDate?: string;
  publisher?: string;
  pageCount?: number;
  description?: string;
  language?: string;
  infoLink?: string;
}

/**
 * Looks up a book by ISBN through Google Books, which carries descriptions and
 * page counts for many editions OpenLibrary has only a stub for.
 * @returns Book metadata, or undefined.
 */
export async function fetchGoogleBooksByIsbn(env: RegistryEnv, isbn: string): Promise<RegistryEntry | undefined> {
  const payload = await fetchJson<{ items?: Array<{ volumeInfo?: GoogleBooksVolumeInfo }> }>(
    env,
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}`,
  );
  const volume = payload?.items?.[0]?.volumeInfo;
  if (!volume?.title) {
    return undefined;
  }

  return {
    title: volume.subtitle ? `${volume.title}: ${volume.subtitle}` : volume.title,
    authors: (volume.authors ?? []).filter((name): name is string => Boolean(name)),
    year: extractYear(volume.publishedDate),
    publisher: parseString(volume.publisher),
    pages: volume.pageCount ? String(volume.pageCount) : undefined,
    url: parseString(volume.infoLink),
    language: parseString(volume.language),
    summary: volume.description ? parseXmlText(volume.description) : undefined,
  };
}
