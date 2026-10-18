// Declares what the helper keeps for one open project.
export interface UnsavedText { text: string; version: number }

export interface OpenProject {
  /** Real, confined path of the project folder in the library. */
  root: string;
  unsaved: Map<string, UnsavedText>;
  /** What `syncWorkingCopy` last wrote into the working copy, by project path. */
  synced: Map<string, string>;
}
