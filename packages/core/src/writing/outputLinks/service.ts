/** The linked outputs of one project over the host's ports: reading the outputs file, the state of each link, previews from the copies, Update, Run, linking a source on this device and creating links. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { formatError } from "../../errors/index.js";
import { extensionOf } from "../../path/index.js";
import type { ILogger } from "../../ports/index.js";
import { deriveProjectValueLeaves } from "../project/index.js";
import {
  IMAGE_OUTPUT_EXTENSIONS, deriveOutputCopy, deriveOutputState, describeOutputState, type OutputLinkStatus,
} from "./outputCopy.js";
import { normalizeRemote } from "./gitRemote.js";
import {
  OUTPUTS_FILE_PATH, checkOutputPath, createOutputLinkId, deriveOutputCopyPath, deriveOutputHash, formatOutputsFile, isOutputSourceName, parseOutputsFile,
  type OutputFormat, type OutputKind, type OutputLink, type OutputsFile, type OutputsRead,
} from "./outputsFile.js";
import { buildOutputInsert, scanOutputReferences, type OutputInsert, type OutputReference } from "./outputReferences.js";
import { readOutputTableCopy } from "./outputTables.js";


const MODULE = "writing/outputLinks";

/** Project files, paths relative to the project folder. */
export interface OutputProjectFiles {
  /** Undefined when absent. */
  readBytes(path: string): Promise<Uint8Array | undefined>;
  /** Atomic; creates folders. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
}

export type OutputRunResult =
  | { status: "finished"; code: number | null; output: string }
  | { status: "cancelled" }
  | { status: "declined" };

/** This device's access to the sources of one project; each host implements it. */
export interface OutputSourcePort {
  /** Undefined: not linked here. */
  status(source: string): Promise<{ folder: string; command?: string } | undefined>;
  /** Asks the user for the folder (host UI); stores it; undefined when cancelled. */
  pick(source: string): Promise<string | undefined>;
  unlink(source: string): Promise<void>;
  setCommand(source: string, command: string | undefined): Promise<void>;
  /** POSIX paths relative to the folder; skips .git, node_modules, .venv, venv, __pycache__ and hidden folders; at most 5000. */
  list(source: string): Promise<string[]>;
  read(source: string, path: string): Promise<Uint8Array | undefined>;
  /** The git remote "origin" (else the first remote) url of the folder. */
  remote(source: string): Promise<string | undefined>;
  /** Runs `command` in the source folder after the host made sure the user confirmed that exact text on this machine; "declined" when they did not. */
  run(source: string, command: string, signal: AbortSignal): Promise<OutputRunResult>;
  /** Display name of this user for `by`, when known. */
  userName?(): Promise<string | undefined>;
}

export interface OutputLinksDeps {
  files: OutputProjectFiles;
  sources: OutputSourcePort;
  logger: ILogger;
  format: OutputFormat;
  projectId: string;
}

export interface ResolvedOutputReference {
  reference: OutputReference;
  link: OutputLink;
  status: OutputLinkStatus;
  /** What the hover says of the state. */
  sentence: string;
}

export type OutputPreview =
  | { kind: "image"; bytes: Uint8Array; mime: string }
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "table"; rows: string[][] }
  | { kind: "values"; entries: Array<[string, unknown]> }
  | { kind: "text"; text: string };

export interface OutputCreateInput {
  source: string;
  path: string;
  kind: OutputKind;
  decimals?: number;
  /** The dotted keys a `values` link keeps. */
  keys?: string[];
  /** The manuscript the snippet goes into, relative to the project folder. */
  manuscriptPath?: string;
}

