// Builds latexmk's `$biber` setting, which runs the host's biber command with the project folder before latexmk's options and control file.
import { BIBER_FLAG } from "./biberArgs.js";

export interface BiberCommand {
  /** The program and its leading arguments, e.g. the helper executable; `--biber` is appended. */
  command: readonly string[];
  /** The project folder, which bounds the files biber may read. */
  root: string;
}

// PLATFORM: latexmk runs the command through `sh`, so each argument is single-quoted, an inner quote as `'\''`.
const shellQuote = (arg: string): string => `'${arg.replaceAll("'", "'\\''")}'`;

// PLATFORM: the setting is a Perl single-quoted string, where only `\` and `'` need escaping.
const perlQuote = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("'", "\\'");

export function biberAssignment({ command, root }: BiberCommand): string {
  const line = [...command, BIBER_FLAG, "--root", root].map(shellQuote).join(" ");
  return `$biber = '${perlQuote(`${line} %O %S`)}';`;
}
