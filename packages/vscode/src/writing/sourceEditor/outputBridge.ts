// Answers the LabShelf editor's linked-output requests: the project's bytes and this machine's source port, with runs the page can cancel.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { base64ToBytes, bytesToBase64, OUTPUT_REQUEST_PARAMS, type OutputProjectFiles, type OutputSourcePort } from "@labshelf/core";

/** What a panel of a project offers its page for linked outputs; without it every output request rejects. */
export interface OutputBridgeDeps {
  files: OutputProjectFiles;
  sources: OutputSourcePort;
}

export interface OutputBridge {
  /** True for the methods this bridge answers. */
  handles(method: string): boolean;
  answer(method: string, params: unknown): Promise<unknown>;
  /** Stops every run this page started. */
  dispose(): void;
}

const METHODS: ReadonlySet<string> = new Set(Object.keys(OUTPUT_REQUEST_PARAMS));

/** The string a request param holds at `key`, or undefined. */
function optionalParam(params: unknown, key: string): string | undefined {
  const value = typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : undefined;
}

/** The string a request param must hold at `key`; throws when it is absent. */
export function stringParam(params: unknown, key: string): string {
  const value = optionalParam(params, key);
  if (value === undefined) { throw new Error(`missing ${key}`); }
  return value;
}

export function createOutputBridge(deps: OutputBridgeDeps | undefined): OutputBridge {
  const running = new Map<string, AbortController>();
  const of = (): OutputBridgeDeps => {
    if (!deps) { throw new Error("Linked outputs work in a project of the desktop app."); }
    return deps;
  };
  const run = async (source: string, command: string): Promise<unknown> => {
    running.get(source)?.abort();
    const abort = new AbortController();
    running.set(source, abort);
    try {
      return await of().sources.run(source, command, abort.signal);
    } finally {
      if (running.get(source) === abort) { running.delete(source); }
    }
  };
  return {
    handles: (method) => METHODS.has(method),
    async answer(method, params) {
      switch (method) {
        case "readProjectBytes": {
          // Without outputs (the web, a file in no project) the page reads no outputs file, so it links nothing and reports nothing.
          if (!deps) { return null; }
          const bytes = await of().files.readBytes(stringParam(params, "path"));
          return bytes === undefined ? null : bytesToBase64(bytes);
        }
        case "writeProjectBytes": await of().files.writeBytes(stringParam(params, "path"), base64ToBytes(stringParam(params, "base64"))); return undefined;
        case "outputSourceStatus": return await of().sources.status(stringParam(params, "source")) ?? null;
        case "outputSourcePick": return await of().sources.pick(stringParam(params, "source")) ?? null;
        case "outputSourceUnlink": await of().sources.unlink(stringParam(params, "source")); return undefined;
        case "outputSourceSetCommand": await of().sources.setCommand(stringParam(params, "source"), optionalParam(params, "command")); return undefined;
        case "outputSourceList": return await of().sources.list(stringParam(params, "source"));
        case "outputSourceRead": {
          const bytes = await of().sources.read(stringParam(params, "source"), stringParam(params, "path"));
          return bytes === undefined ? null : bytesToBase64(bytes);
        }
        case "outputSourceRemote": return await of().sources.remote(stringParam(params, "source")) ?? null;
        case "outputSourceRun": return await run(stringParam(params, "source"), stringParam(params, "command"));
        case "outputSourceCancel": running.get(stringParam(params, "source"))?.abort(); return undefined;
        default: throw new Error(`not available: ${method}`);
      }
    },
    dispose() {
      for (const abort of running.values()) { abort.abort(); }
      running.clear();
    },
  };
}
