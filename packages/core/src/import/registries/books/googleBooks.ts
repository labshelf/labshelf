/** Google Books client: book lookup by ISBN. */
import { extractYear } from "../../metadata/index.js";
import { fetchJson } from "../http.js";
import { stripHtml, trimmed } from "../text.js";
import type { RegistryRecord } from "../types.js";

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
export async function googleBooksByIsbn(isbn: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ items?: Array<{ volumeInfo?: GoogleBooksVolumeInfo }> }>(
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
    publisher: trimmed(volume.publisher),
    pages: volume.pageCount ? String(volume.pageCount) : undefined,
    url: trimmed(volume.infoLink),
    language: trimmed(volume.language),
    summary: volume.description ? stripHtml(volume.description) : undefined,
  };
}
