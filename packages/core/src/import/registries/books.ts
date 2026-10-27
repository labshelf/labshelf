/** Looks up books by ISBN in OpenLibrary and Google Books. */
import { extractYear, parseString } from "./metadata.js";
import { fetchJson, parseXmlText, type RegistryEntry, type RegistryEnv } from "./http.js";

// OpenLibrary

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  publishers?: Array<{ name: string }>;
  publish_date?: string;
  number_of_pages?: number;
  url?: string;
}

/**
 * Looks up a book by ISBN through OpenLibrary.
 * @returns Book metadata, or undefined.
 */
export async function openLibraryByIsbn(env: RegistryEnv, isbn: string): Promise<RegistryEntry | undefined> {
  const key = `ISBN:${isbn}`;
  const payload = await fetchJson<Record<string, OpenLibraryBook>>(
    env,
    `https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=${encodeURIComponent(key)}`,
  );
  const book = payload?.[key];
  if (!book?.title) {
    return undefined;
  }

  return {
    title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
    authors: (book.authors ?? []).map((author) => author.name).filter(Boolean),
    year: extractYear(book.publish_date),
    publisher: book.publishers?.[0]?.name,
    pages: book.number_of_pages ? String(book.number_of_pages) : undefined,
    url: book.url,
  };
}

// Google Books

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