export interface OutputLinks {
  /** The parsed outputs file, cached until a write or `invalidate()`. */
  read(): Promise<OutputsRead>;
  resolve(text: string, manuscriptPath: string): Promise<ResolvedOutputReference[]>;
  /** The state of one link now. */
  status(link: OutputLink): Promise<OutputLinkStatus>;
  /** What the copy shows; undefined when the copy is not in the project. */
  preview(link: OutputLink): Promise<OutputPreview | undefined>;
  /** Copies the link's source file again; throws a sentence when it cannot. */
  update(linkId: string): Promise<OutputLink>;
  /** Runs the source's command, then updates its stale links and those whose copy is missing. Throws on a non-zero exit with the output's tail. */
  run(source: string, signal: AbortSignal): Promise<{ updated: string[]; result: OutputRunResult }>;
  /** Links a shared source to a folder on this device; a folder whose git remote is another repository's comes back as a mismatch. */
  linkSource(name: string): Promise<{ folder: string | undefined; mismatch?: { expected: string; actual: string } }>;
  /** A new shared source: its folder picked first, its git remote recorded. Undefined when the pick was cancelled. */
  addSource(name: string, command?: string): Promise<string | undefined>;
  /** A new link: the copy and its record written; the text to insert. */
  create(input: OutputCreateInput): Promise<{ link: OutputLink; insert: OutputInsert }>;
  invalidate(): void;
}

const tail = (output: string, lines = 12): string => output.trimEnd().split(/\r?\n/).slice(-lines).join("\n");

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const TEXT_PREVIEW_LIMIT = 4000;


const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8").decode(bytes);

/** The outputs file of one project: cached reads and read-modify-write changes. */
interface OutputsStore {
  read(): Promise<OutputsRead>;
  invalidate(): void;
  mutate<T>(change: (file: OutputsFile) => T): Promise<T>;
}

function createOutputsStore({ files, logger, projectId }: OutputLinksDeps): OutputsStore {
  let cached: Promise<OutputsRead> | undefined;

  const readFresh = async (): Promise<OutputsRead> => {
    const bytes = await files.readBytes(OUTPUTS_FILE_PATH);
    const read = parseOutputsFile(bytes === undefined ? undefined : decode(bytes));
    if (read.skipped.length > 0) { await logger.log("WARN", MODULE, "outputs file entries skipped", { project: projectId, skipped: read.skipped }); }
    if (read.problem !== undefined) { await logger.log("WARN", MODULE, "outputs file is read-only", { project: projectId, problem: read.problem }); }
    return read;
  };

  return {
    read: () => (cached ??= readFresh()),
    invalidate: () => { cached = undefined; },
    /** Reads the file again, applies `change` and writes it; a file that cannot be written throws its problem. */
    async mutate(change) {
      cached = undefined;
      const fresh = await readFresh();
      if (!fresh.writable) { throw new Error(fresh.problem); }
      const result = change(fresh.file);
      await files.writeBytes(OUTPUTS_FILE_PATH, new TextEncoder().encode(formatOutputsFile(fresh.file)));
      cached = Promise.resolve({ ...fresh, skipped: [] });
      return result;
    },
  };
}

type Derived = { bytes: Uint8Array; missing: string[] } | "absent" | undefined;

const userNameOf = async (sources: OutputSourcePort): Promise<string | undefined> => {
  try { return await sources.userName?.(); } catch { return undefined; }
};

