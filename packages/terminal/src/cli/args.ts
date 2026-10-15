// Parses the labshelf argv into a command word, positionals and long/short flags.
import { parseArgs as nodeParseArgs } from "node:util";

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

// Value flags take "--to ML", "--to=ML" or "-o refs.bib"; every other flag is a boolean. `short` maps "-L" to --library.
const OPTIONS = {
  library: { type: "string", short: "L" },
  to: { type: "string" },
  output: { type: "string", short: "o" },
  collection: { type: "string", short: "c" },
  "dump-frame": { type: "string" },
  keys: { type: "string" },
  sort: { type: "string" },
  recursive: { type: "boolean", short: "r" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  json: { type: "boolean", short: "j" },
} as const;

/**
 * Unknown flags are kept (booleans, or strings with "="). A single-dash argument that is not exactly a known short flag
 * ("-a", "-5", "-rv", "-Lx") stays a positional, so `tag p1 -a` removes the tag "a".
 * @returns the parsed arguments
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const { tokens } = nodeParseArgs({ args: argv, options: OPTIONS, strict: false, allowPositionals: true, tokens: true });
  const positionals: string[] = [];
  const flags: ParsedArgs["flags"] = {};
  let rawIndex = -1;
  for (const token of tokens) {
    if (token.kind === "positional") {
      positionals.push(token.value);
    } else if (token.kind === "option") {
      const raw = argv[token.index]!;
      const knownShort = raw === token.rawName && Object.hasOwn(OPTIONS, token.name);
      if (raw.startsWith("--") || knownShort) {
        flags[token.name] = token.value ?? true;
        continue;
      }
      if (rawIndex !== token.index) positionals.push(raw);
      rawIndex = token.index;
      // A group like "-rL /lib" made node read the next argument as the value of -L.
      if (token.value !== undefined && !token.inlineValue) positionals.push(token.value);
    }
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

/**
 * @returns a string flag value, or undefined
 */
export function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}
