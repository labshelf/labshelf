// Runs the `labshelf` command: resolves the library, then opens the TUI or runs a subcommand.
// A first run without a configured library asks for its folder and saves it in the shared config file.
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import { PAPERS_DIR, RESEARCH_DIR } from "@labshelf/core";
import { sharedConfigPath, updateSharedConfig } from "@labshelf/core/node";

import { loadTerminalConfig, resolveLibraryRoot, type TerminalConfig } from "./app/config.js";
import { openLibrary, type AppContext } from "./app/context.js";
import { parseArgs, stringFlag, type ParsedArgs } from "./cli/args.js";
import { runDoctor, runLibraryCommand, USAGE, UsageError, type Output } from "./cli/index.js";
import { dumpFrame } from "./cli/dumpFrame.js";
import { ensureLibraryStructure, LibraryRoot, looksLikeLibrary } from "./library/index.js";
import { expandHome } from "./platform/index.js";
import { App } from "./ui/app/index.js";
import { sanitizeForTerminal } from "./tui/text.js";
import { Terminal } from "./tui/terminal.js";

const VERSION = "0.1.0";
const DEFAULT_LIBRARY = "~/LabShelfLibrary";

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
  io.err(`Remembered in ${sharedConfigPath()} (the VS Code extension reads it too).`);
  return root;
}

async function askForLibrary(): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    io.err("No LabShelf library is configured yet.");
    io.err(`If you use the VS Code extension, give the same folder (it contains ${PAPERS_DIR}/ and ${RESEARCH_DIR}/),`);
    io.err("so both apps — and Drive sync — work on one library.");
    const answer = (await rl.question(`Library folder [${DEFAULT_LIBRARY}]: `)).trim();
    return answer || DEFAULT_LIBRARY;
  } catch {
    return undefined;
  } finally {
    rl.close();
  }
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
  io.out(`config   ${sharedConfigPath()}`);
  io.out(`log      ${paths.layout.terminalLogPath()}`);
  io.out(`manifest ${paths.layout.manifestPath()}`);
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
    io.err(error instanceof Error ? error.message : String(error));
    await ctx.logger.error("terminal/cli", error);
    return 1;
  } finally {
    await ctx.dispose();
  }
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
  const config = await loadTerminalConfig();
  const libraryFlag = stringFlag(args.flags, "library");

  if (args.command === "init") {
    await adoptLibrary(args.positionals[0] ?? libraryFlag ?? config.libraryRoot ?? DEFAULT_LIBRARY);
    return 0;
  }
  if (args.command === "doctor") {
    const resolution = resolveLibraryRoot(libraryFlag, process.env, config);
    return runDoctor(resolution.root, resolution.source, config, io);
  }

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

  const ctx = await openLibrary(resolved.root, {
    config: await loadTerminalConfig(),
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