/** The state of links and their copies: deriving the copy a source gives now, status, writing a copy and Update. */
function createCopyOps(deps: OutputLinksDeps, store: OutputsStore) {
  const { files, sources, logger, format, projectId } = deps;

  /** The copy the source gives now: undefined when the source is not linked here, "absent" when the file is not there. */
  const derive = async (link: Pick<OutputLink, "source" | "path" | "kind" | "decimals" | "keys">): Promise<Derived> => {
    if (!await sources.status(link.source)) { return undefined; }
    const bytes = await sources.read(link.source, link.path);
    if (bytes === undefined) { return "absent"; }
    return deriveOutputCopy(link.kind, bytes, link, format);
  };

  const status = async (link: OutputLink): Promise<OutputLinkStatus> => {
    const copyMissing = await files.readBytes(link.copy).then((bytes) => bytes === undefined, () => true);
    try {
      const current = await derive(link);
      const hashed = current === undefined || current === "absent" ? current : { hash: await deriveOutputHash(current.bytes), missing: current.missing };
      return deriveOutputState(link, hashed, copyMissing);
    } catch (error) {
      return { state: "unlinked", copyMissing, error: `Could not read ${link.source} › ${link.path}: ${formatError(error)}` };
    }
  };

  /** Writes a derived copy and the link's new record. */
  const writeCopy = async (link: OutputLink, bytes: Uint8Array): Promise<OutputLink> => {
    await files.writeBytes(link.copy, bytes);
    const name = await userNameOf(sources);
    const next: OutputLink = { ...link, hash: await deriveOutputHash(bytes), updated: new Date().toISOString() };
    if (name === undefined) { delete next.by; } else { next.by = name; }
    await store.mutate((file) => {
      const index = file.links.findIndex((each) => each.id === link.id);
      if (index < 0) { file.links.push(next); } else { file.links[index] = next; }
    });
    return next;
  };

  const update = async (linkId: string): Promise<OutputLink> => {
    const link = (await store.read()).file.links.find((each) => each.id === linkId);
    if (!link) { throw new Error("This output is no longer linked."); }
    const current = await derive(link);
    if (current === undefined) { throw new Error(`${link.source} is not linked to code on this computer.`); }
    if (current === "absent") { throw new Error(`${link.path} is not in ${link.source} yet — Run first.`); }
    if (current.missing.length > 0) { throw new Error(`${link.path} has no ${current.missing.join(", ")} yet — Run first.`); }
    const next = await writeCopy(link, current.bytes);
    await logger.log("INFO", MODULE, "output updated", { project: projectId, link: link.id, copy: link.copy });
    return next;
  };

  return { derive, status, writeCopy, update };
}

type CopyOps = ReturnType<typeof createCopyOps>;

function previewOutput(link: OutputLink, bytes: Uint8Array, format: OutputFormat): OutputPreview {
  const extension = extensionOf(link.copy);
  if (link.kind === "file" && IMAGE_OUTPUT_EXTENSIONS.includes(extension)) { return { kind: "image", bytes, mime: MIME[extension]! }; }
  if (link.kind === "file" && extension === ".pdf") { return { kind: "pdf", bytes }; }
  if (link.kind === "table") { return { kind: "table", rows: readOutputTableCopy(decode(bytes), format) }; }
  if (link.kind === "values") {
    try {
      return { kind: "values", entries: deriveProjectValueLeaves(link.copy, JSON.parse(decode(bytes)), "").leaves.map((leaf): [string, unknown] => [leaf.path, leaf.value]) };
    } catch {
      return { kind: "text", text: "The copy is not valid JSON." };
    }
  }
  const text = decode(bytes.subarray(0, TEXT_PREVIEW_LIMIT));
  return { kind: "text", text: text.includes("\u0000") ? `${link.copy}, ${Math.ceil(bytes.length / 1024)} KB` : text };
}

/** Runs the source's command, then updates its stale links and those whose copy is missing. */
function createRun({ sources, logger, projectId }: OutputLinksDeps, store: OutputsStore, ops: CopyOps): OutputLinks["run"] {
  return async (source, signal) => {
    const { file } = await store.read();
    const here = await sources.status(source);
    if (!here) { throw new Error(`${source} is not linked to code on this computer.`); }
    const command = here.command ?? file.sources[source]?.run;
    if (command === undefined || command.trim() === "") { throw new Error(`No command for ${source}. Set one in Link to code.`); }
    await logger.log("INFO", MODULE, "running source command", { project: projectId, source });
    const result = await sources.run(source, command, signal);
    if (result.status !== "finished") { return { updated: [], result }; }
    if (result.code !== 0) { throw new Error(`${command} exited with code ${String(result.code)}:\n${tail(result.output)}`); }
    const updated: string[] = [];
    for (const link of (await store.read()).file.links.filter((each) => each.source === source)) {
      const linkStatus = await ops.status(link);
      if (linkStatus.state === "stale" || (linkStatus.copyMissing && linkStatus.state !== "missing")) {
        await ops.update(link.id);
        updated.push(link.id);
      }
    }
    return { updated, result };
  };
}

