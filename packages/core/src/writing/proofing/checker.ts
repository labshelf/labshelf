// A spell checker over one Hunspell dictionary (hunspell-asm, loaded lazily so hosts bundle it as
// its own chunk), with the user's words added and prefix completion from the dictionary stems.
import type { DictionaryFiles } from "./port.js";
import { completeWord, stemIndex } from "./stems.js";

export interface SpellChecker {
  check(word: string): boolean;
  suggest(word: string, limit?: number): string[];
  addWord(word: string): void;
  complete(prefix: string, limit?: number): string[];
  dispose(): void;
}

type HunspellModule = typeof import("hunspell-asm");
type HunspellFactory = Awaited<ReturnType<HunspellModule["loadModule"]>>;

let factoryPromise: Promise<HunspellFactory> | null = null;
let mountCounter = 0;

function loadFactory(): Promise<HunspellFactory> {
  factoryPromise ??= import("hunspell-asm").then((module) => module.loadModule()).catch((error: unknown) => {
    factoryPromise = null;
    throw error;
  });
  return factoryPromise;
}

function normalise(word: string): string {
  return word.replaceAll("’", "'");
}

function isTitleCase(word: string): boolean {
  if (word.length < 2) { return false; }
  const lower = word.toLocaleLowerCase();
  return word !== lower && word === lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

function capitalise(word: string): string {
  return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}

/** Creates a checker for one dictionary; `userWords` are accepted as spelled. */
export async function createSpellChecker(files: DictionaryFiles, userWords: readonly string[]): Promise<SpellChecker> {
  const factory = await loadFactory();
  mountCounter += 1;
  const affPath = factory.mountBuffer(files.aff, `labshelf-${mountCounter}.aff`);
  const dicPath = factory.mountBuffer(files.dic, `labshelf-${mountCounter}.dic`);
  const hunspell = factory.create(affPath, dicPath);
  stemIndex(files.dic);
  const added: string[] = [];
  let disposed = false;

  const addWord = (word: string): void => {
    const clean = normalise(word.trim());
    if (!clean || disposed) { return; }
    hunspell.addWord(clean);
    if (!added.includes(clean)) { added.push(clean); }
  };
  for (const word of userWords) { addWord(word); }

  const check = (word: string): boolean => {
    if (disposed) { return true; }
    const clean = normalise(word);
    if (!clean) { return true; }
    if (hunspell.spell(clean)) { return true; }
    return isTitleCase(clean) && hunspell.spell(clean.toLocaleLowerCase());
  };

  return {
    check,
    addWord,
    suggest(word: string, limit = 8): string[] {
      if (disposed || limit <= 0) { return []; }
      return [...new Set(hunspell.suggest(normalise(word)))].slice(0, limit);
    },
    complete(prefix: string, limit = 20): string[] {
      if (disposed) { return []; }
      const clean = normalise(prefix);
      const found = completeWord(files, clean, { limit, accept: check, extra: added });
      if (!isTitleCase(clean) || found.length >= limit) { return found; }
      const lowered = completeWord(files, clean.toLocaleLowerCase(), { limit, accept: check, extra: added }).map(capitalise);
      return [...new Set([...found, ...lowered])].slice(0, limit);
    },
    dispose(): void {
      if (disposed) { return; }
      disposed = true;
      hunspell.dispose();
      factory.unmount(affPath);
      factory.unmount(dicPath);
    },
  };
}
