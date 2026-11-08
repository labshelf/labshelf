// The spelling dictionaries LabShelf knows: each BCP-47 tag's npm package, pinned version and
// license, which ones ship with the app, and how a host downloads the others from jsDelivr.
import type { DictionaryFiles } from "./port.js";

export interface DictionaryEntry {
  readonly tag: string;
  readonly name: string;
  readonly package: string;
  readonly version: string;
  /** Shipped with the hosts; the others are downloaded on demand. */
  readonly bundled: boolean;
  readonly license: string;
}

type Row = readonly [tag: string, name: string, pkg: string, version: string, license: string];

const GPL2_LGPL21_MPL11 = "GPL-2.0 OR LGPL-2.1 OR MPL-1.1";
const GPL2_GPL3 = "GPL-2.0 OR GPL-3.0";
const GPL3_LGPL3_MPL11 = "GPL-3.0 OR LGPL-3.0 OR MPL-1.1";
const MIT_BSD = "MIT AND BSD";

const ROWS: readonly Row[] = [
  ["en-US", "English (United States)", "dictionary-en", "4.0.0", MIT_BSD],
  ["pt-BR", "Português (Brasil)", "dictionary-pt", "4.0.0", "LGPL-3.0 OR MPL-2.0"],
  ["en-GB", "English (United Kingdom)", "dictionary-en-gb", "3.0.0", MIT_BSD],
  ["en-AU", "English (Australia)", "dictionary-en-au", "3.0.0", MIT_BSD],
  ["en-CA", "English (Canada)", "dictionary-en-ca", "3.0.0", MIT_BSD],
  ["pt-PT", "Português (Portugal)", "dictionary-pt-pt", "2.0.0", GPL2_LGPL21_MPL11],
  ["fr", "Français", "dictionary-fr", "3.0.0", "MPL-2.0"],
  ["de", "Deutsch", "dictionary-de", "3.0.0", GPL2_GPL3],
  ["de-AT", "Deutsch (Österreich)", "dictionary-de-at", "3.0.0", GPL2_GPL3],
  ["de-CH", "Deutsch (Schweiz)", "dictionary-de-ch", "3.0.0", GPL2_GPL3],
  ["es", "Español", "dictionary-es", "4.0.0", GPL3_LGPL3_MPL11],
  ["es-MX", "Español (México)", "dictionary-es-mx", "2.0.0", GPL3_LGPL3_MPL11],
  ["it", "Italiano", "dictionary-it", "2.0.0", "GPL-3.0"],
  ["nl", "Nederlands", "dictionary-nl", "2.0.0", "BSD-3-Clause OR CC-BY-3.0"],
  ["pl", "Polski", "dictionary-pl", "2.0.0", "GPL-3.0 OR LGPL-3.0 OR MPL-2.0"],
  ["ru", "Русский", "dictionary-ru", "3.0.0", "BSD-3-Clause"],
  ["uk", "Українська", "dictionary-uk", "4.0.0", "GPL-3.0"],
  ["ca", "Català", "dictionary-ca", "3.0.0", "GPL-2.0 OR LGPL-2.1"],
  ["cs", "Čeština", "dictionary-cs", "4.0.0", "GPL-2.0"],
  ["da", "Dansk", "dictionary-da", "6.0.0", GPL2_LGPL21_MPL11],
  ["sv", "Svenska", "dictionary-sv", "4.0.0", "LGPL-3.0"],
  ["nb", "Norsk bokmål", "dictionary-nb", "3.0.0", "GPL-2.0"],
  ["nn", "Norsk nynorsk", "dictionary-nn", "3.0.0", "GPL-2.0"],
  ["el", "Ελληνικά", "dictionary-el", "4.0.0", GPL2_LGPL21_MPL11],
  ["el-polyton", "Ελληνικά (πολυτονικά)", "dictionary-el-polyton", "2.0.0", "GPL-3.0"],
  ["tr", "Türkçe", "dictionary-tr", "2.0.0", "MIT"],
  ["ro", "Română", "dictionary-ro", "3.0.0", GPL2_LGPL21_MPL11],
  ["hu", "Magyar", "dictionary-hu", "3.0.0", GPL2_LGPL21_MPL11],
  ["bg", "Български", "dictionary-bg", "2.0.0", GPL2_LGPL21_MPL11],
  ["br", "Brezhoneg", "dictionary-br", "2.0.0", GPL2_LGPL21_MPL11],
  ["cy", "Cymraeg", "dictionary-cy", "2.0.0", "LGPL-3.0"],
  ["eo", "Esperanto", "dictionary-eo", "2.0.0", "GPL-2.0"],
  ["et", "Eesti", "dictionary-et", "2.0.0", "LGPL-2.1"],
  ["eu", "Euskara", "dictionary-eu", "4.0.0", "GPL-2.0"],
  ["fa", "فارسی", "dictionary-fa", "2.0.0", "Apache-2.0"],
  ["fo", "Føroyskt", "dictionary-fo", "3.0.0", GPL2_LGPL21_MPL11],
  ["fy", "Frysk", "dictionary-fy", "2.0.0", "GPL-3.0"],
  ["ga", "Gaeilge", "dictionary-ga", "3.0.0", "GPL-2.0"],
  ["gd", "Gàidhlig", "dictionary-gd", "2.0.0", "GPL-3.0"],
  ["gl", "Galego", "dictionary-gl", "3.0.0", "GPL-3.0"],
  ["he", "עברית", "dictionary-he", "2.0.0", "AGPL-3.0"],
  ["hr", "Hrvatski", "dictionary-hr", "2.0.0", "LGPL-2.1 OR SISSL"],
];

