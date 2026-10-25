// Runs the `labshelf` command: resolves the library, then opens the TUI or runs a subcommand.
// A first run without a configured library asks for its folder and saves it in the shared config file.
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

import { Logger, PAPERS_DIR, RESEARCH_DIR, formatError, syncGuide } from "@labshelf/core";
import { FileLogSink, createDeviceLocalLayout, resolveSharedConfigPath, updateSharedConfig } from "@labshelf/core/node";

import { openLibrary, type AppContext } from "./compositionRoot.js";
import { loadTerminalConfig, resolveLibraryRoot, type TerminalConfig } from "./config.js";
import {
  dumpFrame, isNativeHostCommand, parseArgs, promptForLibrary, refreshSystemLaunchers, runConflicts, runDoctor, runLibraryCommand, runMove,
  runSystemNativeHostCommand, stringFlag, syncGuideText, USAGE, UsageError, withPrompt, type Output, type ParsedArgs,
} from "./cli/index.js";
import { ensureLibraryStructure, LibraryRoot, looksLikeLibrary } from "./library/index.js";
import { expandHome } from "./platform/index.js";
import { App } from "./libraryUi/libraryScreen/index.js";
import { sanitizeForTerminal, Terminal } from "./screen/index.js";

const VERSION = "0.1.0";
const DEFAULT_LIBRARY = "~/LabShelf";

// Everything the CLI prints may contain metadata from PDFs or other devices; control characters never pass through.
const io: Output = {
  out: (text) => process.stdout.write(sanitizeForTerminal(text.endsWith("\n") ? text : text + "\n")),
  err: (text) => process.stderr.write(sanitizeForTerminal(text.endsWith("\n") ? text : text + "\n")),
  columns: process.stdout.columns || 100,
};

async function adoptLibrary(raw: string): Promise<string> {
  const root = path.resolve(expandHome(raw));
  const existed = await looksLikeLibrary(root);
  await ensureLibraryStructure(new LibraryRoot(root));
  await updateSharedConfig({ libraryRoot: root });
  io.err(existed ? `Using the library at ${root}` : `Created a new library at ${root}`);
  io.err(`Remembered in ${resolveSharedConfigPath()} (the VS Code extension reads it too).`);
  return root;
}

function askForLibrary(): Promise<string | undefined> {
  const site = { home: os.homedir(), env: process.env, platform: process.platform };
  return withPrompt((ask) => promptForLibrary(site, io, ask));
}

const DIST_DIR = fileURLToPath(new URL(".", import.meta.url));

// The move and conflict commands run outside the TUI, so their log goes to the library's terminal log file.
function fileLogger(root: string): Logger {
  return new Logger([new FileLogSink(createDeviceLocalLayout(root).terminalLogPath)], { onSinkError: () => undefined });
}

async function resolveRoot(flag: string | undefined, config: TerminalConfig, interactive: boolean): Promise<{ root: string; source: string } | undefined> {
  const resolution = resolveLibraryRoot(flag, process.env, config);
  if (resolution.root) {
    if (await looksLikeLibrary(resolution.root)) { return { root: resolution.root, source: resolution.source }; }
    io.err(`${resolution.root} is not a LabShelf library (no ${PAPERS_DIR}/ or ${RESEARCH_DIR}/ folder).`);
    if (resolution.source !== "config" || !interactive) {
      io.err("Run `labshelf init <path>` to create one there.");
      return undefined;
    }
  }
  if (!interactive) {
    io.err("No LabShelf library configured. Run `labshelf init <path>` or pass --library <path>.");
    return undefined;
  }
  const answer = await askForLibrary();
  return answer ? { root: await adoptLibrary(answer), source: "config" } : undefined;
}

function printWhere(root: string, source: string): void {
  const paths = new LibraryRoot(root);
  io.out(`library  ${paths.root}  (from ${source})`);
  io.out(`config   ${resolveSharedConfigPath()}`);
  io.out(`log      ${createDeviceLocalLayout(paths.root).terminalLogPath}`);
}

async function runTui(ctx: AppContext): Promise<number> {
  const terminal = new Terminal();
  const app = new App(ctx, terminal);
  process.on("uncaughtException", (error) => {
    terminal.leave();
    void ctx.logger.error("terminal/main", error).finally(() => {
      io.err(`labshelf crashed: ${error.stack ?? error.message}`);
      process.exit(1);
    });
  });
  await app.run();
  return 0;
}

