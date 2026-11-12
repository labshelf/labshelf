// The linked-output requests of the source editor's protocol: the project's files as base64 (null when absent; writes are atomic) and this machine's
// OutputSourcePort, one request per method (outputSourceRun confirms the exact command on this machine; outputSourceRead answers base64 or null;
// outputSourceCancel stops that source's running command).
import { isRecord, isString } from "../guards/index.js";

export type OutputRequestMethod =
  | "readProjectBytes" | "writeProjectBytes"
  | "outputSourceStatus" | "outputSourcePick" | "outputSourceUnlink" | "outputSourceSetCommand" | "outputSourceList" | "outputSourceRead" | "outputSourceRemote" | "outputSourceRun"
  | "outputSourceCancel";

type Parse = (value: unknown) => Record<string, unknown> | undefined;

/** The params of an output source request that names only its source. */
const parseSourceName: Parse = (p) => isRecord(p) && isString(p.source) ? { source: p.source } : undefined;

/** Params of each output request, validated and rebuilt so unknown keys never pass through. */
export const OUTPUT_REQUEST_PARAMS: Record<OutputRequestMethod, Parse> = {
  readProjectBytes: (p) => isRecord(p) && isString(p.path) ? { path: p.path } : undefined,
  writeProjectBytes: (p) => isRecord(p) && isString(p.path) && isString(p.base64) ? { path: p.path, base64: p.base64 } : undefined,
  outputSourceStatus: parseSourceName,
  outputSourcePick: parseSourceName,
  outputSourceUnlink: parseSourceName,
  outputSourceSetCommand: (p) => {
    if (!isRecord(p) || !isString(p.source)) { return undefined; }
    if (p.command === undefined) { return { source: p.source }; }
    return isString(p.command) ? { source: p.source, command: p.command } : undefined;
  },
  outputSourceList: parseSourceName,
  outputSourceRead: (p) => isRecord(p) && isString(p.source) && isString(p.path) ? { source: p.source, path: p.path } : undefined,
  outputSourceRemote: parseSourceName,
  outputSourceRun: (p) => isRecord(p) && isString(p.source) && isString(p.command) ? { source: p.source, command: p.command } : undefined,
  outputSourceCancel: parseSourceName,
};
