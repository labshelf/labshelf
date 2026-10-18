// Declares what the desktop and the web composition roots hand the shared activation: adapters and the flows that differ.
import type * as vscode from "vscode";

import type { WritingProjects } from "../writing/index.js";
import type { RegisterPlatformWriting } from "../writing/platformPort/index.js";
import type { LibraryRootController } from "./libraryLifecycle/index.js";
import type { HostAdapters } from "./serviceComposition/index.js";

export interface ExtensionPlatform {
  adapters: HostAdapters;
  registerWriting: RegisterPlatformWriting;
  /** Asks where the library lives and records the answer; undefined when the user cancelled. */
  chooseLibraryRoot(): Promise<vscode.Uri | undefined>;
  /** Runs once a saved library opened; the desktop offers to move it into a sync folder. */
  afterSavedLibraryOpened?(controller: LibraryRootController): Promise<void>;
  /** Registers the commands only this platform has; the manifest hides them elsewhere. */
  registerPlatformCommands?(context: vscode.ExtensionContext, controller: LibraryRootController, projects: WritingProjects): void;
}
