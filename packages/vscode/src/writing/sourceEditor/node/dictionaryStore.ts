// The machine-local spelling dictionaries for the extension host: the bundled ones beside the extension, the downloaded ones and the user's words under the global storage.
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fetchDictionary, type DictionaryFetch, type DictionaryFiles, type DictionaryStore, type ILogger } from "@labshelf/core";

const MODULE = "writing/sourceEditor";
const AFF = "index.aff";
const DIC = "index.dic";
/** The language's word frequency list, optional: completions rank by the document alone without it. */
const FREQ = "frequency.txt";
const WORDS_FILE = "words.txt";
/** A BCP-47 tag as a folder name: letters, digits and hyphens only, so a tag never leaves the dictionaries folder. */
const TAG_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

export interface NodeDictionaryStoreOptions {
  /** `<extension>/dist/dictionaries`: one folder per bundled tag. */
  bundledDir: string;
  /** `<globalStorage>/dictionaries`: one folder per installed tag, and words.txt. */
  storageDir: string;
  /** The download function; the host's global fetch. */
  fetchFn: DictionaryFetch;
  logger: ILogger;
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/** The tags under a folder that hold both dictionary files; an absent folder has none. */
async function tagsIn(dir: string): Promise<string[]> {
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const found: string[] = [];
  for (const name of names) {
    if (TAG_PATTERN.test(name) && await isFile(join(dir, name, AFF)) && await isFile(join(dir, name, DIC))) { found.push(name); }
  }
  return found;
}

async function readFiles(dir: string): Promise<DictionaryFiles | null> {
  try {
    const [aff, dic, freq] = await Promise.all([readFile(join(dir, AFF)), readFile(join(dir, DIC)), readFile(join(dir, FREQ)).catch(() => undefined)]);
    return freq ? { aff: new Uint8Array(aff), dic: new Uint8Array(dic), freq: new Uint8Array(freq) } : { aff: new Uint8Array(aff), dic: new Uint8Array(dic) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return null; }
    throw error;
  }
}

export class NodeDictionaryStore implements DictionaryStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: NodeDictionaryStoreOptions) {}

  private checkedTag(tag: string): string {
    if (!TAG_PATTERN.test(tag)) { throw new Error(`"${tag}" is not a language tag.`); }
    return tag;
  }

  async list(): Promise<string[]> {
    const { bundledDir, storageDir } = this.options;
    const [bundled, installed] = await Promise.all([tagsIn(bundledDir), tagsIn(storageDir)]);
    return [...new Set([...bundled, ...installed])].sort();
  }

  async read(tag: string): Promise<DictionaryFiles | null> {
    this.checkedTag(tag);
    return await readFiles(join(this.options.bundledDir, tag)) ?? await readFiles(join(this.options.storageDir, tag));
  }

  async install(tag: string): Promise<void> {
    this.checkedTag(tag);
    if (await this.read(tag)) { return; }
    const { storageDir, fetchFn, logger } = this.options;
    const target = join(storageDir, tag);
    const temp = join(storageDir, `${tag}.tmp-${process.pid}-${Date.now()}`);
    try {
      const files = await fetchDictionary(tag, fetchFn);
      await mkdir(temp, { recursive: true });
      await Promise.all([writeFile(join(temp, AFF), files.aff), writeFile(join(temp, DIC), files.dic), ...(files.freq ? [writeFile(join(temp, FREQ), files.freq)] : [])]);
      try {
        await rename(temp, target);
      } catch (error) {
        // Another install of the tag finished first: its folder is as good as ours.
        if (!(await this.read(tag))) { throw error; }
      }
    } catch (error) {
      void logger.error(MODULE, error, { action: "installDictionary", tag });
      throw new Error(error instanceof Error ? error.message : `Could not install the dictionary for ${tag}: ${String(error)}`, { cause: error });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  async userWords(): Promise<string[]> {
    let text: string;
    try { text = await readFile(join(this.options.storageDir, WORDS_FILE), "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
      void this.options.logger.error(MODULE, error, { action: "readUserWords" });
      throw new Error(`Could not read your dictionary words: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  }

  async addUserWord(word: string): Promise<void> {
    const clean = word.trim();
    if (clean === "" || /[\r\n]/.test(clean)) { throw new Error("A dictionary word is one word on one line."); }
    // One write at a time, so two quick additions never interleave or repeat a word.
    const next = this.writes.then(async () => {
      if ((await this.userWords()).includes(clean)) { return; }
      await mkdir(this.options.storageDir, { recursive: true });
      await appendFile(join(this.options.storageDir, WORDS_FILE), `${clean}\n`, "utf8");
    });
    this.writes = next.catch(() => undefined);
    try { await next; } catch (error) {
      void this.options.logger.error(MODULE, error, { action: "addUserWord" });
      throw new Error(`Could not save "${clean}" to your dictionary: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}
