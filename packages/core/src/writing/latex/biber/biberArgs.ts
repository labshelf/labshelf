// Parses the arguments latexmk passes to the biber command LabShelf installs: the project root, biber's options and the control file.

export const BIBER_FLAG = "--biber";
const ROOT_FLAG = "--root";

export interface BiberArgs {
  /** The project folder, which bounds the files biber may read. */
  root: string;
  /** Biber options from latexmk's `%O`, passed on unchanged. */
  options: string[];
  /** The `.bcf` from latexmk's `%S`; latexmk names it with its build-folder path. */
  controlFile: string;
}

/** `args` follow `--biber`; the control file is the last argument, as latexmk puts `%S` after `%O`. */
export function parseBiberArgs(args: readonly string[]): BiberArgs {
  const rootAt = args.indexOf(ROOT_FLAG);
  const root = rootAt === -1 ? undefined : args[rootAt + 1];
  if (root === undefined || root === "") { throw new Error(`biber: ${ROOT_FLAG} <project folder> is missing from ${JSON.stringify(args)}`); }
  const rest = args.filter((_, index) => index !== rootAt && index !== rootAt + 1);
  const last = rest.at(-1);
  if (last === undefined || last.startsWith("-")) { throw new Error(`biber: no control file in ${JSON.stringify(args)}`); }
  // PLATFORM: biber accepts the control file with or without its `.bcf` extension.
  const controlFile = last.endsWith(".bcf") ? last : `${last}.bcf`;
  return { root, options: rest.slice(0, -1), controlFile };
}