const BUNDLED = new Set(["en-US", "pt-BR"]);

export const DICTIONARY_CATALOG: readonly DictionaryEntry[] = ROWS.map(([tag, name, pkg, version, license]) => ({
  tag, name, package: pkg, version, bundled: BUNDLED.has(tag), license,
}));

const BY_TAG = new Map(DICTIONARY_CATALOG.map((entry) => [entry.tag, entry]));

/** The catalog entry of a tag; throws for a tag LabShelf has no dictionary for. */
function dictionaryEntry(tag: string): DictionaryEntry {
  const entry = BY_TAG.get(tag);
  if (!entry) { throw new Error(`No spelling dictionary is known for the language "${tag}".`); }
  return entry;
}

/** The jsDelivr URLs of a tag's `.aff` and `.dic` files at the pinned version. */
export function dictionaryUrls(tag: string): { aff: string; dic: string } {
  const { package: pkg, version } = dictionaryEntry(tag);
  const base = `https://cdn.jsdelivr.net/npm/${pkg}@${version}`;
  return { aff: `${base}/index.aff`, dic: `${base}/index.dic` };
}

/** The part of a fetch Response the download reads. */
interface DictionaryResponse { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }
export type DictionaryFetch = (url: string) => Promise<DictionaryResponse>;

async function download(fetchFn: DictionaryFetch, url: string, label: string): Promise<Uint8Array> {
  let response: DictionaryResponse;
  try {
    response = await fetchFn(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not download the ${label} (${url}): ${reason}`);
  }
  if (!response.ok) { throw new Error(`Could not download the ${label}: the server answered ${response.status} for ${url}.`); }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) { throw new Error(`Could not download the ${label}: ${url} is empty.`); }
  return bytes;
}

// Word frequencies: hermitdave/FrequencyWords (CC-BY-SA-4.0), the 2018 OpenSubtitles `<code>_50k.txt` lists at a pinned commit.
const FREQUENCY_COMMIT = "525f9b560de45753a5ea01069454e72e9aa541c6";
const FREQUENCY_CODES = new Set(["bg", "br", "ca", "cs", "da", "de", "el", "en", "eo", "es", "et", "eu", "fa", "fr", "gl", "he", "hr", "hu", "it", "nl", "no", "pl", "pt", "ro", "ru", "sv", "tr", "uk"]);
const FREQUENCY_OVERRIDES: Readonly<Record<string, string | null>> = { "pt-BR": "pt_br", nb: "no", nn: null, "el-polyton": null };

/** The FrequencyWords list code of a tag (pt-BR → pt_br, en-GB → en), or null when that language has no list. */
export function frequencyCode(tag: string): string | null {
  const override = FREQUENCY_OVERRIDES[tag];
  if (override !== undefined) { return override; }
  const base = tag.split("-", 1)[0]?.toLowerCase() ?? "";
  return FREQUENCY_CODES.has(base) ? base : null;
}

/** The jsDelivr URL of a tag's word frequency list, or null when its language has none. */
export function frequencyUrl(tag: string): string | null {
  const code = frequencyCode(tag);
  return code === null ? null : `https://cdn.jsdelivr.net/gh/hermitdave/FrequencyWords@${FREQUENCY_COMMIT}/content/2018/${code}/${code}_50k.txt`;
}

/** Downloads a tag's dictionary files and, when it can, its frequency list; only a dictionary failure throws, with a readable message. */
export async function fetchDictionary(tag: string, fetchFn: DictionaryFetch): Promise<DictionaryFiles> {
  const entry = dictionaryEntry(tag);
  const urls = dictionaryUrls(tag);
  const freqUrl = frequencyUrl(tag);
  const [aff, dic, freq] = await Promise.all([
    download(fetchFn, urls.aff, `${entry.name} affix file`),
    download(fetchFn, urls.dic, `${entry.name} word list`),
    // Completions rank by the document alone without the list, so a failed download is not an install failure.
    freqUrl === null ? undefined : download(fetchFn, freqUrl, `${entry.name} word frequencies`).catch(() => undefined),
  ]);
  return freq ? { aff, dic, freq } : { aff, dic };
}
