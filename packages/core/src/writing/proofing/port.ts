// The port through which hosts keep spelling dictionaries and the user's own words.

/** The two Hunspell files of one dictionary. */
export interface DictionaryFiles { aff: Uint8Array; dic: Uint8Array }

/**
 * Machine-local dictionary storage: VS Code global storage, the browser's extension storage.
 * Dictionaries and user words are never written to the library or a project.
 */
export interface DictionaryStore {
  /** Installed BCP-47 tags, bundled ones included. */
  list(): Promise<string[]>;
  /** The files of an installed dictionary, or null when it is not installed. */
  read(tag: string): Promise<DictionaryFiles | null>;
  /** Downloads and keeps a dictionary; throws an Error with a readable message on failure. */
  install(tag: string): Promise<void>;
  /** Words the user added to the dictionary, in any language. */
  userWords(): Promise<string[]>;
  addUserWord(word: string): Promise<void>;
}
