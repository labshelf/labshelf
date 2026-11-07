// The Space side of a share mirror: notes and threads are share files, space.json and glossary.json follow the shared JSON.
// CONTRACT: documents/contracts/collaboration.md#space-shares
import type * as Y from "yjs";
import { deriveTextSha256Hex } from "../../hash/index.js";
import { isRecord } from "../../guards/index.js";
import { baseName } from "../../path/index.js";
import { isExternalChangeNoise, parseConflictName } from "../../library/conflicts/index.js";
import { GLOSSARY_FILE, SPACE_FILE } from "../../library/index.js";
import { parseGlossaryFile, parseSpaceFile, serializeGlossaryFile, serializeSpaceFile } from "../../spaces/index.js";
import { isSafeSharePath } from "../sharedFiles.js";
import {
  applySharedJson, hasSharedJson, isSameSharedJson, readSharedJson, readSharedJsonDoc, writeSharedJsonDoc,
  type SharedJson, type SharedJsonSpec,
} from "../sharedJson.js";
import { DISK_ORIGIN, LOG_MODULE, writeMirrored, type MirrorContext, type MirrorProfile } from "./fileReconcile.js";
import type { ReconcileOutcome } from "./pathQueue.js";

export const SPACE_JSON_SPEC: SharedJsonSpec = {
  prefix: "space",
  values: ["name", "purpose", "createdAt"],
  collections: [{ key: "folders" }, { key: "papers", localFields: ["focus"] }, { key: "dates" }, { key: "saved" }, { key: "agreements" }, { key: "seen" }],
};

export const GLOSSARY_JSON_SPEC: SharedJsonSpec = { prefix: "glossary", values: [], collections: [{ key: "terms" }] };

interface SharedJsonFile {
  readonly spec: SharedJsonSpec;
  /** The canonical text of the file, or a reason it is left as it is. */
  render(raw: Record<string, unknown>, folderName: string): { text: string } | { problem: string };
  /** The file's content when it does not exist; undefined when its absence is a problem. */
  readonly missing: Record<string, unknown> | undefined;
}

// TRAP: core's root index can load this module while library/ is part-way loaded, so the file names are read on use.
let files: Readonly<Record<string, SharedJsonFile>> | undefined;
const FILES_OF = (): Readonly<Record<string, SharedJsonFile>> => (files ??= {
  [SPACE_FILE]: {
    spec: SPACE_JSON_SPEC,
    render: (raw, id) => {
      const read = parseSpaceFile(JSON.stringify(raw), { id, path: SPACE_FILE });
      if (read.state === "unreadable") { return { problem: read.reason }; }
      return read.readOnlyReason === undefined ? { text: serializeSpaceFile(read.space) } : { problem: read.readOnlyReason };
    },
    missing: undefined,
  },
  [GLOSSARY_FILE]: {
    spec: GLOSSARY_JSON_SPEC,
    render: (raw) => {
      const read = parseGlossaryFile(JSON.stringify(raw));
      return read.readOnlyReason === undefined ? { text: serializeGlossaryFile(read.glossary) } : { problem: read.readOnlyReason };
    },
    missing: {},
  },
});

const SPACE_FOLDERS = ["notes", "discussions"];

/** A note, a thread or a file beside one; hidden paths, conflict copies and sync-tool scratch stay out. */
function isSpaceSharePath(path: string): boolean {
  if (!isSafeSharePath(path)) { return false; }
  const segments = path.split("/");
  const name = segments[segments.length - 1]!;
  return segments.length > 1 && SPACE_FOLDERS.includes(segments[0]!) && segments.every((segment) => !segment.startsWith("."))
    && parseConflictName(name) === null && !isExternalChangeNoise(path);
}

