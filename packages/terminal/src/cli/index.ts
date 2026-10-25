// Exports the CLI's public API: the subcommands terminalEntry.ts calls to run `labshelf <command>`.
export { runDoctor } from "./doctor.js";
export { isNativeHostCommand, refreshSystemLaunchers, runSystemNativeHostCommand } from "./nativeHost/index.js";
export { runLibraryCommand } from "./libraryCommands.js";
export { USAGE, UsageError, type Output } from "./usage.js";
export { parseArgs, stringFlag, type ParsedArgs } from "./args.js";
export { dumpFrame } from "./dumpFrame.js";
export { withPrompt } from "./ask.js";
export { runConflicts } from "./conflictsCommand.js";
export { promptForLibrary, runMove } from "./libraryLocation/index.js";
export { syncGuideText } from "./syncGuide/index.js";