async function runOpenedLibrary(ctx: AppContext, args: ParsedArgs, tuiWanted: boolean): Promise<number> {
  try {
    const dump = stringFlag(args.flags, "dump-frame");
    if (dump) {
      await dumpFrame(ctx, dump, stringFlag(args.flags, "keys"), io.out);
      return 0;
    }
    if (tuiWanted) { return await runTui(ctx); }
    return await runLibraryCommand(ctx, args, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      return 2;
    }
    io.err(formatError(error));
    await ctx.logger.error("terminal/cli", error);
    return 1;
  } finally {
    await ctx.dispose();
  }
}

// Runs a command that needs no opened library and turns its failure into a message and an exit code.
async function runCommand(run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch (error) {
    io.err(formatError(error));
    return error instanceof UsageError ? 2 : 1;
  }
}

// Runs the commands that work on the library's location rather than an opened library; undefined for any other.
async function runLibraryFreeCommand(args: ParsedArgs, config: TerminalConfig, libraryFlag: string | undefined): Promise<number | undefined> {
  if (args.command === "init") {
    await adoptLibrary(args.positionals[0] ?? libraryFlag ?? config.libraryRoot ?? DEFAULT_LIBRARY);
    return 0;
  }
  if (args.command === "sync-help") {
    io.out(syncGuideText(syncGuide));
    return 0;
  }
  if (args.command === "move") {
    const root = resolveLibraryRoot(libraryFlag, process.env, config).root;
    const progress = process.stderr.isTTY ? (text: string) => process.stderr.write(text) : () => undefined;
    return runCommand(() => runMove(args.positionals, root, io, { logger: fileLogger, env: process.env, progress }));
  }
  if (isNativeHostCommand(args.command)) {
    const command = args.command;
    const flags = { replace: args.flags["replace"] === true };
    return runCommand(() => runSystemNativeHostCommand(command, args.positionals[0], flags, io, DIST_DIR));
  }
  if (args.command === "doctor") {
    const resolution = resolveLibraryRoot(libraryFlag, process.env, config);
    return runDoctor(resolution.root, resolution.source, config, io);
  }
  return undefined;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags["version"] === true) {
    io.out(VERSION);
    return 0;
  }
  if (args.flags["help"] === true || args.command === "help") {
    io.out(USAGE);
    return 0;
  }
  // Fire and forget: a launcher that cannot be refreshed must not change this run's output or exit code.
  if (!isNativeHostCommand(args.command)) void refreshSystemLaunchers(DIST_DIR);
  const config = await loadTerminalConfig();
  const libraryFlag = stringFlag(args.flags, "library");

  const code = await runLibraryFreeCommand(args, config, libraryFlag);
  if (code !== undefined) { return code; }

  const tuiWanted = args.command === undefined && !args.flags["dump-frame"];
  if (tuiWanted && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    io.err("The explorer needs an interactive terminal. Use a subcommand instead (labshelf --help).");
    return 2;
  }
  const resolved = await resolveRoot(libraryFlag, config, Boolean(process.stdin.isTTY && process.stderr.isTTY));
  if (!resolved) { return 1; }
  if (args.command === "where") {
    printWhere(resolved.root, resolved.source);
    return 0;
  }

  if (args.command === "conflicts") {
    const logger = fileLogger(resolved.root);
    const interactive = Boolean(process.stdin.isTTY);
    return runCommand(() => withPrompt((ask) => runConflicts(resolved.root, io, interactive ? ask : undefined, logger)));
  }

  const ctx = await openLibrary(resolved.root, {
    config,
    watch: tuiWanted,
    thumbnailWorkerUrl: new URL("./thumbnailWorker.mjs", import.meta.url),
  });
  return runOpenedLibrary(ctx, args, tuiWanted);
}

main(process.argv.slice(2)).then(
  (code) => {
    // Let stdout drain before exiting; open handles (watchers, timers) must not keep a finished command alive.
    process.stdout.write("", () => process.exit(code));
  },
  (error: unknown) => {
    io.err(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  },
);
