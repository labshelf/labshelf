// Declares what the desktop and the web composition roots hand the shared activation: adapters and the flows that differ.
import type * as vscode from "vscode";

import type { ILogger, LibraryUiHost, RunCellPort } from "@labshelf/core";

import type { WritingProjects } from "../writing/index.js";
import type { RegisterPlatformWriting } from "../writing/index.js";
import type { LibraryRootController } from "./libraryRootController.js";
import type { HostAdapters } from "./hostAdapters.js";

/** The ports the note hosts run cells, restart a note's process and install Python through. */
export interface CellHosts {
  runCell: RunCellPort;
  /** Stops the process of `language` that runs the cells of `noteKey`. */
  restartCell: NonNullable<LibraryUiHost["restartCell"]>;
  installPython: () => void;
}

export interface ExtensionPlatform {
  adapters: HostAdapters;
  registerWriting: RegisterPlatformWriting;
  /** Asks where the library lives and records the answer; undefined when the user cancelled. */
  chooseLibraryRoot(): Promise<vscode.Uri | undefined>;
  /** Runs once a saved library opened; the desktop offers to move it into a sync folder. */
  afterSavedLibraryOpened?(controller: LibraryRootController): Promise<void>;
  /** Registers the commands only this platform has; the manifest hides them elsewhere. */
  registerPlatformCommands?(context: vscode.ExtensionContext, controller: LibraryRootController, projects: WritingProjects): void;
  /** Builds the cell runner and the Python installer once per activation; absent where cells cannot run locally (the web). */
  createCellHosts?(context: vscode.ExtensionContext, logger: ILogger): CellHosts;
}
