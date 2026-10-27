// Runtime-neutral side of running biber for latexmk: its arguments, its WASM assets port, its control file, latexmk's `$biber` setting and its errors.

// ---- Arguments latexmk passes to the biber command ----

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

// ---- The port through which a host hands over the biber WASM module ----

export interface BiberReleaseManifest {
  /** The biber release the module was built from. */
  biber: string;
  /** The `.bcf` format version this biber reads; a control file of another version goes to the TeX's own biber. */
  bcfVersion: string;
  /** sha256 of each file, by file name. */
  files: Record<string, string>;
}

export interface BiberWasmAssets {
  manifest: BiberReleaseManifest;
  /** The emscripten factory script (`biber.js`), a CommonJS module. */
  factorySource(): Promise<string>;
  wasm(): Promise<Uint8Array>;
  /** A file on disk holding `biber.data`, which the module reads itself. */
  dataFile(): Promise<string>;
}

export const BIBER_ASSET_FILES = { factory: "biber.js", wasm: "biber.wasm", data: "biber.data", manifest: "manifest.json" } as const;

export function parseBiberReleaseManifest(text: string): BiberReleaseManifest {
  const value = JSON.parse(text) as Partial<BiberReleaseManifest>;
  if (typeof value.biber !== "string" || typeof value.bcfVersion !== "string" || typeof value.files !== "object" || value.files === null) {
    throw new Error(`biber manifest lacks biber, bcfVersion or files: ${text.slice(0, 200)}`);
  }
  return { biber: value.biber, bcfVersion: value.bcfVersion, files: value.files };
}

// ---- The biblatex control file (.bcf) ----

export interface BibliographySource {
  /** The path as `\addbibresource` gave it. */
  path: string;
  /** `file` or `remote`; only files can be read without the network. */
  type: string;
}

export interface ControlFile {
  /** The `version` of `<bcf:controlfile>`, which pairs one biblatex release with one biber release. */
  version: string | undefined;
  dataSources: BibliographySource[];
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

const decodeXml = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, name: string) =>
    name.startsWith("#x") || name.startsWith("#X") ? String.fromCodePoint(parseInt(name.slice(2), 16))
      : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1)))
        : XML_ENTITIES[name.toLowerCase()] ?? "");

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];

export function parseControlFile(xml: string): ControlFile {
  const root = /<bcf:controlfile\b([^>]*)>/.exec(xml);
  const version = root ? attribute(root[1] ?? "", "version") : undefined;
  const dataSources = [...xml.matchAll(/<bcf:datasource\b([^>]*)>([^<]*)<\/bcf:datasource>/g)].map(([, attributes = "", body = ""]) => ({
    path: decodeXml(body.trim()), type: attribute(attributes, "type") ?? "file",
  }));
  // INVARIANT: biblatex lists a resource once per refsection that uses it; biber reads it once.
  const unique = dataSources.filter((source, index) => dataSources.findIndex((other) => other.path === source.path) === index);
  return { version: version === undefined ? undefined : decodeXml(version), dataSources: unique };
}

// ---- Latexmk's `$biber` setting ----

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

export function createBiberAssignment({ command, root }: BiberCommand): string {
  const line = [...command, BIBER_FLAG, "--root", root].map(shellQuote).join(" ");
  return `$biber = '${perlQuote(`${line} %O %S`)}';`;
}

// ---- Biber's error messages in its log (.blg) ----

const ERROR_LINE = /^(?:\[\d+\] [^>]*> )?ERROR - (.+)$/;

export function extractBiberErrors(blg: string): string[] {
  return blg.split(/\r?\n/).flatMap((line) => {
    const message = ERROR_LINE.exec(line.trim())?.[1];
    return message === undefined ? [] : [message];
  });
}
