/** Describes the host's open editors, whose unsaved text wins over the disk when reading a project's sources. */

export interface OpenSources {
  /** The text of an open document, or undefined when the file is not open. */
  text(file: string): string | undefined;
  /** Replaces the whole text of an open document; false when the file is not open. */
  replace(file: string, text: string): Promise<boolean>;
}