/** Linking and adding sources on this device. */
function createSourceOps({ sources }: OutputLinksDeps, store: OutputsStore): Pick<OutputLinks, "linkSource" | "addSource"> {
  return {
    async linkSource(name) {
      const folder = await sources.pick(name);
      if (folder === undefined) { return { folder }; }
      const expected = (await store.read()).file.sources[name]?.remote;
      const actual = await sources.remote(name).catch(() => undefined);
      // A folder without a remote (a downloaded copy) is not a mismatch: there is nothing to compare.
      if (expected !== undefined && actual !== undefined && normalizeRemote(expected) !== normalizeRemote(actual)) { return { folder, mismatch: { expected, actual } }; }
      return { folder };
    },

    async addSource(name, command) {
      if (!isOutputSourceName(name)) { throw new Error("A source name starts with a letter and has up to 40 letters, digits, '-' or '_'."); }
      if ((await store.read()).file.sources[name]) { throw new Error(`There is already a source named ${name}.`); }
      const folder = await sources.pick(name);
      if (folder === undefined) { return undefined; }
      const remote = await sources.remote(name).catch(() => undefined);
      const run = command?.trim() || undefined;
      await store.mutate((file) => { file.sources[name] = { ...(run ? { run } : {}), ...(remote ? { remote } : {}) }; });
      return folder;
    },
  };
}

function createCreate({ logger, format, projectId }: OutputLinksDeps, store: OutputsStore, ops: CopyOps): OutputLinks["create"] {
  return async (input) => {
    const problem = checkOutputPath(input.path);
    if (problem !== undefined) { throw new Error(`${input.path} ${problem}.`); }
    const { file } = await store.read();
    if (!file.sources[input.source]) { throw new Error(`There is no source named ${input.source}.`); }
    const current = await ops.derive(input);
    if (current === undefined) { throw new Error(`${input.source} is not linked to code on this computer.`); }
    if (current === "absent") { throw new Error(`${input.path} is not in ${input.source}.`); }
    if (current.missing.length > 0) { throw new Error(`${input.path} has no ${current.missing.join(", ")}.`); }
    const copy = deriveOutputCopyPath(input.source, input.path, input.kind, format, new Set(file.links.map((link) => link.copy)));
    const link: OutputLink = {
      id: createOutputLinkId(new Set(file.links.map((each) => each.id))), source: input.source, path: input.path, kind: input.kind,
      ...(input.kind === "table" && input.decimals !== undefined ? { decimals: input.decimals } : {}),
      ...(input.kind === "values" ? { keys: [...input.keys ?? []] } : {}), copy, hash: "", updated: "",
    };
    const written = await ops.writeCopy(link, current.bytes);
    await logger.log("INFO", MODULE, "output linked", { project: projectId, link: link.id, kind: link.kind, copy });
    return { link: written, insert: buildOutputInsert(written, format, input.manuscriptPath) };
  };
}

export function createOutputLinks(deps: OutputLinksDeps): OutputLinks {
  const { files, format } = deps;
  const store = createOutputsStore(deps);
  const ops = createCopyOps(deps, store);

  return {
    read: store.read,
    invalidate: store.invalidate,
    status: ops.status,
    update: ops.update,
    run: createRun(deps, store, ops),
    create: createCreate(deps, store, ops),
    ...createSourceOps(deps, store),

    async resolve(text, manuscriptPath) {
      const { file } = await store.read();
      const references = scanOutputReferences(text, format, manuscriptPath, file.links);
      const statuses = new Map<string, Promise<OutputLinkStatus>>();
      return Promise.all(references.map(async (reference) => {
        const link = file.links.find((each) => each.id === reference.linkId)!;
        if (!statuses.has(link.id)) { statuses.set(link.id, ops.status(link)); }
        const linkStatus = await statuses.get(link.id)!;
        return { reference, link, status: linkStatus, sentence: describeOutputState(link, linkStatus) };
      }));
    },

    async preview(link) {
      const bytes = await files.readBytes(link.copy);
      return bytes === undefined ? undefined : previewOutput(link, bytes, format);
    },
  };
}
