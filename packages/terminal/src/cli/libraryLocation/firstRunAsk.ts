// Asks where a first-run library should live: a detected sync folder, the local folder, a typed path or the sync guide.
import { syncGuide, type ILogger } from "@labshelf/core";
import { detectSyncFolders, inspectLibraryFolder } from "@labshelf/core/node";

import { expandHome } from "../../platform/index.js";
import type { Output } from "../usage.js";
import { firstRunChoices, type FirstRunChoice } from "./firstRunChoices.js";
import { libraryTargetFor } from "./pickLibraryDir.js";
import type { Ask } from "../ask.js";
import { syncGuideText } from "../syncGuide/index.js";

export interface FirstRunSite {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  logger?: ILogger | undefined;
}

function printChoices(choices: readonly FirstRunChoice[], io: Output): void {
  const width = Math.max(...choices.map((choice) => choice.label.length));
  io.err("Where should your library live?");
  choices.forEach((choice, index) => {
    const detail = choice.kind === "folder" ? `  ${choice.detail}` : "";
    io.err(`  ${index + 1}) ${choice.label.padEnd(choice.kind === "folder" ? width : 0)}${detail}`);
  });
}

// An existing library is opened only after the user confirms it.
async function confirmFolder(target: string, ask: Ask): Promise<boolean> {
  const info = await inspectLibraryFolder(target);
  if (!info.isLibrary) { return true; }
  const answer = await ask(`Found your library with ${info.paperCount} papers. Open it? [Y/n] `);
  return answer !== undefined && !/^n/i.test(answer);
}

async function resolveChoice(choice: FirstRunChoice, io: Output, ask: Ask): Promise<string | undefined | "again"> {
  if (choice.kind === "guide") {
    io.err(`\n${syncGuideText(syncGuide)}\n`);
    return "again";
  }
  let target: string;
  if (choice.kind === "custom") {
    const typed = await ask("Folder: ");
    if (typed === undefined) { return undefined; }
    if (!typed) { return "again"; }
    target = await libraryTargetFor(expandHome(typed));
  } else {
    target = choice.path;
  }
  return (await confirmFolder(target, ask)) ? target : "again";
}

/**
 * Lists the choices until the user picks a folder.
 * @returns the chosen library folder, or undefined when the input ends
 */
export async function promptForLibrary(site: FirstRunSite, io: Output, ask: Ask): Promise<string | undefined> {
  const folders = await detectSyncFolders(site);
  const choices = firstRunChoices(folders, site.home);
  io.err("No LabShelf library is configured yet.");
  for (;;) {
    printChoices(choices, io);
    const answer = await ask(`Choose 1-${choices.length}: `);
    if (answer === undefined) { return undefined; }
    const choice = choices[Number(answer) - 1];
    if (!choice) { io.err(`Type a number from 1 to ${choices.length}.`); continue; }
    const result = await resolveChoice(choice, io, ask);
    if (result !== "again") { return result; }
  }
}
