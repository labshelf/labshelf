// Runs `labshelf conflicts`: lists the sync-tool conflict copies in the library and, on a terminal, resolves each.
import * as path from "node:path";

import { FileProjectVersionStore, conflictPromptChoices, conflictResolutions, contentConflictMessage, type ConflictCopy, type ConflictResolution, type ILogger } from "@labshelf/core";
import {
  NodeLibraryFileSystem, deviceLocalLayout, resolveConflictCopy, resolveProjectConflictCopy, scanLibraryConflicts,
} from "@labshelf/core/node";

import type { Output } from "../usage.js";
import type { Ask } from "./prompt.js";

const RESOLUTIONS: Record<string, ConflictResolution> = { m: "keepMine", o: "keepOther", b: "keepBoth", a: "mergeAutomatically", n: "notAVersion" };

function describe(root: string, conflict: ConflictCopy): string {
  return `${conflict.owner.id}  ${path.relative(root, conflict.copy)}  (${conflict.tool})`;
}

const PROMPTS: Partial<Record<ConflictResolution, string>> = { keepMine: "[m]ine", keepOther: "[o]ther", keepBoth: "[b]oth" };
const CONTENT_KEYS: Record<string, string> = { mergeAutomatically: "a", mergeMyself: "m", notAVersion: "n" };

function question(conflict: ConflictCopy): string {
  const choices = conflict.match && conflict.match !== "name"
    ? conflictPromptChoices(conflict).map(({ resolution, label }) => `[${CONTENT_KEYS[resolution]}] ${label}`)
    : conflictResolutions(conflict).map((resolution) => PROMPTS[resolution]);
  return `  ${choices.join(" / ")} / [s]kip: `;
}

async function resolveInteractively(root: string, conflict: ConflictCopy, io: Output, ask: Ask, logger: ILogger, store: FileProjectVersionStore): Promise<boolean> {
  const content = conflict.match && conflict.match !== "name";
  io.out(content ? contentConflictMessage(conflict) : describe(root, conflict));
  for (;;) {
    const answer = (await ask(question(conflict)))?.toLowerCase();
    if (answer === undefined) { return false; }
    if (answer === "s") { return true; }
    if (content && answer === "m") {
      io.out(`${conflict.original}\n${conflict.copy}`);
      return true;
    }
    const resolution = RESOLUTIONS[answer];
    if (!resolution || !conflictResolutions(conflict).includes(resolution)) { continue; }
    if (resolution === "mergeAutomatically" || resolution === "notAVersion") {
      await resolveProjectConflictCopy(conflict, resolution, { root, store, logger });
    } else { await resolveConflictCopy(conflict, resolution, logger); }
    return true;
  }
}

/**
 * Without `ask` (stdin is not a terminal) the copies are only listed.
 * @returns the exit code: 0
 */
export async function runConflicts(root: string, io: Output, ask: Ask | undefined, logger: ILogger): Promise<number> {
  const store = new FileProjectVersionStore(new NodeLibraryFileSystem(), path, deviceLocalLayout(root).mergeBasesDir);
  const conflicts = await scanLibraryConflicts(root, store, logger);
  if (conflicts.length === 0) {
    io.out("No conflicting copies.");
    return 0;
  }
  if (!ask) {
    io.out(conflicts.map((conflict) => describe(root, conflict)).join("\n"));
    return 0;
  }
  for (const conflict of conflicts) {
    if (!(await resolveInteractively(root, conflict, io, ask, logger, store))) { break; }
  }
  return 0;
}