async function reconcileSharedJson(context: MirrorContext, path: string, settled: boolean, stableMs: number): Promise<ReconcileOutcome> {
  const file = FILES_OF()[path]!;
  const { session, store, logger } = context;
  const disk = await context.disk.read(path, settled ? stableMs : undefined);
  if (disk.state === "changing") { return "changing"; }
  const text = disk.state === "present" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : undefined;
  const raw = text === undefined ? file.missing : parseObject(text);
  if (raw === undefined) {
    await logger.log("WARN", LOG_MODULE, `Left ${path} out of the share until it is a valid JSON object`, { folder: context.folder, missing: text === undefined });
    return "done";
  }
  // INVARIANT: a file this app cannot write (a newer version, a key of the wrong type) neither takes nor gives edits.
  const current = file.render(raw, baseName(context.folder));
  if ("problem" in current) {
    await logger.log("WARN", LOG_MODULE, `Left ${path} out of the share: ${current.problem}`, { folder: context.folder });
    return "done";
  }
  const diskHash = text === undefined ? undefined : await deriveTextSha256Hex(text);
  const known = store.known.get(path);
  // A first look takes the share's part when it has one, so a fresh copy never clears it.
  if ((diskHash !== undefined && diskHash === known) || (known === undefined && hasSharedJson(session.index, file.spec)) || text === undefined) {
    await writeFromShare(context, path, raw, text, diskHash);
    return "done";
  }
  if (!settled) { context.request(path, true); return "done"; }
  const next = readSharedJson(raw, file.spec);
  const base = context.bases.get(path) as SharedJson | undefined;
  if (!base || !isSameSharedJson(base, next)) {
    writeSharedJsonDoc(session.index, file.spec, next, base, DISK_ORIGIN);
    await logger.log("INFO", LOG_MODULE, `Took ${path} edits into the share`, { folder: context.folder });
  }
  await writeFromShare(context, path, raw, text, diskHash);
  return "done";
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the index's part into the file, keeping this user's keys, and records it as the agreed base. */
async function writeFromShare(context: MirrorContext, path: string, raw: Record<string, unknown>, text: string | undefined, diskHash: string | undefined): Promise<void> {
  const file = FILES_OF()[path]!;
  const shared = readSharedJsonDoc(context.session.index, file.spec);
  // An absent glossary stays absent while the share holds no term.
  if (text === undefined && !hasSharedJson(context.session.index, file.spec)) { return; }
  const next = file.render(applySharedJson(raw, shared, file.spec), baseName(context.folder));
  if ("problem" in next) {
    await context.logger.log("WARN", LOG_MODULE, `Did not write ${path} from the share: ${next.problem}`, { folder: context.folder });
    return;
  }
  if (next.text === text && diskHash !== undefined) { context.store.known.set(path, diskHash); } else { await writeMirrored(context, path, next.text); }
  context.bases.set(path, shared);
}

type Listener = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => void;

function observeSharedJson(index: Y.Doc, spec: SharedJsonSpec, onChange: () => void): () => void {
  const types: { observeDeep(f: Listener): void; unobserveDeep(f: Listener): void }[] = [index.getMap(spec.prefix), ...spec.collections.flatMap(({ key }) => [
    index.getMap(`${spec.prefix}.${key}`), index.getArray(`${spec.prefix}.${key}.order`),
  ])];
  const listener: Listener = (_events, transaction) => { if (transaction.origin !== DISK_ORIGIN) { onChange(); } };
  types.forEach((type) => type.observeDeep(listener));
  return () => types.forEach((type) => type.unobserveDeep(listener));
}

/** A Space folder: notes and threads are share files, space.json and glossary.json are merged by key and entry. */
export const spaceMirrorProfile: MirrorProfile = {
  get ownFiles() { return [SPACE_FILE, GLOSSARY_FILE]; },
  get diskFiles() { return [SPACE_FILE, GLOSSARY_FILE]; },
  sharedPaths: (list) => list.filter(isSpaceSharePath),
  accepts: isSpaceSharePath,
  // A note or thread is an item file, whose conflict copies the Space's own merge folds in.
  holdsConflictCopies: false,
  reconcile: reconcileSharedJson,
  observe: (index, request) => {
    const stops = [SPACE_FILE, GLOSSARY_FILE].map((path) => observeSharedJson(index, FILES_OF()[path]!.spec, () => request(path)));
    return () => stops.forEach((stop) => stop());
  },
};
